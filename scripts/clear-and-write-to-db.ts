import { isMainModule } from "./utils/module.js";

import { runWriteToDbCli, writeToDb } from "./write-to-db.ts";

export interface ClearAndWriteLegacyOptions {
	dbPath: string;
	taskId: string;
	ingestPath: string;
	source?: string;
}

export function clearAndWriteToDb(options: ClearAndWriteLegacyOptions) {
	return writeToDb(options);
}

async function runCli(): Promise<void> {
	await runWriteToDbCli("clear-and-write-to-db");
}

if (isMainModule(import.meta.url)) {
	void runCli();
}
