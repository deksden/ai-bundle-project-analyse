import fs from "node:fs";
import path from "node:path";

import fg from "fast-glob";
import { ensureDirSync } from "fs-extra";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { spawnSync } from "node:child_process";

import { setupLogWriter } from "./utils/logging.js";
import { isMainModule } from "./utils/module.js";

export interface RemarkInput {
	path: string;
	scope: "file" | "dir" | "glob";
	recursive?: boolean;
	text: string;
}

interface PrepareRemarksOptions {
	projectRoot: string;
	dbPath: string;
	taskId: string;
	remarks: RemarkInput[];
	maxApplications?: number;
}

interface PrepareRemarksResult {
	totalRemarks: number;
	totalApplications: number;
	warnings: string[];
}

const DEFAULT_MAX_APPLICATIONS = 5000;

function escapeSqlValue(value: string | null | undefined): string {
	if (value == null) return "NULL";
	return `'${value.replace(/'/g, "''")}'`;
}

function runSql(dbPath: string, statements: string[]): void {
	const payload =
		statements
			.filter(Boolean)
			.map((stmt) => stmt.trim())
			.join(";\n") + ";\n";

	const result = spawnSync("sqlite3", [dbPath], { input: payload, encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(result.stderr || "sqlite3 command failed");
	}
}

function normalizePath(projectRoot: string, target: string): string {
	const absolute = path.isAbsolute(target) ? target : path.join(projectRoot, target);
	return path.relative(projectRoot, absolute).split(path.sep).join("/");
}

function resolveMatches(
	projectRoot: string,
	remark: RemarkInput,
): string[] {
	const normalizedBase = normalizePath(projectRoot, remark.path);
	const absoluteBase = path.join(projectRoot, normalizedBase);

	if (remark.scope === "file") {
		if (fs.existsSync(absoluteBase) && fs.statSync(absoluteBase).isFile()) {
			return [normalizedBase];
		}
		return [];
	}

	if (remark.scope === "dir") {
		const pattern = remark.recursive ? "**/*" : "*";
		const targetDir = absoluteBase.endsWith(path.sep)
			? absoluteBase
			: absoluteBase + path.sep;
		return fg
			.sync(pattern, {
				cwd: targetDir,
				onlyFiles: true,
				dot: false,
			})
			.map((file) => normalizePath(projectRoot, path.join(targetDir, file)));
	}

	// glob
	return fg
		.sync(remark.path, {
			cwd: projectRoot,
			onlyFiles: true,
			dot: false,
		})
		.map((file) => normalizePath(projectRoot, path.join(projectRoot, file)));
}

export function prepareRemarks(options: PrepareRemarksOptions): PrepareRemarksResult {
	const projectRoot = path.resolve(options.projectRoot);
	const dbPath = path.resolve(options.dbPath);
	const taskId = options.taskId;
	const maxApplications = options.maxApplications ?? DEFAULT_MAX_APPLICATIONS;

	ensureDirSync(path.dirname(dbPath));

	const warnings: string[] = [];
	const now = new Date().toISOString();

	const remarkRows: string[] = [];
	const appliesRows: string[] = [];

	for (const remark of options.remarks) {
		const matches = resolveMatches(projectRoot, remark);

		if (matches.length > maxApplications) {
			warnings.push(
				`Remark "${remark.text.slice(0, 32)}..." applies to ${matches.length} files (> ${maxApplications}). Trimmed.`,
			);
			matches.length = maxApplications;
		}

		const remarkInsert = `INSERT INTO remarks (run_id, path, scope, recursive, text, created_at)
VALUES (
  ${escapeSqlValue(taskId)},
  ${escapeSqlValue(normalizePath(projectRoot, remark.path))},
  ${escapeSqlValue(remark.scope)},
  ${remark.recursive ? 1 : 0},
  ${escapeSqlValue(remark.text)},
  ${escapeSqlValue(now)}
)`;
		remarkRows.push(remarkInsert);

		for (const filePath of matches) {
			appliesRows.push(
				`INSERT INTO remark_applies (remark_id, file_path, run_id) VALUES (last_insert_rowid(), ${escapeSqlValue(filePath)}, ${escapeSqlValue(taskId)})`,
			);
		}
	}

	const statements = ["BEGIN", ...remarkRows, ...appliesRows, "COMMIT"];

	runSql(dbPath, statements);

	return {
		totalRemarks: remarkRows.length,
		totalApplications: appliesRows.length,
		warnings,
	};
}

async function runCli(): Promise<void> {
	const argv = await yargs(hideBin(process.argv))
		.scriptName("prepare-remarks")
		.option("project_root", {
			type: "string",
			demandOption: true,
			describe: "Корень анализируемого проекта",
		})
		.option("db_path", {
			type: "string",
			demandOption: true,
			describe: "Путь к SQLite базе данных",
		})
		.option("task_id", {
			type: "string",
			demandOption: true,
			describe: "Идентификатор задачи (сохраняется в базе данных)",
		})
		.option("remarks_json", {
			type: "string",
			demandOption: true,
			describe: "JSON-строка или путь к файлу с массивом ремарок",
		})
		.option("max_applications", {
			type: "number",
			describe: "Максимальное количество применений для одной ремарки",
			default: DEFAULT_MAX_APPLICATIONS,
		})
		.option("log_file", {
			type: "string",
			describe: "Путь для записи stdout/stderr (append)",
		})
		.help()
		.parseAsync();

	const restoreLog = setupLogWriter(argv.log_file);

	let remarks: RemarkInput[] = [];
	try {
		if (fs.existsSync(argv.remarks_json)) {
			const content = fs.readFileSync(argv.remarks_json, "utf8");
			remarks = JSON.parse(content);
		} else {
			remarks = JSON.parse(argv.remarks_json);
		}
		if (!Array.isArray(remarks)) {
			throw new Error("remarks_json must be an array");
		}
	} catch (error) {
		console.error("prepare-remarks failed: cannot parse remarks_json", error);
		process.exitCode = 1;
		return;
	}

	try {
		const result = prepareRemarks({
			projectRoot: argv.project_root,
			dbPath: argv.db_path,
			taskId: argv.task_id,
			remarks,
			maxApplications: argv.max_applications,
		});

		console.log(
			JSON.stringify(
				{
					message: "Remarks processed",
					taskId: argv.task_id,
					remarks: result.totalRemarks,
					applies: result.totalApplications,
					warnings: result.warnings,
				},
				null,
				2,
			),
		);
		if (result.warnings.length > 0) {
			result.warnings.forEach((warning) => console.warn(warning));
		}
	} catch (error) {
		console.error("prepare-remarks failed:", error);
		process.exitCode = 1;
	} finally {
		restoreLog();
	}
}

if (isMainModule(import.meta.url)) {
	void runCli();
}
