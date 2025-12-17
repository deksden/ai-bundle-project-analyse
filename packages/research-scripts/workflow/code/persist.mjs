import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getInputValue, findInputBySuffix, loadStageContext } from "../utils/context.mjs";
import { writeYAML } from "../utils/yaml.mjs";

function resolveWorkspaceRoot(startDir) {
	const explicit = process.env.AI_KOD_PROJECT_ROOT;
	if (typeof explicit === "string" && explicit.length > 0) {
		const candidate = path.isAbsolute(explicit) ? explicit : path.resolve(explicit);
		if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
			return candidate;
		}
	}

	let current = startDir;
	while (true) {
		const candidate = path.join(current, "pnpm-workspace.yaml");
		if (fs.existsSync(candidate)) {
			return current;
		}
		const parent = path.dirname(current);
		if (parent === current) {
			return undefined;
		}
		current = parent;
	}
}

function sleep(ms) {
	const arr = new Int32Array(new SharedArrayBuffer(4));
	Atomics.wait(arr, 0, 0, ms);
}

function runWriteToDb(commandArgs, options = {}) {
	const maxAttempts = options.maxAttempts ?? 5;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const result = spawnSync("pnpm", commandArgs, {
			cwd: options.cwd ?? process.cwd(),
			encoding: "utf8",
			stdio: ["inherit", "pipe", "pipe"],
			env: { ...process.env, ...(options.env ?? {}) },
		});

		if (result.stdout) process.stdout.write(result.stdout);
		if (result.stderr) process.stderr.write(result.stderr);

		if (result.status === 0) {
			return;
		}
		const stderr = result.stderr || "";
		if (stderr.includes("database is locked") && attempt < maxAttempts) {
			sleep(1000 * attempt);
			continue;
		}
		throw new Error("write-to-db command failed for code lane");
	}
}

function toJsonLines(records) {
	if (records.length === 0) return "";
	return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function loadParallelSnapshot(context) {
	const snapshotPath =
		getInputValue(context, "artefacts.parallel_snapshot") ??
		findInputBySuffix(context, [
			"artefacts.parallel_snapshot",
			"parallel_snapshot",
		]);
	if (typeof snapshotPath !== "string" || snapshotPath.length === 0) {
		throw new Error("parallel snapshot path is missing in lanes-summary output");
	}
	const absolutePath = path.resolve(snapshotPath);
	if (!fs.existsSync(absolutePath)) {
		throw new Error(`parallel snapshot not found: ${absolutePath}`);
	}
	return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function readProcessedRecords(context) {
	const snapshot = loadParallelSnapshot(context);
	const codeLane = snapshot?.lanes?.code ?? snapshot?.code ?? snapshot?.parallel_results?.lanes?.code;
	const pathValue = codeLane?.outputs?.artefacts?.processed_records;
	if (typeof pathValue !== "string" || pathValue.length === 0) {
		throw new Error("processed_records artefact is missing for code lane");
	}
	const absolutePath = path.resolve(pathValue);
	if (!fs.existsSync(absolutePath)) {
		throw new Error(`processed_records file not found: ${absolutePath}`);
	}
	const data = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
	if (!Array.isArray(data)) {
		throw new Error("processed_records must contain an array");
	}
	return data;
}

function queryExistingFileHashes(dbPath, filePaths) {
	if (filePaths.length === 0) {
		return new Map();
	}
	const uniquePaths = Array.from(new Set(filePaths));
	const placeholders = uniquePaths.map((p) => `'${p.replace(/'/g, "''")}'`).join(",");
	const sql = `SELECT path, hash FROM files WHERE path IN (${placeholders})`;
	const result = spawnSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(result.stderr || "Failed to query existing file hashes");
	}
	const rows = result.stdout?.trim().length ? JSON.parse(result.stdout) : [];
	const map = new Map();
	for (const row of rows) {
		if (row?.path) {
			map.set(row.path, row.hash ?? null);
		}
	}
	return map;
}

function cleanupFileData(dbPath, filePath) {
	const escaped = filePath.replace(/'/g, "''");
	const statements = [
		`DELETE FROM raw_code_entities WHERE file_path='${escaped}'`,
		`DELETE FROM raw_relationships WHERE source_path='${escaped}' OR target_path='${escaped}'`,
		`DELETE FROM result_entities WHERE path='${escaped}'`,
		`DELETE FROM file_index WHERE path='${escaped}'`,
		`DELETE FROM files WHERE path='${escaped}'`,
	];
	const payload = `${statements.join(";\n")};\n`;
	const result = spawnSync("sqlite3", [dbPath], { input: payload, encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(result.stderr || "Failed to cleanup file data");
	}
}

try {
	const stepRoot = process.cwd();
	const context = loadStageContext(stepRoot);
	const workspaceRoot = resolveWorkspaceRoot(stepRoot);
	const globalRoot = fs.realpathSync(path.join(stepRoot, "global"));
	const analysisDir = path.join(globalRoot, "analysis");
	const logsDir = path.join(globalRoot, "logs");
	const bundleRoot = path.join(globalRoot, "bundle", "research-structure");
	fs.mkdirSync(analysisDir, { recursive: true });
	fs.mkdirSync(logsDir, { recursive: true });

	const dbPath =
		getInputValue(context, "db_path") ??
		findInputBySuffix(context, ["db_path", "start.db_path"]);
	if (typeof dbPath !== "string" || dbPath.length === 0) {
		throw new Error("db_path input is required for code-persist");
	}

	const branchOutputs = readProcessedRecords(context);
	const filePaths = branchOutputs
		.map((entry) => entry?.file?.absolute_path ?? entry?.file?.path ?? entry?.ingest?.files?.path)
		.filter((value) => typeof value === "string" && value.length > 0);
	const existingHashes = queryExistingFileHashes(dbPath, filePaths);
	const ingestCandidates = [];
	const skippedFiles = [];

	for (const entry of branchOutputs) {
		const filePath =
			entry?.file?.absolute_path ?? entry?.file?.path ?? entry?.ingest?.files?.path ?? null;
		const fileHash = entry?.ingest?.files?.hash ?? null;
		const unchanged =
			filePath && fileHash && existingHashes.has(filePath) && existingHashes.get(filePath) === fileHash;
		if (unchanged) {
			skippedFiles.push(filePath);
			continue;
		}
		if (filePath && existingHashes.has(filePath)) {
			try {
				cleanupFileData(dbPath, filePath);
			} catch (error) {
				console.warn(`[code-persist] cleanup failed for ${filePath}:`, error);
			}
		}
		ingestCandidates.push(entry);
	}

	const ingestionRecords = [];
	let ingestedFiles = 0;
	let rawEntities = 0;
	let rawRelationships = 0;

	for (const entry of ingestCandidates) {
		if (entry?.ingest?.files) {
			ingestionRecords.push(entry.ingest.files);
			ingestedFiles += 1;
		}
		if (Array.isArray(entry?.ingest?.raw_code_entities)) {
			for (const record of entry.ingest.raw_code_entities) {
				ingestionRecords.push(record);
				rawEntities += 1;
			}
		}
		if (Array.isArray(entry?.ingest?.raw_relationships)) {
			for (const record of entry.ingest.raw_relationships) {
				ingestionRecords.push(record);
				rawRelationships += 1;
			}
		}
	}

	const outputYamlPath = path.join(stepRoot, "output.yaml");
	const ingestPath = path.join(analysisDir, "code-ingest.jsonl");
	fs.writeFileSync(ingestPath, toJsonLines(ingestionRecords));

	const output = {
		status: "success",
		lane_id: "code",
		metrics: {
			processed_records: ingestCandidates.length,
			ingested_files: ingestedFiles,
			raw_entities: rawEntities,
			raw_relationships: rawRelationships,
			skipped_files: skippedFiles.length,
		},
		artefacts: {
			ingest_jsonl: ingestPath,
		},
		deviations: [],
	};
	if (skippedFiles.length > 0) {
		output.deviations.push({
			error: "files_skipped",
			count: skippedFiles.length,
			details: skippedFiles.slice(0, 10),
		});
	}

	if (ingestionRecords.length === 0) {
		output.deviations.push({
			error: "no_ingestion_records",
			message: "All files match existing hashes — nothing to persist",
		});
		writeYAML(outputYamlPath, output);
	} else {
		const logPath = path.join(logsDir, "code-write-to-db.log");
		output.artefacts.write_log = logPath;
		const args = [
			"exec",
			"tsx",
			path.join(bundleRoot, "scripts/write-to-db.ts"),
			"--db_path",
			dbPath,
			"--task_id",
			context?.task?.id ?? "code-lane",
			"--ingest_path",
			ingestPath,
			"--source",
			"code-lane",
			"--log_file",
			logPath,
		];
		runWriteToDb(args, {
			cwd: workspaceRoot ?? bundleRoot,
		});
		writeYAML(outputYamlPath, output);
	}
} catch (error) {
	console.error("[code-persist] failed:", error);
	const fallback = {
		status: "failed",
		error: error instanceof Error ? error.message : String(error),
	};
	try {
		writeYAML(path.join(process.cwd(), "output.yaml"), fallback);
	} catch {
		// ignore
	}
	process.exitCode = 1;
}
