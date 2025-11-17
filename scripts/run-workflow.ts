import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import fsExtra from "fs-extra";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { initDatabase } from "./init-db.ts";
import { indexFiles } from "./index-files.ts";
import { prepareRemarks, type RemarkInput } from "./prepare-remarks.ts";
import { clearAndWriteToDb } from "./clear-and-write-to-db.ts";
import { compactDb } from "./compact-db.ts";
import { enrichLinks } from "./enrich-links.ts";
import { exportSnapshot } from "./export-snapshot.ts";
import { generateStructureReport } from "./generate-structure-report.ts";
import { finalizeRun } from "./finalize-run.ts";
import { isMainModule } from "./utils/module.js";

const { ensureDirSync } = fsExtra;

interface RunOptions {
	projectRoot: string;
	taskId: string;
	dbPath: string;
	outputsDir: string;
	ingestPath: string;
	remarks: RemarkInput[];
	gitSha?: string;
	maxApplications?: number;
}

function resolveRemarks(source: string | undefined, projectRoot: string): RemarkInput[] {
	if (!source) return [];

	try {
		const potentialPath = path.isAbsolute(source)
			? source
			: path.join(projectRoot, source);
		if (fs.existsSync(potentialPath)) {
			return JSON.parse(fs.readFileSync(potentialPath, "utf8")) as RemarkInput[];
		}
		return JSON.parse(source) as RemarkInput[];
	} catch (error) {
		throw new Error(
			`Failed to parse remarks_json. Provide a JSON string or path to JSON file. ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

async function runPipeline(options: RunOptions): Promise<void> {
	const timings: Record<string, number> = {};
	function timeStep<T>(name: string, fn: () => Promise<T> | T): Promise<T> | T {
		const started = performance.now();
		const result = fn();
		const finalize = (success: boolean) => {
			const finished = performance.now();
			timings[name] = finished - started;
			const status = success ? "✅" : "❌";
			console.log(`${status} ${name} (${timings[name].toFixed(0)} ms)`);
		};
		if (result instanceof Promise) {
			return result
				.then((value) => {
					finalize(true);
					return value;
				})
				.catch((error) => {
					finalize(false);
					throw error;
				});
		}
		finalize(true);
		return result;
	}

	const absoluteProjectRoot = path.resolve(options.projectRoot);
	const absoluteDbPath = path.isAbsolute(options.dbPath)
		? options.dbPath
		: path.join(absoluteProjectRoot, options.dbPath);
	const absoluteOutputsDir = path.isAbsolute(options.outputsDir)
		? options.outputsDir
		: path.join(absoluteProjectRoot, options.outputsDir);
	const ingestPath = path.isAbsolute(options.ingestPath)
		? options.ingestPath
		: path.join(absoluteProjectRoot, options.ingestPath);

	if (!fs.existsSync(ingestPath)) {
		throw new Error(`Ingest file not found: ${ingestPath}`);
	}

	ensureDirSync(path.dirname(absoluteDbPath));

	console.log("🚀 Starting research-structure pipeline");
	console.log(
		JSON.stringify(
			{
				projectRoot: absoluteProjectRoot,
				taskId: options.taskId,
				dbPath: absoluteDbPath,
				outputsDir: absoluteOutputsDir,
				ingestPath,
				remarks: options.remarks.length,
				gitSha: options.gitSha ?? null,
			},
			null,
			2,
		),
	);

	timeStep("init-db", () =>
		initDatabase({
			projectRoot: absoluteProjectRoot,
			dbPath: absoluteDbPath,
			taskId: options.taskId,
		}),
	);

	await timeStep("index-files", () =>
		indexFiles({
			projectRoot: absoluteProjectRoot,
			dbPath: absoluteDbPath,
			taskId: options.taskId,
			gitSha: options.gitSha,
		}),
	);

	timeStep("prepare-remarks", () =>
		prepareRemarks({
			projectRoot: absoluteProjectRoot,
			dbPath: absoluteDbPath,
			taskId: options.taskId,
			remarks: options.remarks,
			maxApplications: options.maxApplications,
		}),
	);

	timeStep("clear-and-write-to-db", () =>
		clearAndWriteToDb({
			dbPath: absoluteDbPath,
			taskId: options.taskId,
			ingestPath,
			source: "bundle-run",
		}),
	);

	timeStep("compact-db", () => compactDb({ dbPath: absoluteDbPath, taskId: options.taskId }));

	const enrichResult = await timeStep("enrich-links", () =>
		enrichLinks({ dbPath: absoluteDbPath, taskId: options.taskId }),
	);

	const exportResult = timeStep("export-snapshot", () =>
		exportSnapshot({
			dbPath: absoluteDbPath,
			taskId: options.taskId,
			outputsDir: absoluteOutputsDir,
		}),
	);

	const reportResult = timeStep("generate-structure-report", () =>
		generateStructureReport({
			dbPath: absoluteDbPath,
			taskId: options.taskId,
			outputsDir: absoluteOutputsDir,
		}),
	);

	const finalizeResult = timeStep("finalize-run", () =>
		finalizeRun({
			dbPath: absoluteDbPath,
			taskId: options.taskId,
			outputsDir: absoluteOutputsDir,
		}),
	);

	console.log(
		JSON.stringify(
			{
				taskId: options.taskId,
				enriched: enrichResult,
				exportsDir: (await exportResult).exportsDir,
				reportPath: (await reportResult).reportPath,
				summaryPath: (await finalizeResult).summaryPath,
				timings,
			},
			null,
			2,
		),
	);
	console.log("🎉 research-structure pipeline completed");
}

async function runCli(): Promise<void> {
	const argv = await yargs(hideBin(process.argv))
		.scriptName("bundle:run")
		.option("project_root", {
			type: "string",
			demandOption: true,
			describe: "Корень анализируемого репозитория",
		})
		.option("ingest_path", {
			type: "string",
			demandOption: true,
			describe: "Путь к JSONL с результатами анализа (entities/relationships/...)",
		})
		.option("task_id", {
			type: "string",
			describe: "Идентификатор задачи (по умолчанию генерируется)",
		})
		.option("db_path", {
			type: "string",
			default: "analysis/analysis.db",
			describe: "Путь к SQLite базе (относительно project_root)",
		})
		.option("outputs_dir", {
			type: "string",
			default: "analysis",
			describe: "Папка для экспортов и отчётов (относительно project_root)",
		})
		.option("remarks_json", {
			type: "string",
			describe: "JSON строка или путь к файлу с массивом ремарок",
		})
		.option("git_sha", {
			type: "string",
			describe: "Git SHA состояния репозитория",
		})
		.option("max_applications", {
			type: "number",
			describe: "Лимит применений ремарки (делегируется prepare-remarks)",
		})
		.help()
		.parseAsync();

	const taskId = argv.task_id ?? `task-${Date.now()}`;
	const remarks = resolveRemarks(argv.remarks_json, argv.project_root);

	try {
		await runPipeline({
			projectRoot: argv.project_root,
			taskId,
			dbPath: argv.db_path,
			outputsDir: argv.outputs_dir,
			ingestPath: argv.ingest_path,
			remarks,
			gitSha: argv.git_sha,
			maxApplications: argv.max_applications,
		});
	} catch (error) {
		console.error("❌ pipeline failed:", error);
		process.exitCode = 1;
	}
}

if (isMainModule(import.meta.url)) {
	void runCli();
}
