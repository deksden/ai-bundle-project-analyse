import path from "node:path";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { setupLogWriter } from "./utils/logging.js";
import { isMainModule } from "./utils/module.js";
import { escapeSqlValue, runSql } from "./utils/sqlite.js";

interface MaintenanceOptions {
	dbPath: string;
	logFile?: string;
}

function cleanFile(dbPath: string, filePath: string): void {
	const normalizedPath = path.resolve(filePath);
	const escaped = escapeSqlValue(normalizedPath);
	runSql(dbPath, [
		"BEGIN",
		`DELETE FROM doc_matches WHERE doc_key IN (
			SELECT doc_id FROM raw_doc_entities WHERE document_path=${escaped}
		)`,
		`DELETE FROM doc_matches WHERE code_key IN (
			SELECT symbol_id FROM raw_code_entities WHERE file_path=${escaped}
		)`,
		`DELETE FROM raw_relationships WHERE relationship_id IN (
			SELECT relationship_id FROM raw_relationships
			WHERE source_symbol_id IN (SELECT symbol_id FROM raw_code_entities WHERE file_path=${escaped})
			   OR target_symbol_id IN (SELECT symbol_id FROM raw_code_entities WHERE file_path=${escaped})
		)`,
		`DELETE FROM raw_doc_blocks WHERE document_path=${escaped}`,
		`DELETE FROM raw_doc_entities WHERE document_path=${escaped}`,
		`DELETE FROM raw_code_entities WHERE file_path=${escaped}`,
		`DELETE FROM files WHERE path=${escaped}`,
		"COMMIT",
	]);
}

function cleanRun(dbPath: string, runId: string): void {
	const escapedRun = escapeSqlValue(runId);
	runSql(dbPath, [
		"BEGIN",
		`DELETE FROM raw_code_entities WHERE run_id=${escapedRun}`,
		`DELETE FROM raw_doc_entities WHERE run_id=${escapedRun}`,
		`DELETE FROM raw_doc_blocks WHERE run_id=${escapedRun}`,
		`DELETE FROM raw_relationships WHERE run_id=${escapedRun}`,
		`DELETE FROM result_entities WHERE run_id=${escapedRun}`,
		`DELETE FROM result_relationships WHERE run_id=${escapedRun}`,
		`DELETE FROM doc_matches WHERE run_id=${escapedRun}`,
		`DELETE FROM entities WHERE run_id=${escapedRun}`,
		`DELETE FROM relationships WHERE run_id=${escapedRun}`,
		`DELETE FROM layers WHERE run_id=${escapedRun}`,
		`DELETE FROM slices WHERE run_id=${escapedRun}`,
		`DELETE FROM evidence WHERE run_id=${escapedRun}`,
		`DELETE FROM ingest_log WHERE run_id=${escapedRun}`,
		`DELETE FROM file_index WHERE run_id=${escapedRun}`,
		`DELETE FROM coverage_summary WHERE run_id=${escapedRun}`,
		`DELETE FROM run_metrics WHERE run_id=${escapedRun}`,
		`DELETE FROM runs WHERE id=${escapedRun}`,
		`UPDATE files SET last_seen_run=NULL WHERE last_seen_run=${escapedRun}`,
		"COMMIT",
	]);
}

function resetDatabase(dbPath: string): void {
	runSql(dbPath, [
		"BEGIN",
		"DELETE FROM raw_code_entities",
		"DELETE FROM raw_doc_entities",
		"DELETE FROM raw_doc_blocks",
		"DELETE FROM raw_relationships",
		"DELETE FROM result_entities",
		"DELETE FROM result_relationships",
		"DELETE FROM doc_matches",
		"DELETE FROM entities",
		"DELETE FROM relationships",
		"DELETE FROM layers",
		"DELETE FROM slices",
		"DELETE FROM evidence",
		"DELETE FROM files",
		"DELETE FROM file_index",
		"DELETE FROM ingest_log",
		"DELETE FROM coverage_summary",
		"DELETE FROM run_metrics",
		"DELETE FROM remarks",
		"DELETE FROM remark_applies",
		"DELETE FROM runs",
		"COMMIT",
		"VACUUM",
	]);
}

async function runCli(): Promise<void> {
	const argv = await yargs(hideBin(process.argv))
		.scriptName("db-maintenance")
		.option("db_path", {
			type: "string",
			demandOption: true,
			describe: "Путь к SQLite базе данных",
		})
		.option("log_file", {
			type: "string",
			describe: "Путь для записи stdout/stderr (append)",
		})
		.command(
			"clean-file <file_path>",
			"Удалить данные, связанные с файлом",
			(y) =>
				y.positional("file_path", {
					type: "string",
					describe: "Абсолютный путь к файлу или документу",
				}),
			(args) => {
				const restoreLog = setupLogWriter(args.log_file);
				try {
					cleanFile(args.db_path, args.file_path as string);
					console.log(
						JSON.stringify(
							{ message: "File cleaned", filePath: path.resolve(args.file_path as string) },
							null,
							2,
						),
					);
				} finally {
					restoreLog();
				}
			},
		)
		.command(
			"clean-run <run_id>",
			"Удалить данные указанного run_id",
			(y) =>
				y.positional("run_id", {
					type: "string",
					describe: "Идентификатор задачи (run_id)",
				}),
			(args) => {
				const restoreLog = setupLogWriter(args.log_file);
				try {
					cleanRun(args.db_path, args.run_id as string);
					console.log(
						JSON.stringify({ message: "Run cleaned", runId: args.run_id }, null, 2),
					);
				} finally {
					restoreLog();
				}
			},
		)
		.command(
			"reset-db",
			"Очистить все таблицы (использовать осторожно)",
			(y) => y,
			(args) => {
				const restoreLog = setupLogWriter(args.log_file);
				try {
					resetDatabase(args.db_path);
					console.log(JSON.stringify({ message: "Database reset" }, null, 2));
				} finally {
					restoreLog();
				}
			},
		)
		.demandCommand(1)
		.help()
		.parseAsync();
}

if (isMainModule(import.meta.url)) {
	void runCli();
}
