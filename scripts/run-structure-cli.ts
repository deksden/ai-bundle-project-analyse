import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const bundleRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(bundleRoot, "..");
const demoRoot = path.resolve(bundleRoot, "examples", "research-structure-demo");

interface CliArgs {
	projectRoot?: string;
	ingestPath?: string;
	remarksJson?: string;
	outputDir?: string;
	gitSha?: string;
	keepTemp?: boolean;
	maxApplications?: number;
}

function ensureDir(target: string): void {
	if (!fs.existsSync(target)) {
		fs.mkdirSync(target, { recursive: true });
	}
}

function copyDirectory(source: string, destination: string): void {
	ensureDir(path.dirname(destination));
	if (fs.existsSync(destination)) {
		fs.rmSync(destination, { recursive: true, force: true });
	}
	fs.cpSync(source, destination, { recursive: true });
}

function resolveIngestPath(projectRoot: string, cliValue?: string): string {
	if (cliValue && cliValue.trim().length > 0) {
		const candidate = path.isAbsolute(cliValue)
			? cliValue
			: path.join(projectRoot, cliValue);
		if (!fs.existsSync(candidate)) {
			throw new Error(`Ingest file not found: ${candidate}`);
		}
		return path.resolve(candidate);
	}

	const projectIngest = path.join(projectRoot, "ingest.jsonl");
	if (fs.existsSync(projectIngest)) {
		return path.resolve(projectIngest);
	}

	const demoIngest = path.join(demoRoot, "ingest.jsonl");
	if (!fs.existsSync(demoIngest)) {
		throw new Error("Default ingest.jsonl is missing in bundle examples");
	}

	return path.resolve(demoIngest);
}

function resolveRemarks(projectRoot: string, cliValue?: string): unknown[] {
	if (cliValue && cliValue.trim().length > 0) {
		const candidate = path.isAbsolute(cliValue)
			? cliValue
			: path.join(projectRoot, cliValue);
		if (fs.existsSync(candidate)) {
			return JSON.parse(fs.readFileSync(candidate, "utf8")) as unknown[];
		}
		try {
			return JSON.parse(cliValue) as unknown[];
		} catch (error) {
			throw new Error(
				`Failed to parse remarks_json. Provide JSON or path to file. ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	const projectRemarks = path.join(projectRoot, "remarks.json");
	if (fs.existsSync(projectRemarks)) {
		return JSON.parse(fs.readFileSync(projectRemarks, "utf8")) as unknown[];
	}

	const demoRemarks = path.join(demoRoot, "remarks.json");
	if (fs.existsSync(demoRemarks)) {
		return JSON.parse(fs.readFileSync(demoRemarks, "utf8")) as unknown[];
	}

	return [];
}

function listTaskDirectories(): Array<{ taskId: string; fullPath: string; mtime: number }> {
	const tasksDir = path.join(repoRoot, ".tasks");
	if (!fs.existsSync(tasksDir)) {
		return [];
	}

	return fs
		.readdirSync(tasksDir)
		.map((name) => ({ name, fullPath: path.join(tasksDir, name) }))
		.filter(({ fullPath }) => {
			try {
				return fs.statSync(fullPath).isDirectory();
			} catch {
				return false;
			}
		})
		.map(({ name, fullPath }) => ({
			taskId: name,
			fullPath,
			mtime: fs.statSync(fullPath).mtimeMs,
		}))
		.sort((a, b) => b.mtime - a.mtime);
}

function findNewTaskGlobalRoot(previousTasks: Set<string>): { taskId: string; globalRoot: string } | null {
	const candidates = listTaskDirectories();
	for (const candidate of candidates) {
		if (previousTasks.size === 0 || !previousTasks.has(candidate.taskId)) {
			const globalRoot = path.join(candidate.fullPath, "global");
			if (fs.existsSync(globalRoot)) {
				return { taskId: candidate.taskId, globalRoot };
			}
		}
	}

	if (candidates.length > 0) {
		const globalRoot = path.join(candidates[0].fullPath, "global");
		if (fs.existsSync(globalRoot)) {
			return { taskId: candidates[0].taskId, globalRoot };
		}
	}

	return null;
}

function copyGlobalArtifacts(globalRoot: string, destination: string): void {
	ensureDir(destination);
	const entries = fs.readdirSync(globalRoot, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.name === "bundle" || entry.name === "shared") continue;
		const source = path.join(globalRoot, entry.name);
		const target = path.join(destination, entry.name);
		copyDirectory(source, target);
	}
}

async function runWorkflowCommand(args: CliArgs): Promise<void> {
	const projectRoot = path.resolve(
		args.projectRoot ?? path.join(bundleRoot, "examples", "research-structure-demo"),
	);
	if (!fs.existsSync(projectRoot)) {
		throw new Error(`Project root does not exist: ${projectRoot}`);
	}

	const ingestPath = resolveIngestPath(projectRoot, args.ingestPath);
	const remarks = resolveRemarks(projectRoot, args.remarksJson);
	const gitSha = args.gitSha ?? "";
	const outputsDir = args.outputDir ?? "";
	const tasksBefore = new Set(listTaskDirectories().map((entry) => entry.taskId));

	const payload = {
		project_root: projectRoot,
		ingest_path: ingestPath,
		remarks,
		git_sha: gitSha,
		db_path: "shared/research-structure/analysis.db",
		outputs_dir: "analysis",
		max_applications: args.maxApplications,
	};

	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-kod-structure-"));
	const inputsFile = path.join(tempDir, "structure-inputs.json");
	fs.writeFileSync(inputsFile, JSON.stringify(payload, null, 2));

	const cliArgs = [
		"--filter",
		"@ai-kod/cli",
		"exec",
		"--",
		"ai-kod",
		"run",
		"research-structure",
		"--inputs",
		inputsFile,
		"--wait",
		"--stream",
		"events",
		"--verbosity",
		"steps",
	];

	const result = spawnSync("pnpm", cliArgs, {
		cwd: repoRoot,
		stdio: "inherit",
		env: process.env,
	});

	let artifactsCopied = false;

	if (!result.error && result.status === 0 && outputsDir) {
		const match = findNewTaskGlobalRoot(tasksBefore);
		if (match) {
			const destination = path.resolve(outputsDir);
			ensureDir(destination);
			const target = path.join(destination, match.taskId);
			copyGlobalArtifacts(match.globalRoot, target);
			console.log(
				`[bundle:structure] global artifacts from ${match.taskId} copied to ${target}`,
			);
			artifactsCopied = true;
		} else {
			console.warn(
				"[bundle:structure] workflow finished, но global артефакты не найдены в .tasks — проверьте логи",
			);
		}
	}

	fs.rmSync(tempDir, { recursive: true, force: true });

	if (result.error) {
		throw result.error;
	}

	if (result.status !== 0) {
		throw new Error(`Workflow execution failed with status ${result.status}`);
	}

	if (!artifactsCopied && outputsDir) {
		console.warn(
			`[bundle:structure] Output directory '${outputsDir}' был указан, но артефакты не скопированы.`,
		);
	}
}

function runCleanup(dbPath: string, filePath?: string): void {
	if (!fs.existsSync(dbPath)) {
		throw new Error(`analysis.db not found: ${dbPath}`);
	}
	const statements: string[] = ["BEGIN"];
	if (filePath) {
		const escaped = filePath.replace(/'/g, "''");
		statements.push(
			`DELETE FROM raw_code_entities WHERE file_path=${`'${escaped}'`}`,
			`DELETE FROM raw_relationships WHERE source_path=${`'${escaped}'`} OR target_path=${`'${escaped}'`}`,
			`DELETE FROM result_entities WHERE path=${`'${escaped}'`}`,
			`DELETE FROM file_index WHERE path=${`'${escaped}'`}`,
			`DELETE FROM files WHERE path=${`'${escaped}'`}`,
		);
	} else {
		statements.push(
			"DELETE FROM raw_relationships",
			"DELETE FROM raw_code_entities",
			"DELETE FROM raw_doc_entities",
			"DELETE FROM raw_doc_blocks",
			"DELETE FROM result_relationships",
			"DELETE FROM result_entities",
			"DELETE FROM files",
			"DELETE FROM file_index",
			"DELETE FROM doc_matches",
			"DELETE FROM coverage_summary",
			"DELETE FROM run_metrics",
			"DELETE FROM runs",
		);
	}
	statements.push("COMMIT");
	const payload = `${statements.join(";\n")};\n`;
	const result = spawnSync("sqlite3", [dbPath], { input: payload, encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(result.stderr || "cleanup failed");
	}
	if (filePath) {
		console.log(`[bundle:structure] cleaned records for file: ${filePath}`);
	} else {
		console.log("[bundle:structure] database cleaned");
	}
}

async function main(): Promise<void> {
	const argv = (await yargs(hideBin(process.argv))
		.scriptName("bundle:structure")
		.command(
			"run",
			"Запустить research-structure workflow",
			(y) =>
				y
					.option("project-root", { type: "string", describe: "Каталог анализируемого проекта" })
					.option("ingest-path", { type: "string", describe: "Путь к ingest JSONL" })
					.option("remarks-json", { type: "string", describe: "Путь или JSON ремарок" })
					.option("output-dir", { type: "string", describe: "Куда скопировать артефакты global/" })
					.option("git-sha", { type: "string", describe: "Git SHA состояния проекта" })
					.option("max-applications", { type: "number", describe: "Лимит применений ремарок" }),
			async (args) => {
				await runWorkflowCommand(args as CliArgs);
			},
		)
		.command(
			"clean-db",
			"Очистить analysis.db полностью или по файлу",
			(y) =>
				y
					.option("db-path", {
						type: "string",
						default: path.join(bundleRoot, "shared", "analysis", "analysis.db"),
						describe: "Путь к analysis.db",
					})
					.option("file", {
						type: "string",
						describe: "Абсолютный путь файла, для которого нужно удалить сущности",
					}),
			(args) => {
				runCleanup(path.resolve(args.dbPath as string), args.file as string | undefined);
			},
		)
		.demandCommand(1)
		.option("project-root", {
			type: "string",
			describe: "Каталог анализируемого проекта (по умолчанию используется демо из бандла)",
		})
		.option("ingest-path", {
			type: "string",
			describe: "Путь к ingest JSONL (если не указан — берётся из проекта или демо)",
		})
		.option("remarks-json", {
			type: "string",
			describe: "Путь к remarks.json или JSON-строка с ремарками",
		})
		.option("output-dir", {
			type: "string",
			describe: "Каталог, куда скопировать артефакты из task/global после выполнения",
		})
		.option("git-sha", {
			type: "string",
			describe: "Git SHA состояния проекта",
		})
		.option("max-applications", {
			type: "number",
			describe: "Порог применений ремарок (проксируется в prepare-remarks)",
		})
		.help().parseAsync()) as CliArgs;

	const projectRoot = path.resolve(
		argv.projectRoot ?? path.join(bundleRoot, "examples", "research-structure-demo"),
	);
	if (!fs.existsSync(projectRoot)) {
		throw new Error(`Project root does not exist: ${projectRoot}`);
	}

	const ingestPath = resolveIngestPath(projectRoot, argv.ingestPath);
	const remarks = resolveRemarks(projectRoot, argv.remarksJson);
	const gitSha = argv.gitSha ?? "";
	const outputsDir = argv.outputDir ?? "";
	const tasksBefore = new Set(listTaskDirectories().map((entry) => entry.taskId));

	const payload = {
		project_root: projectRoot,
		ingest_path: ingestPath,
		remarks,
		git_sha: gitSha,
		db_path: "shared/research-structure/analysis.db",
		outputs_dir: "analysis",
		max_applications: argv.maxApplications,
	};

	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-kod-structure-"));
	const inputsFile = path.join(tempDir, "structure-inputs.json");
	fs.writeFileSync(inputsFile, JSON.stringify(payload, null, 2));

	const cliArgs = [
		"--filter",
		"@ai-kod/cli",
		"exec",
		"--",
		"ai-kod",
		"run",
		"research-structure",
		"--inputs",
		inputsFile,
		"--wait",
		"--stream",
		"events",
		"--verbosity",
		"steps",
	];

	const result = spawnSync("pnpm", cliArgs, {
		cwd: repoRoot,
		stdio: "inherit",
		env: process.env,
	});

	let artifactsCopied = false;

	if (!result.error && result.status === 0 && outputsDir) {
		const match = findNewTaskGlobalRoot(tasksBefore);
		if (match) {
			const destination = path.resolve(outputsDir);
			ensureDir(destination);
			const target = path.join(destination, match.taskId);
			copyGlobalArtifacts(match.globalRoot, target);
			console.log(
				`[bundle:structure] global artifacts from ${match.taskId} copied to ${target}`,
			);
			artifactsCopied = true;
		} else {
			console.warn(
				"[bundle:structure] workflow finished, но global артефакты не найдены в .tasks — проверьте логи",
			);
		}
	}

	fs.rmSync(tempDir, { recursive: true, force: true });

	if (result.error) {
		throw result.error;
	}

	if (result.status !== 0) {
		throw new Error(`Workflow execution failed with status ${result.status}`);
	}

	if (!artifactsCopied && outputsDir) {
		console.warn(
			`[bundle:structure] Output directory '${outputsDir}' был указан, но артефакты не скопированы.`,
		);
	}
}

try {
	await main();
} catch (error) {
	console.error("[bundle:structure] failed:", error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
