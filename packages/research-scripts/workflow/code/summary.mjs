import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { findInputBySuffix, getInputValue, loadStageContext } from "../utils/context.mjs";
import { writeYAML } from "../utils/yaml.mjs";

const LANE_ID = "code";
const PROCESS_FILENAME = "code-process.json";

function readArrayInput(context, key) {
	const value = getInputValue(context, key) ?? findInputBySuffix(context, [key]) ?? [];
	if (!Array.isArray(value)) {
		throw new Error(`${key} input must be an array`);
	}
	return value;
}

function toNumber(value) {
	const num = Number(value);
	return Number.isFinite(num) ? num : undefined;
}

function loadFanoutItems(fanoutPath) {
	if (!fanoutPath || typeof fanoutPath !== "string") {
		return [];
	}
	try {
		const content = fs.readFileSync(path.resolve(fanoutPath), "utf8");
		const parsed = JSON.parse(content);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function buildMarkdownReport(summary, missingIndices, failedChecks, branchErrors) {
	const lines = [
		"# Code Lane Summary",
		"",
		`Generated: ${summary.generated_at}`,
		"",
		"## Totals",
		"",
		`- Expected files: ${summary.metrics.expected_files}`,
		`- Fan-out items (source): ${summary.metrics.fanout_items || "n/a"}`,
		`- Processed branches: ${summary.metrics.processed_branches}`,
		`- Successful files: ${summary.metrics.successful_files}`,
		`- Unique extensions: ${summary.metrics.unique_extensions}`,
		`- Total entities: ${summary.metrics.entity_totals}`,
		`- Documented entities: ${summary.metrics.documented_entities}`,
		`- Total imports: ${summary.metrics.imports_total}`,
		`- Files with failed checks: ${failedChecks}`,
		`- Branch errors: ${branchErrors}`,
		`- Missing branch results: ${missingIndices.length}`,
		"",
		"## Extension Breakdown",
		"",
		"| Extension | Count |",
		"|-----------|-------|",
	];

	const breakdownEntries = Object.entries(summary.metrics.extension_breakdown ?? {});
	if (breakdownEntries.length === 0) {
		lines.push("| (none) | 0 |");
	} else {
		for (const [ext, count] of breakdownEntries.sort(([a], [b]) => a.localeCompare(b))) {
			lines.push(`| ${ext || "(none)"} | ${count} |`);
		}
	}

	if (missingIndices.length > 0) {
		lines.push("");
		lines.push("## Missing Branch Results");
		lines.push("");
		for (const index of missingIndices) {
			lines.push(`- Index ${index}`);
		}
	}

	return `${lines.join("\n")}\n`;
}

function extractBranchResult(entry) {
	if (!entry || typeof entry !== "object") {
		return {};
	}
	if (entry.outputs && typeof entry.outputs === "object") {
		return entry.outputs;
	}
	return entry;
}

function collectBranchResultsFromFiles(taskRoot, filename, laneId) {
	const results = [];
	const entries = fs.readdirSync(taskRoot, { withFileTypes: true });
	for (const dirent of entries) {
		if (!dirent.isDirectory() || !dirent.name.startsWith("STEP-")) {
			continue;
		}
		const candidate = path.join(taskRoot, dirent.name, filename);
		if (!fs.existsSync(candidate)) {
			continue;
		}
		try {
			const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
			const lane = parsed?.lane_id ?? parsed?.lane;
			if (laneId && lane && lane !== laneId) {
				continue;
			}
			parsed.__source_step = dirent.name;
			results.push(parsed);
		} catch (error) {
			console.warn(`[code-summary] Failed to parse ${candidate}:`, error instanceof Error ? error.message : error);
		}
	}
	return results;
}

function sleep(ms) {
	const array = new Int32Array(new SharedArrayBuffer(4));
	Atomics.wait(array, 0, 0, ms);
}

function collectBranchResultsWithWait(taskRoot, filename, laneId, expectedPaths) {
	const expectedSet =
		Array.isArray(expectedPaths) && expectedPaths.length > 0 ? new Set(expectedPaths) : null;
	const deadline = expectedSet ? Date.now() + 30_000 : Date.now();
	const collected = new Map();

	const collectOnce = () => {
		const entries = collectBranchResultsFromFiles(taskRoot, filename, laneId);
		for (const entry of entries) {
			const branch = extractBranchResult(entry);
			const primaryKey = branch?.file?.path ?? branch?.file?.absolute_path ?? entry.__source_step;
			const key = primaryKey ?? Math.random().toString(36).slice(2);
			if (expectedSet && primaryKey && !expectedSet.has(primaryKey)) {
				continue;
			}
			collected.set(key, entry);
		}
	};

	do {
		collectOnce();
		if (!expectedSet || collected.size >= expectedSet.size) {
			break;
		}
		sleep(500);
	} while (Date.now() < deadline);

	return Array.from(collected.values());
}

function collectLaneRecords({ primaryEntries, fallbackEntries, laneId }) {
	const combined = [];
	const seen = new Set();

	const register = (entry) => {
		if (!entry || typeof entry !== "object") return;
		const branch = extractBranchResult(entry);
		const lane =
			entry?.lane_id ?? entry?.lane ?? entry?.outputs?.lane_id ?? branch?.lane_id ?? null;
		if (lane && lane !== laneId) {
			return;
		}
		const index =
			typeof branch?.file?.index === "number"
				? branch.file.index
				: typeof entry?.index === "number"
					? entry.index
					: undefined;
		const absolutePath =
			typeof branch?.file?.path === "string" && branch.file.path.length > 0
				? path.normalize(branch.file.path)
				: typeof branch?.file?.absolute_path === "string" &&
						branch.file.absolute_path.length > 0
					? path.normalize(branch.file.absolute_path)
					: undefined;
		const hasFileInfo = index !== undefined || absolutePath;
		const hasError = Boolean(entry && entry.error);
		if (!hasFileInfo && !hasError) {
			return;
		}
		const key =
			index !== undefined
				? `idx:${index}`
				: absolutePath
					? `path:${absolutePath}`
					: typeof entry?.step_id === "string"
						? `step:${entry.step_id}`
						: typeof entry?.__source_step === "string"
							? `src:${entry.__source_step}`
							: `seq:${combined.length}`;
		if (seen.has(key)) {
			return;
		}
		seen.add(key);
		combined.push({
			branch: branch ?? {},
			source: entry,
			index,
		});
	};

	(primaryEntries ?? []).forEach(register);
	(fallbackEntries ?? []).forEach(register);
	return combined;
}

function resolveWorkspaceRoot(startDir) {
	const explicit = process.env.AI_KOD_PROJECT_ROOT;
	if (typeof explicit === "string" && explicit.length > 0) {
		const resolved = path.isAbsolute(explicit) ? explicit : path.resolve(explicit);
		if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
			return resolved;
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

function runWriteToDb(commandArgs, options = {}) {
	const maxAttempts = options.maxAttempts ?? 5;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const result = spawnSync("pnpm", commandArgs, {
			cwd: options.cwd ?? process.cwd(),
			env: { ...process.env, ...(options.env ?? {}) },
			encoding: "utf8",
			stdio: ["inherit", "pipe", "pipe"],
		});

		if (result.stdout) {
			process.stdout.write(result.stdout);
		}
		if (result.stderr) {
			process.stderr.write(result.stderr);
		}

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
	if (records.length === 0) {
		return "";
	}
	return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

try {
	const stepRoot = process.cwd();
	const context = loadStageContext(stepRoot);
	const reportsDir = path.join(stepRoot, "reports");
	const tmpDir = path.join(stepRoot, "tmp");
	fs.mkdirSync(reportsDir, { recursive: true });
	fs.mkdirSync(tmpDir, { recursive: true });

	const summaryJsonPath = path.join(reportsDir, "code-summary.json");
	const summaryMdPath = path.join(reportsDir, "code-summary.md");
	const aggregatedPath = path.join(tmpDir, "code-processed.json");
	const outputStatePath = path.join(tmpDir, "code-summary-output.json");
	const outputYamlPath = path.join(stepRoot, "output.yaml");

	const primaryEntries = readArrayInput(context, "code_processed");
	const fanoutPath =
		getInputValue(context, "artefacts.fanout_items_path") ??
		findInputBySuffix(context, [
			"artefacts.fanout_items_path",
			"fanout_items_path",
			"code.fanout_items_path",
			"code.artefacts.fanout_items_path",
			"code_prepare.artefacts.fanout_items_path",
		]) ??
		null;
	const fanoutItems = loadFanoutItems(fanoutPath);
	const taskRoot = path.resolve(stepRoot, "..");
	const expectedPaths = fanoutItems
		.map((item) => (typeof item?.path === "string" ? path.normalize(item.path) : null))
		.filter((value) => typeof value === "string" && value.length > 0);
	const fallbackRecords = collectBranchResultsWithWait(
		taskRoot,
		PROCESS_FILENAME,
		LANE_ID,
		expectedPaths.length > 0 ? expectedPaths : undefined,
	);

	const laneRecords = collectLaneRecords({
		primaryEntries,
		fallbackEntries: fallbackRecords,
		laneId: LANE_ID,
	});

	if (laneRecords.length === 0) {
		throw new Error("code lane did not produce any branch results");
	}

	const outputs = [];
	let erroredBranches = 0;
	const processedIndexes = new Set();
	const entityTotals = { total: 0, documented: 0 };
	let importsTotal = 0;

	for (const entry of laneRecords) {
		const branchResult = entry.branch;
		const sourceRecord = entry.source ?? {};
		const resultIndex =
			typeof entry.index === "number"
				? entry.index
				: typeof branchResult?.file?.index === "number"
					? branchResult.file.index
					: undefined;
		if (typeof resultIndex === "number" && resultIndex >= 0) {
			processedIndexes.add(resultIndex);
		}
		if (sourceRecord && sourceRecord.error) {
			erroredBranches += 1;
			continue;
		}
		if (branchResult?.metrics) {
			entityTotals.total += Number(branchResult.metrics.total_entities ?? 0);
			entityTotals.documented += Number(branchResult.metrics.documented_entities ?? 0);
			importsTotal += Number(branchResult.metrics.imports ?? 0);
		}
		outputs.push(branchResult ?? {});
	}

	const breakdown = new Map();
	let failedChecks = 0;
	for (const out of outputs) {
		const ext =
			typeof out?.file?.extension === "string" && out.file.extension
				? out.file.extension.toLowerCase()
				: "unknown";
		breakdown.set(ext, (breakdown.get(ext) ?? 0) + 1);

		if (out?.checks?.exists === false || out?.checks?.size_mismatch === true) {
			failedChecks += 1;
		}
		if (Array.isArray(out?.deviations) && out.deviations.length > 0) {
			failedChecks += 1;
		}
	}

	const expectedTotal =
		toNumber(getInputValue(context, "metrics.code_files_count")) ??
		toNumber(
			findInputBySuffix(context, [
				"metrics.code_files_count",
				"code.metrics.code_files_count",
				"start.metrics.code_files_count",
			]),
		) ??
		(fanoutItems.length > 0 ? fanoutItems.length : outputs.length);

	const totalBranches = laneRecords.length;
	const successfulFiles = outputs.length;
	const missingIndices = [];
	if (fanoutItems.length > 0) {
		for (const item of fanoutItems) {
			const idx = typeof item?.index === "number" ? item.index : undefined;
			if (typeof idx === "number" && idx >= 0 && !processedIndexes.has(idx)) {
				missingIndices.push(idx);
			}
		}
	}

	fs.writeFileSync(aggregatedPath, JSON.stringify(outputs, null, 2));

	const summary = {
		generated_at: new Date().toISOString(),
		source: {
			list: getInputValue(context, "source_list") ?? findInputBySuffix(context, ["source_list"]),
			fanout_items_path: fanoutPath,
		},
		metrics: {
			expected_files: expectedTotal,
			fanout_items: fanoutItems.length,
			processed_branches: totalBranches,
			processed_files: successfulFiles,
			successful_files: successfulFiles,
			unique_extensions: breakdown.size,
			extension_breakdown: Object.fromEntries(breakdown),
			files_failed_checks: failedChecks,
			branch_errors: erroredBranches,
			missing_branch_indices: missingIndices,
			entity_totals: entityTotals.total,
			documented_entities: entityTotals.documented,
			imports_total: importsTotal,
		},
	};
	summary.metrics.total_files = summary.metrics.processed_files;

	fs.writeFileSync(summaryJsonPath, JSON.stringify(summary, null, 2));
	fs.writeFileSync(
		summaryMdPath,
		buildMarkdownReport(summary, missingIndices, failedChecks, erroredBranches),
	);

	const deviations = [];
	if (successfulFiles !== expectedTotal) {
		deviations.push({
			error: "count_mismatch",
			expected: expectedTotal,
			actual: successfulFiles,
		});
	}
	if (failedChecks > 0) {
		deviations.push({
			error: "failed_checks",
			files: failedChecks,
		});
	}
	if (erroredBranches > 0) {
		deviations.push({
			error: "branch_errors",
			count: erroredBranches,
		});
	}
	if (missingIndices.length > 0) {
		deviations.push({
			error: "missing_branch_results",
			indices: missingIndices,
		});
	}

	const hasBlocking = deviations.some((item) => (item.severity ?? "error") !== "info");
	const output = {
		status: hasBlocking ? "failed" : "success",
		lane_id: LANE_ID,
		metrics: summary.metrics,
		artefacts: {
			summary_json: summaryJsonPath,
			summary_report: summaryMdPath,
			processed_records: aggregatedPath,
		},
		deviations,
	};

	const workspaceRoot = resolveWorkspaceRoot(stepRoot);
	const globalRoot = fs.realpathSync(path.join(stepRoot, "global"));
	const analysisDir = path.join(globalRoot, "analysis");
	const logsDir = path.join(globalRoot, "logs");
	fs.mkdirSync(analysisDir, { recursive: true });
	fs.mkdirSync(logsDir, { recursive: true });

	const dbPath =
		getInputValue(context, "db_path") ??
		findInputBySuffix(context, ["db_path", "start.db_path"]);
	if (typeof dbPath !== "string" || dbPath.length === 0) {
		throw new Error("db_path input is required for code-summary ingestion");
	}

	const ingestionRecords = [];
	let ingestedFiles = 0;
	let rawEntities = 0;
	let rawRelationships = 0;
	for (const entry of outputs) {
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

	const ingestPath = path.join(analysisDir, "code-ingest.jsonl");
	fs.writeFileSync(ingestPath, toJsonLines(ingestionRecords));
	output.artefacts.ingest_jsonl = ingestPath;

	if (ingestionRecords.length > 0) {
		const logPath = path.join(logsDir, "code-write-to-db.log");
		output.artefacts.write_log = logPath;
		runWriteToDb(
			[
				"exec",
				"tsx",
				path.join(globalRoot, "bundle", "research-structure", "scripts/write-to-db.ts"),
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
			],
			{
				cwd: workspaceRoot ?? path.join(globalRoot, "bundle", "research-structure"),
			},
		);
	} else {
		output.deviations.push({
			error: "no_ingestion_records",
			message: "No code entities were produced for ingestion",
		});
		output.status = "failed";
	}

	fs.writeFileSync(outputStatePath, JSON.stringify(output, null, 2));
	writeYAML(outputYamlPath, output);
} catch (error) {
	console.error("code/summary.mjs failed:", error);
	process.exitCode = 1;
}
