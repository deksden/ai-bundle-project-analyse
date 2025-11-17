import path from "node:path";

import { ensureDirSync } from "fs-extra";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { setupLogWriter } from "./utils/logging.js";
import { isMainModule } from "./utils/module.js";
import { escapeSqlValue, queryJson, runSql } from "./utils/sqlite.js";

export interface InitDbOptions {
	projectRoot: string;
	dbPath: string;
	taskId?: string;
	prevTaskId?: string;
	gitSha?: string;
}

export interface InitDbResult {
	dbPath: string;
	tablesEnsured: string[];
	indexesEnsured: string[];
}

const TABLE_DEFINITIONS = [
	"CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, project_root TEXT NOT NULL, created_at TEXT NOT NULL, prev_run_id TEXT, git_sha TEXT, metadata TEXT)",
	"CREATE TABLE IF NOT EXISTS file_index (run_id TEXT NOT NULL, path TEXT NOT NULL, hash TEXT NOT NULL, size INTEGER NOT NULL, kind TEXT NOT NULL, git_sha TEXT, is_changed INTEGER NOT NULL DEFAULT 1, scanned_at TEXT NOT NULL, PRIMARY KEY (run_id, path), FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE)",
	"CREATE INDEX IF NOT EXISTS idx_file_index_path ON file_index(path)",
	"CREATE INDEX IF NOT EXISTS idx_file_index_kind ON file_index(kind)",
	"CREATE INDEX IF NOT EXISTS idx_file_index_git_sha ON file_index(git_sha)",
	"CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, kind TEXT NOT NULL, hash TEXT, hash_algorithm TEXT, size INTEGER, metadata TEXT, last_seen_run TEXT, first_seen_run TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
	"CREATE INDEX IF NOT EXISTS idx_files_kind ON files(kind)",
	"CREATE INDEX IF NOT EXISTS idx_files_last_seen_run ON files(last_seen_run)",
	"CREATE TABLE IF NOT EXISTS ingest_log (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, details TEXT, FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE)",
	"CREATE TABLE IF NOT EXISTS raw_code_entities (run_id TEXT NOT NULL, symbol_id TEXT NOT NULL, file_path TEXT NOT NULL, stable_key TEXT, kind TEXT, name TEXT, signature TEXT, start_offset INTEGER, end_offset INTEGER, line_start INTEGER, line_end INTEGER, content_hash TEXT, docblock_hash TEXT, hash TEXT, metadata TEXT, last_seen_run TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (run_id, symbol_id), FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE)",
	"CREATE INDEX IF NOT EXISTS idx_raw_code_entities_file ON raw_code_entities(file_path)",
	"CREATE INDEX IF NOT EXISTS idx_raw_code_entities_symbol ON raw_code_entities(symbol_id)",
	"CREATE INDEX IF NOT EXISTS idx_raw_code_entities_hash ON raw_code_entities(hash)",
	"CREATE TABLE IF NOT EXISTS raw_doc_entities (run_id TEXT NOT NULL, doc_id TEXT NOT NULL, document_path TEXT NOT NULL, heading TEXT, anchor TEXT, block_start_line INTEGER, block_end_line INTEGER, content_hash TEXT, hash TEXT, metadata TEXT, last_seen_run TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (run_id, doc_id), FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE)",
	"CREATE INDEX IF NOT EXISTS idx_raw_doc_entities_path ON raw_doc_entities(document_path)",
	"CREATE INDEX IF NOT EXISTS idx_raw_doc_entities_hash ON raw_doc_entities(hash)",
	"CREATE TABLE IF NOT EXISTS raw_doc_blocks (run_id TEXT NOT NULL, block_id TEXT NOT NULL, doc_id TEXT NOT NULL, document_path TEXT NOT NULL, block_index INTEGER, heading TEXT, content TEXT, content_hash TEXT, hash TEXT, metadata TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (run_id, block_id), FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE)",
	"CREATE INDEX IF NOT EXISTS idx_raw_doc_blocks_doc ON raw_doc_blocks(doc_id)",
	"CREATE INDEX IF NOT EXISTS idx_raw_doc_blocks_path ON raw_doc_blocks(document_path)",
	"CREATE TABLE IF NOT EXISTS raw_relationships (run_id TEXT NOT NULL, relationship_id TEXT NOT NULL, kind TEXT NOT NULL, source_symbol_id TEXT, target_symbol_id TEXT, source_path TEXT, target_path TEXT, metadata TEXT, hash TEXT, last_seen_run TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (run_id, relationship_id), FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE)",
	"CREATE INDEX IF NOT EXISTS idx_raw_relationships_source ON raw_relationships(source_symbol_id)",
	"CREATE INDEX IF NOT EXISTS idx_raw_relationships_target ON raw_relationships(target_symbol_id)",
	"CREATE TABLE IF NOT EXISTS result_entities (run_id TEXT NOT NULL, entity_id TEXT NOT NULL, entity_type TEXT NOT NULL, name TEXT NOT NULL, stable_key TEXT, coverage_status TEXT, confidence REAL, path TEXT, metadata TEXT, hash TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (run_id, entity_id), FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE)",
	"CREATE INDEX IF NOT EXISTS idx_result_entities_type ON result_entities(entity_type)",
	"CREATE INDEX IF NOT EXISTS idx_result_entities_path ON result_entities(path)",
	"CREATE TABLE IF NOT EXISTS result_relationships (run_id TEXT NOT NULL, relationship_id TEXT NOT NULL, kind TEXT NOT NULL, source_id TEXT NOT NULL, target_id TEXT NOT NULL, metadata TEXT, hash TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (run_id, relationship_id), FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE)",
	"CREATE INDEX IF NOT EXISTS idx_result_relationships_kind ON result_relationships(kind)",
	"CREATE TABLE IF NOT EXISTS doc_matches (run_id TEXT NOT NULL, doc_key TEXT NOT NULL, code_key TEXT NOT NULL, match_kind TEXT NOT NULL, confidence REAL, metadata TEXT, hash TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (run_id, doc_key, code_key), FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE)",
	"CREATE INDEX IF NOT EXISTS idx_doc_matches_code ON doc_matches(code_key)",
	"CREATE INDEX IF NOT EXISTS idx_doc_matches_doc ON doc_matches(doc_key)",
	"CREATE TABLE IF NOT EXISTS entities (run_id TEXT NOT NULL, entity_id TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL, fqn TEXT, path TEXT, metadata TEXT, PRIMARY KEY (run_id, entity_id), FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE)",
	"CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type)",
	"CREATE INDEX IF NOT EXISTS idx_entities_fqn ON entities(fqn)",
	"CREATE TABLE IF NOT EXISTS relationships (run_id TEXT NOT NULL, relationship_id TEXT NOT NULL, type TEXT NOT NULL, source_id TEXT NOT NULL, target_id TEXT NOT NULL, metadata TEXT, PRIMARY KEY (run_id, relationship_id), FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE)",
	"CREATE INDEX IF NOT EXISTS idx_relationships_type ON relationships(type)",
	"CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_id)",
	"CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_id)",
	"CREATE TABLE IF NOT EXISTS layers (run_id TEXT NOT NULL, layer_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT, metadata TEXT, PRIMARY KEY (run_id, layer_id), FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE)",
	"CREATE TABLE IF NOT EXISTS slices (run_id TEXT NOT NULL, slice_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT, metadata TEXT, PRIMARY KEY (run_id, slice_id), FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE)",
	"CREATE TABLE IF NOT EXISTS remarks (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, path TEXT NOT NULL, scope TEXT NOT NULL, recursive INTEGER NOT NULL DEFAULT 0, text TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE)",
	"CREATE TABLE IF NOT EXISTS remark_applies (remark_id INTEGER NOT NULL, file_path TEXT NOT NULL, run_id TEXT NOT NULL, FOREIGN KEY (remark_id) REFERENCES remarks(id) ON DELETE CASCADE, FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE)",
	"CREATE INDEX IF NOT EXISTS idx_remark_applies_remark ON remark_applies(remark_id)",
	"CREATE INDEX IF NOT EXISTS idx_remark_applies_file ON remark_applies(file_path)",
	"CREATE TABLE IF NOT EXISTS evidence (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, entity_id TEXT, relationship_id TEXT, payload TEXT, created_at TEXT NOT NULL, FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE)",
	"CREATE TABLE IF NOT EXISTS reports (run_id TEXT PRIMARY KEY, report_type TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE)",
	"CREATE TABLE IF NOT EXISTS coverage_summary (run_id TEXT PRIMARY KEY, files_total INTEGER NOT NULL DEFAULT 0, files_with_entities INTEGER NOT NULL DEFAULT 0, files_with_remarks INTEGER NOT NULL DEFAULT 0, remarks_total INTEGER NOT NULL DEFAULT 0, remark_applications_total INTEGER NOT NULL DEFAULT 0, entities_total INTEGER NOT NULL DEFAULT 0, relationships_total INTEGER NOT NULL DEFAULT 0, evidence_total INTEGER NOT NULL DEFAULT 0, layers_total INTEGER NOT NULL DEFAULT 0, slices_total INTEGER NOT NULL DEFAULT 0, doc_matches_total INTEGER NOT NULL DEFAULT 0, result_entities_total INTEGER NOT NULL DEFAULT 0, result_relationships_total INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE)",
	"CREATE TABLE IF NOT EXISTS run_metrics (run_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (run_id, key), FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE)",
];

interface ColumnDefinition {
	table: string;
	name: string;
	definition: string;
}

const COLUMN_DEFINITIONS: ColumnDefinition[] = [
	{
		table: "coverage_summary",
		name: "doc_matches_total",
		definition: "doc_matches_total INTEGER NOT NULL DEFAULT 0",
	},
	{
		table: "coverage_summary",
		name: "result_entities_total",
		definition: "result_entities_total INTEGER NOT NULL DEFAULT 0",
	},
	{
		table: "coverage_summary",
		name: "result_relationships_total",
		definition: "result_relationships_total INTEGER NOT NULL DEFAULT 0",
	},
];

function ensureTableColumns(dbPath: string, definitions: ColumnDefinition[]): void {
	for (const column of definitions) {
		const rows = queryJson<{ name: string }>(
			dbPath,
			`PRAGMA table_info(${column.table})`,
		);
		const exists = rows.some((row) => row.name === column.name);
		if (!exists) {
			runSql(dbPath, [`ALTER TABLE ${column.table} ADD COLUMN ${column.definition}`]);
		}
	}
}

export function initDatabase(options: InitDbOptions): InitDbResult {
	const projectRoot = path.resolve(options.projectRoot);
	const dbPath = path.resolve(options.dbPath);

	ensureDirSync(path.dirname(dbPath));

	runSql(dbPath, [
		"PRAGMA journal_mode=WAL",
		"PRAGMA busy_timeout=5000",
		"PRAGMA synchronous=NORMAL",
		"BEGIN",
		...TABLE_DEFINITIONS,
		"COMMIT",
	]);

	ensureTableColumns(dbPath, COLUMN_DEFINITIONS);

	if (options.taskId) {
		const createdAt = new Date().toISOString();
		runSql(dbPath, [
			`INSERT INTO runs (id, project_root, created_at, prev_run_id, git_sha) VALUES (${escapeSqlValue(options.taskId)}, ${escapeSqlValue(projectRoot)}, ${escapeSqlValue(createdAt)}, ${escapeSqlValue(options.prevTaskId ?? null)}, ${escapeSqlValue(options.gitSha ?? null)}) ON CONFLICT(id) DO UPDATE SET project_root=excluded.project_root, prev_run_id=excluded.prev_run_id, git_sha=COALESCE(excluded.git_sha, runs.git_sha)`,
		]);
	}

	const tables = queryJson<{ name: string }>(
		dbPath,
		"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
	).map((row) => row.name);

	const indexes = queryJson<{ name: string }>(
		dbPath,
		"SELECT name FROM sqlite_master WHERE type='index' ORDER BY name",
	).map((row) => row.name);

	return {
		dbPath,
		tablesEnsured: tables,
		indexesEnsured: indexes,
	};
}

async function runCli(): Promise<void> {
	const argv = await yargs(hideBin(process.argv))
		.scriptName("init-db")
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
		.option("task_id", { type: "string", describe: "Идентификатор задачи (сохраняется в базе данных)" })
		.option("prev_task_id", { type: "string", describe: "Идентификатор предыдущей задачи" })
		.option("git_sha", { type: "string", describe: "Git SHA состояния репозитория" })
		.option("log_file", {
			 type: "string",
			 describe: "Путь для записи stdout/stderr (append)",
		 })
		.help()
		.parseAsync();

const restoreLog = setupLogWriter(argv.log_file);

	try {
		const result = initDatabase({
			projectRoot: argv.project_root,
			dbPath: argv.db_path,
			taskId: argv.task_id,
			prevTaskId: argv.prev_task_id,
			gitSha: argv.git_sha,
		});

		console.log(
			JSON.stringify(
				{
					message: "SQLite schema ensured",
					dbPath: result.dbPath,
					tables: result.tablesEnsured.length,
					indexes: result.indexesEnsured.length,
				},
				null,
				2,
			),
		);
	} catch (error) {
		console.error("init-db failed:", error);
		process.exitCode = 1;
	} finally {
		restoreLog();
	}
}

if (isMainModule(import.meta.url)) {
	void runCli();
}
