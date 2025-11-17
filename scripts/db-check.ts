import path from "node:path";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { setupLogWriter } from "./utils/logging.js";
import { isMainModule } from "./utils/module.js";
import { queryJson } from "./utils/sqlite.js";

interface TableRow {
	name: string;
}

function listTables(dbPath: string): string[] {
	const rows = queryJson<TableRow>(
		dbPath,
		"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
	);
	return rows.map((row) => row.name);
}

async function runCli(): Promise<void> {
	const argv = await yargs(hideBin(process.argv))
		.scriptName("db-check")
		.option("db_path", {
			type: "string",
			demandOption: true,
			describe: "Путь к SQLite базе данных",
		})
		.option("log_file", {
			type: "string",
			describe: "Путь для записи stdout/stderr (append)",
		})
		.help()
		.parseAsync();

	const restoreLog = setupLogWriter(argv.log_file);
	try {
		const tables = listTables(argv.db_path);
		const required = [
			"files",
			"raw_code_entities",
			"raw_doc_entities",
			"raw_doc_blocks",
			"raw_relationships",
			"result_entities",
			"result_relationships",
			"doc_matches",
			"runs",
			"entities",
			"relationships",
			"ingest_log",
		];
		const missing = required.filter((table) => !tables.includes(table));

		console.log(
			JSON.stringify(
				{
					message: "DB schema check",
					dbPath: argv.db_path,
					totalTables: tables.length,
					missingTables: missing,
				},
				null,
				2,
			),
		);

		if (missing.length > 0) {
			process.exitCode = 1;
		}
	} catch (error) {
		console.error("db-check failed:", error);
		process.exitCode = 1;
	} finally {
		restoreLog();
	}
}

if (isMainModule(import.meta.url)) {
	void runCli();
}
