import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";

import fg from "fast-glob";
import { ensureDirSync } from "fs-extra";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { setupLogWriter } from "./utils/logging.js";
import { isMainModule } from "./utils/module.js";

export type FileKind = "doc" | "code" | "config";

export interface IndexFilesOptions {
	projectRoot: string;
	dbPath: string;
	taskId: string;
	prevTaskId?: string;
	gitSha?: string;
}

export interface IndexFilesResult {
	taskId: string;
	gitSha: string | null;
	totalFiles: number;
	changedFiles: number;
	breakdown: Record<FileKind, number>;
}

interface IndexedFileRow {
	path: string;
	hash: string;
	size: number;
	kind: FileKind;
	isChanged: number;
}

const FILE_PATTERNS: Array<{ pattern: string; kind: FileKind }> = [
	{ pattern: "**/*.md", kind: "doc" },
	{ pattern: "**/*.{ts,tsx,js,jsx,py,go,rs}", kind: "code" },
	{ pattern: "**/*.{yaml,yml,json}", kind: "config" },
];

const IGNORE_GLOBS = [
	"**/node_modules/**",
	"**/.git/**",
	"**/.next/**",
	"**/dist/**",
	"**/build/**",
	"**/coverage/**",
	"**/analysis/**",
	"**/tmp/**",
	"**/.pnpm-store/**",
	"**/.tasks/**",
];

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


function queryJson<T = unknown>(dbPath: string, sql: string): T[] {
	const result = spawnSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(result.stderr || "sqlite3 query failed");
	}
	const trimmed = result.stdout.trim();
	return trimmed.length ? (JSON.parse(trimmed) as T[]) : [];
}

function computeHash(filePath: string): string {
	const data = fs.readFileSync(filePath);
	return crypto.createHash("sha256").update(data).digest("hex");
}

function resolveGitSha(projectRoot: string): string | null {
	try {
		const output = execSync("git rev-parse HEAD", { cwd: projectRoot, stdio: ["ignore", "pipe", "ignore"] });
		return output.toString().trim();
	} catch {
		return null;
	}
}

export async function indexFiles(options: IndexFilesOptions): Promise<IndexFilesResult> {
	const projectRoot = path.resolve(options.projectRoot);
	const dbPath = path.resolve(options.dbPath);

	if (!fs.existsSync(dbPath)) {
		throw new Error(`SQLite database not found at ${dbPath}. Run init-db first.`);
	}

	ensureDirSync(path.dirname(dbPath));

	const gitSha = options.gitSha ?? resolveGitSha(projectRoot);
	const prevRows =
		options.prevTaskId != null
			? queryJson<{ path: string; hash: string }>(
					dbPath,
					`SELECT path, hash FROM file_index WHERE run_id = ${escapeSqlValue(options.prevTaskId)}`,
				)
			: [];
	const prevMap = new Map(prevRows.map((row) => [row.path, row.hash]));

	const filesByPath = new Map<string, { absolute: string; kind: FileKind }>();

	for (const { pattern, kind } of FILE_PATTERNS) {
		const matches = await fg(pattern, {
			cwd: projectRoot,
			onlyFiles: true,
			unique: true,
			ignore: IGNORE_GLOBS,
			dot: false,
		});

		for (const relativePath of matches) {
			const normalized = relativePath.split(path.sep).join("/");
			if (!filesByPath.has(normalized)) {
				filesByPath.set(normalized, { absolute: path.join(projectRoot, relativePath), kind });
			}
		}
	}

	const breakdown: Record<FileKind, number> = { doc: 0, code: 0, config: 0 };
	const indexedRows: IndexedFileRow[] = [];

	for (const [relativePath, meta] of filesByPath.entries()) {
		const stats = fs.statSync(meta.absolute);
		const hash = computeHash(meta.absolute);
		const prevHash = prevMap.get(relativePath);
		const isChanged = options.prevTaskId ? (prevHash !== hash ? 1 : 0) : 1;

		indexedRows.push({ path: relativePath, hash, size: stats.size, kind: meta.kind, isChanged });
		breakdown[meta.kind] += 1;
	}

	const changedFiles = indexedRows.filter((row) => row.isChanged === 1).length;
	const nowIso = new Date().toISOString();

	const values = indexedRows
		.map((row) =>
			`(${escapeSqlValue(options.taskId)}, ${escapeSqlValue(row.path)}, ${escapeSqlValue(row.hash)}, ${row.size}, ${escapeSqlValue(row.kind)}, ${escapeSqlValue(gitSha)}, ${row.isChanged}, ${escapeSqlValue(nowIso)})`
		)
		.join(',\n');

	const statements = [
		"BEGIN",
		`INSERT INTO runs (id, project_root, created_at, prev_run_id, git_sha) VALUES (${escapeSqlValue(options.taskId)}, ${escapeSqlValue(projectRoot)}, ${escapeSqlValue(nowIso)}, ${escapeSqlValue(options.prevTaskId ?? null)}, ${escapeSqlValue(gitSha)}) ON CONFLICT(id) DO UPDATE SET project_root=excluded.project_root, prev_run_id=excluded.prev_run_id, git_sha=COALESCE(excluded.git_sha, runs.git_sha)`,
		`DELETE FROM file_index WHERE run_id = ${escapeSqlValue(options.taskId)}`,
	];

	if (indexedRows.length > 0) {
		statements.push(`INSERT INTO file_index (run_id, path, hash, size, kind, git_sha, is_changed, scanned_at) VALUES
${values}`);
	}

	statements.push("COMMIT");

	runSql(dbPath, statements);

	console.log(
		JSON.stringify(
			{
				message: "Files indexed",
				taskId: options.taskId,
				gitSha,
				total: indexedRows.length,
				changed: changedFiles,
				breakdown,
			},
			null,
			2,
		),
	);

	return {
		taskId: options.taskId,
		gitSha,
		totalFiles: indexedRows.length,
		changedFiles,
		breakdown,
	};
}

async function runCli(): Promise<void> {
	const argv = await yargs(hideBin(process.argv))
		.scriptName("index-files")
		.option("project_root", { type: "string", demandOption: true, describe: "Корень анализируемого проекта" })
		.option("db_path", { type: "string", demandOption: true, describe: "Путь к SQLite базе данных" })
		.option("task_id", { type: "string", demandOption: true, describe: "Идентификатор задачи (сохраняется в базе данных)" })
		.option("prev_task_id", { type: "string", describe: "Идентификатор предыдущей задачи для сравнения" })
		.option("git_sha", { type: "string", describe: "Git SHA состояния репозитория" })
		.option("log_file", {
			 type: "string",
			 describe: "Путь для записи stdout/stderr (append)",
		 })
		.help()
		.parseAsync();

const restoreLog = setupLogWriter(argv.log_file);
	try {
		await indexFiles({
			projectRoot: argv.project_root,
			dbPath: argv.db_path,
			taskId: argv.task_id,
			prevTaskId: argv.prev_task_id,
			gitSha: argv.git_sha,
		});
	} catch (error) {
		console.error("index-files failed:", error);
		process.exitCode = 1;
	} finally {
		restoreLog();
	}
}

if (isMainModule(import.meta.url)) {
	void runCli();
}
