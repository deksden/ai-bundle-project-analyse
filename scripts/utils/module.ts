import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Проверяет, что текущий модуль запущен как главный (через CLI),
 * учитывая запуск по симлинкам. Node обновляет import.meta.url до realpath,
 * поэтому сравниваем нормализованные realpath обеих сторон.
 */
export function isMainModule(metaUrl: string): boolean {
	if (!metaUrl) {
		return false;
	}

	const modulePath = fileURLToPath(metaUrl);
	const argvEntry = process.argv[1];
	if (!argvEntry) {
		return false;
	}

	const resolvedArgv = path.resolve(argvEntry);
	if (resolvedArgv === modulePath) {
		return true;
	}

	try {
		const realArgv = fs.realpathSync(resolvedArgv);
		const realModule = fs.realpathSync(modulePath);
		return realArgv === realModule;
	} catch {
		return false;
	}
}
