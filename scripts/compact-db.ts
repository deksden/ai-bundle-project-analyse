import { spawnSync } from "node:child_process";
import path from "node:path";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { setupLogWriter } from "./utils/logging.js";
import { isMainModule } from "./utils/module.js";
import { escapeSqlValue, queryJson, runSql } from "./utils/sqlite.js";

interface CompactDbOptions {
	dbPath: string;
	taskId: string;
}

interface CompactDbResult {
	taskId: string;
	removedProcessingLogs: number;
	removedRemarkOrphans: number;
	removedEmptyEvidence: number;
	removedRawCode: number;
	removedRawDocs: number;
	removedRawBlocks: number;
	removedRawRelationships: number;
	removedResultEntities: number;
	removedResultRelationships: number;
	removedDocMatches: number;
	removedStaleFiles: number;
	durationMs: number;
}

function runPragma(dbPath: string, pragma: string): void {
	const result = spawnSync("sqlite3", [dbPath, pragma], { encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(result.stderr || `sqlite3 command failed: ${pragma}`);
	}
}

function queryCount(dbPath: string, sql: string): number {
	const rows = queryJson<{ count: number }>(dbPath, sql);
	return rows[0]?.count ?? 0;
}

function deleteOrphans(dbPath: string, tableName: string, column = "run_id"): number {
	const count = queryCount(
		dbPath,
		`SELECT COUNT(*) AS count FROM ${tableName} WHERE ${column} NOT IN (SELECT id FROM runs)`,
	);
	if (count > 0) {
		runSql(dbPath, [
			`DELETE FROM ${tableName} WHERE ${column} NOT IN (SELECT id FROM runs)`,
		]);
	}
	return count;
}

export function compactDb(options: CompactDbOptions): CompactDbResult {
	const dbPath = path.resolve(options.dbPath);
	const taskIdValue = escapeSqlValue(options.taskId);

	const processingBefore = queryCount(
		dbPath,
		`SELECT COUNT(*) AS count FROM ingest_log WHERE run_id=${taskIdValue} AND status='processing'`,
	);
	const orphanAppliesBefore = queryCount(
		dbPath,
		`SELECT COUNT(*) AS count FROM remark_applies WHERE run_id=${taskIdValue} AND remark_id NOT IN (SELECT id FROM remarks WHERE run_id=${taskIdValue})`,
	);
	const emptyEvidenceBefore = queryCount(
		dbPath,
		`SELECT COUNT(*) AS count FROM evidence WHERE run_id=${taskIdValue} AND (payload IS NULL OR payload='')`,
	);

	runSql(dbPath, [
		"BEGIN",
		`DELETE FROM ingest_log WHERE run_id=${taskIdValue} AND status='processing'`,
		`DELETE FROM remark_applies WHERE run_id=${taskIdValue} AND remark_id NOT IN (SELECT id FROM remarks WHERE run_id=${taskIdValue})`,
		`DELETE FROM evidence WHERE run_id=${taskIdValue} AND (payload IS NULL OR payload='')`,
		"COMMIT",
	]);

	const start = Date.now();
	runPragma(dbPath, "PRAGMA wal_checkpoint(TRUNCATE)");
	runPragma(dbPath, "PRAGMA optimize");
	runPragma(dbPath, "ANALYZE");
	runPragma(dbPath, "VACUUM");
	const durationMs = Date.now() - start;

	const removedRawCode = deleteOrphans(dbPath, "raw_code_entities");
	const removedRawDocs = deleteOrphans(dbPath, "raw_doc_entities");
	const removedRawBlocks = deleteOrphans(dbPath, "raw_doc_blocks");
	const removedRawRelationships = deleteOrphans(dbPath, "raw_relationships");
	const removedResultEntities = deleteOrphans(dbPath, "result_entities");
	const removedResultRelationships = deleteOrphans(dbPath, "result_relationships");
	const removedDocMatches = deleteOrphans(dbPath, "doc_matches");
	const removedStaleFiles = (() => {
		const count = queryCount(
			dbPath,
			"SELECT COUNT(*) AS count FROM files WHERE last_seen_run IS NOT NULL AND last_seen_run NOT IN (SELECT id FROM runs)",
		);
		if (count > 0) {
			runSql(dbPath, [
				"DELETE FROM files WHERE last_seen_run IS NOT NULL AND last_seen_run NOT IN (SELECT id FROM runs)",
			]);
		}
		return count;
	})();

	return {
		taskId: options.taskId,
		removedProcessingLogs: processingBefore,
		removedRemarkOrphans: orphanAppliesBefore,
		removedEmptyEvidence: emptyEvidenceBefore,
		removedRawCode,
		removedRawDocs,
		removedRawBlocks,
		removedRawRelationships,
		removedResultEntities,
		removedResultRelationships,
		removedDocMatches,
		removedStaleFiles,
		durationMs,
	};
}

async function runCli(): Promise<void> {
	const argv = await yargs(hideBin(process.argv))
		.scriptName("compact-db")
		.option("db_path", {
			type: "string",
			demandOption: true,
			describe: "Путь к SQLite базе данных",
		})
		.option("task_id", {
			type: "string",
			demandOption: true,
			describe: "Идентификатор задачи (для логирования и метрик)",
		})
		.option("log_file", {
			type: "string",
			describe: "Путь для записи stdout/stderr (append)",
		})
		.help()
		.parseAsync();

	const restoreLog = setupLogWriter(argv.log_file);
	try {
		const result = compactDb({
			dbPath: argv.db_path,
			taskId: argv.task_id,
		});

		console.log(
			JSON.stringify(
				{
					message: "Database compacted",
					taskId: result.taskId,
					removedProcessingLogs: result.removedProcessingLogs,
					removedRemarkOrphans: result.removedRemarkOrphans,
					removedEmptyEvidence: result.removedEmptyEvidence,
					removedRaw: {
						code: result.removedRawCode,
						docs: result.removedRawDocs,
						blocks: result.removedRawBlocks,
						relationships: result.removedRawRelationships,
					},
					removedResult: {
						entities: result.removedResultEntities,
						relationships: result.removedResultRelationships,
					},
					removedDocMatches: result.removedDocMatches,
					removedStaleFiles: result.removedStaleFiles,
					durationMs: result.durationMs,
				},
				null,
				2,
			),
		);
	} catch (error) {
		console.error("compact-db failed:", error);
		process.exitCode = 1;
	} finally {
		restoreLog();
	}
}

if (isMainModule(import.meta.url)) {
	void runCli();
}
