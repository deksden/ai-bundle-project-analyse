#!/usr/bin/env tsx
/**
 * Очистка разделяемых артефактов research-structure из task/global/shared.
 *
 * Удаляет содержимое каталога `<global-root>/shared/research-structure/`,
 * сохраняя сам каталог. Полезно для ручного сброса shared-базы между экспериментами.
 *
 * Запуск:
 *   pnpm tsx scripts/clean-structure-shared.ts --global-root "<путь к TASK-XXX/global>"
 */

import fs from "node:fs/promises";
import path from "node:path";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { isMainModule } from "./utils/module.js";

async function pathExists(target: string): Promise<boolean> {
	try {
		await fs.access(target);
		return true;
	} catch {
		return false;
	}
}

async function ensureDir(target: string): Promise<void> {
	if (!(await pathExists(target))) {
		await fs.mkdir(target, { recursive: true });
	}
}

async function cleanShared(globalRoot: string): Promise<void> {
	const sharedRoot = path.join(globalRoot, "shared", "research-structure");
	if (!(await pathExists(sharedRoot))) {
		console.log(`ℹ️ Shared каталог отсутствует: ${sharedRoot}`);
		return;
	}

	const entries = await fs.readdir(sharedRoot, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = path.join(sharedRoot, entry.name);
		await fs.rm(fullPath, { recursive: true, force: true });
	}

	await ensureDir(sharedRoot);

	console.log("✅ Shared ресурсы research-structure очищены:");
	console.log(`   • ${sharedRoot}`);
}

async function main(): Promise<void> {
	const argv = await yargs(hideBin(process.argv))
		.scriptName("clean-structure-shared")
		.option("global-root", {
			type: "string",
			demandOption: true,
			describe: "Каталог task/global, из которого требуется удалить shared ресурсы",
		})
		.help()
		.parseAsync();

	const globalRoot = path.resolve(argv.globalRoot as string);
	await cleanShared(globalRoot);
}

if (isMainModule(import.meta.url)) {
	void main().catch((error) => {
		console.error("❌ Ошибка очистки shared ресурсов:", error);
		process.exitCode = 1;
	});
}
