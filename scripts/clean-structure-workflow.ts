#!/usr/bin/env tsx
/**
 * Очистка артефактов демо bundle `research-structure`.
 *
 * - Удаляет все файлы внутри `examples/research-structure-demo/analysis/`,
 *   кроме `.gitkeep`, чтобы сохранить чистую стартовую точку.
 * - Стирает `examples/research-structure-demo/remarks.txt`, появляющийся после запуска.
 *
 * Запуск:
 *    pnpm tsx bundle/scripts/clean-structure-workflow.ts
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

async function cleanAnalysisDirectory(analysisDir: string): Promise<void> {
	await ensureDir(analysisDir);
	const entries = await fs.readdir(analysisDir, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.name === ".gitkeep") continue;
		const fullPath = path.join(analysisDir, entry.name);
		await fs.rm(fullPath, { recursive: true, force: true });
	}

	const gitkeepPath = path.join(analysisDir, ".gitkeep");
	if (!(await pathExists(gitkeepPath))) {
		await fs.writeFile(gitkeepPath, "", "utf-8");
	}
}

async function removeIfExists(target: string): Promise<void> {
	if (await pathExists(target)) {
		await fs.rm(target, { recursive: true, force: true });
	}
}

async function main(): Promise<void> {
	const __filename = fileURLToPath(import.meta.url);
	const projectRoot = path.resolve(path.dirname(__filename), "..", "..");
	const demoRoot = path.resolve(projectRoot, "examples", "research-structure-demo");
	const analysisDir = path.join(demoRoot, "analysis");
	const remarksFile = path.join(demoRoot, "remarks.txt");

	await cleanAnalysisDirectory(analysisDir);
	await removeIfExists(remarksFile);

	console.log("✅ Research Structure demo workspace очищен:");
	console.log(`   • ${analysisDir}`);
	if (await pathExists(remarksFile)) {
		console.log("   • remarks.txt сохранён (не удалён)");
	} else {
		console.log("   • remarks.txt удалён");
	}
}

main().catch((error) => {
	console.error("❌ Ошибка очистки research-structure:", error);
	process.exitCode = 1;
});
