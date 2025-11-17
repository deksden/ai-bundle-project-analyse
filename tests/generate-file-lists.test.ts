import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { generateFileLists } from "../scripts/generate-file-lists.ts";

const DEMO_PROJECT_ROOT = path.resolve("bundle/examples/research-structure-demo");

describe("generate-file-lists.ts", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		for (const dir of tempDirs.splice(0)) {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("collects code, doc and folder metadata for the demo project", async () => {
		const workspace = mkdtempSync(path.join(os.tmpdir(), "file-lists-"));
		tempDirs.push(workspace);

		const codeOutputPath = path.join(workspace, "code-files.json");
		const docOutputPath = path.join(workspace, "doc-files.json");
		const folderOutputPath = path.join(workspace, "folder-tree.json");
		const summaryOutputPath = path.join(workspace, "summary.json");

		const result = await generateFileLists({
			projectRoot: DEMO_PROJECT_ROOT,
			codeOutputPath,
			docOutputPath,
			folderOutputPath,
			summaryOutputPath,
			codeExtensions: [".ts", ".tsx", ".js", ".jsx"],
			docExtensions: [".md", ".mdx", ".rst", ".txt"],
		});

		expect(result.codeFiles).toHaveLength(4);
		expect(result.docFiles).toHaveLength(3);
		expect(result.folders).toHaveLength(16);

		const summary = JSON.parse(await fs.readFile(summaryOutputPath, "utf8"));
		expect(summary).toEqual({
			code_files_count: 4,
			doc_files_count: 3,
			folder_count: 16,
		});

		const folderTree = JSON.parse(await fs.readFile(folderOutputPath, "utf8"));
		const rootEntry = folderTree.find((entry: { relative_path: string }) => entry.relative_path === ".");
		expect(rootEntry).toBeTruthy();
		expect(rootEntry.depth).toBe(0);
	});
});
