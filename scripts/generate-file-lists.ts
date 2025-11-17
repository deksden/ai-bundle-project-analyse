import { promises as fs } from "node:fs";
import path from "node:path";

interface GenerateFileListsOptions {
	projectRoot: string;
	codeOutputPath: string;
	docOutputPath: string;
	folderOutputPath: string;
	codeExtensions: string[];
	docExtensions: string[];
	summaryOutputPath?: string;
}

interface FileEntry {
	path: string;
	relative_path: string;
	size: number;
}

interface FolderEntry {
	path: string;
	relative_path: string;
	depth: number;
}

interface GenerateFileListsResult {
	codeFiles: FileEntry[];
	docFiles: FileEntry[];
	folders: FolderEntry[];
}

function ensureArray(value: string | undefined, fallback: string[]): string[] {
	if (!value) return fallback;
	return value
		.split(",")
		.map((ext) => ext.trim())
		.filter(Boolean)
		.map((ext) => (ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`));
}

function toRelative(projectRoot: string, targetPath: string): string {
	const relative = path.relative(projectRoot, targetPath);
	return relative.length === 0 ? "." : relative.replace(/\\/g, "/");
}

async function collectFileSystemData(
	projectRoot: string,
	codeExtensions: Set<string>,
	docExtensions: Set<string>,
): Promise<GenerateFileListsResult> {
	const codeFiles: FileEntry[] = [];
	const docFiles: FileEntry[] = [];
	const folders: FolderEntry[] = [];

	const stack: string[] = [projectRoot];
	const visited = new Set<string>();

	while (stack.length > 0) {
		const currentDir = stack.pop()!;
		if (visited.has(currentDir)) continue;
		visited.add(currentDir);

		const dirRelative = toRelative(projectRoot, currentDir);
		const depth = dirRelative === "." ? 0 : dirRelative.split("/").length;
		folders.push({
			path: currentDir,
			relative_path: dirRelative,
			depth,
		});

		const dirents = await fs.readdir(currentDir, { withFileTypes: true });
		for (const dirent of dirents) {
			const fullPath = path.join(currentDir, dirent.name);
			if (dirent.isDirectory()) {
				stack.push(fullPath);
				continue;
			}

			if (!dirent.isFile()) continue;
			const ext = path.extname(dirent.name).toLowerCase();
			const relativePath = toRelative(projectRoot, fullPath);
			const stats = await fs.stat(fullPath);
			const fileEntry: FileEntry = {
				path: fullPath,
				relative_path: relativePath,
				size: stats.size,
			};

			if (codeExtensions.has(ext)) {
				codeFiles.push(fileEntry);
			} else if (docExtensions.has(ext)) {
				docFiles.push(fileEntry);
			}
		}
	}

	const sortByRelativePath = <T extends { relative_path: string }>(entries: T[]): T[] =>
		entries.sort((a, b) => a.relative_path.localeCompare(b.relative_path));

	return {
		codeFiles: sortByRelativePath(codeFiles),
		docFiles: sortByRelativePath(docFiles),
		folders: sortByRelativePath(folders),
	};
}

async function writeJson(outputPath: string, data: unknown): Promise<void> {
	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	await fs.writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function generateFileLists(options: GenerateFileListsOptions): Promise<GenerateFileListsResult> {
	const projectRoot = path.resolve(options.projectRoot);
	const projectStats = await fs.stat(projectRoot).catch(() => null);
	if (!projectStats || !projectStats.isDirectory()) {
		throw new Error(`Project root does not exist or is not a directory: ${projectRoot}`);
	}

	const codeExtensions = new Set(options.codeExtensions.map((ext) => ext.toLowerCase()));
	const docExtensions = new Set(options.docExtensions.map((ext) => ext.toLowerCase()));

	const result = await collectFileSystemData(projectRoot, codeExtensions, docExtensions);

	const summary = {
		code_files_count: result.codeFiles.length,
		doc_files_count: result.docFiles.length,
		folder_count: result.folders.length,
	};

	await Promise.all([
		writeJson(path.resolve(options.codeOutputPath), result.codeFiles),
		writeJson(path.resolve(options.docOutputPath), result.docFiles),
		writeJson(path.resolve(options.folderOutputPath), result.folders),
		options.summaryOutputPath
			? writeJson(path.resolve(options.summaryOutputPath), summary)
			: Promise.resolve(),
	]);

	return result;
}

function parseCliArgs(argv: string[]): GenerateFileListsOptions | null {
	const args = [...argv];
	if (args.length === 0) {
		return null;
	}

	const getArgValue = (flag: string): string | undefined => {
		const index = args.indexOf(flag);
		if (index === -1 || index + 1 >= args.length) return undefined;
		return args[index + 1];
	};

	const projectRoot = getArgValue("--project_root");
	const codeOutput = getArgValue("--code_output");
	const docOutput = getArgValue("--doc_output");
	const folderOutput = getArgValue("--folder_output");
	const summaryOutput = getArgValue("--summary_output");

	if (!projectRoot) {
		throw new Error("Missing required argument: --project_root <path>");
	}
	if (!codeOutput) {
		throw new Error("Missing required argument: --code_output <path>");
	}
	if (!docOutput) {
		throw new Error("Missing required argument: --doc_output <path>");
	}
	if (!folderOutput) {
		throw new Error("Missing required argument: --folder_output <path>");
	}

	const codeExtensions = ensureArray(
		getArgValue("--code_extensions"),
		[".ts", ".tsx", ".js", ".jsx"],
	);
	const docExtensions = ensureArray(
		getArgValue("--doc_extensions"),
		[".md", ".mdx", ".rst", ".txt"],
	);

	return {
		projectRoot,
		codeOutputPath: codeOutput,
		docOutputPath: docOutput,
		folderOutputPath: folderOutput,
		codeExtensions,
		docExtensions,
		summaryOutputPath: summaryOutput,
	};
}

async function runCli(): Promise<void> {
	try {
		const cliOptions = parseCliArgs(process.argv.slice(2));
		let options: GenerateFileListsOptions;
		if (cliOptions) {
			options = cliOptions;
		} else {
			const { loadStageContext, loadStageEnv, getInputValue } = await import(
				"./workflow/utils/context.mjs"
			);
			const stepRoot = process.cwd();
			const context = loadStageContext(stepRoot);
			const env = loadStageEnv(stepRoot);

			const projectRootValue =
				getInputValue(context, "project_root") ??
				getInputValue(context, "inputs.project_root") ??
				env.PROJECT_ROOT;
			if (typeof projectRootValue !== "string" || projectRootValue.length === 0) {
				throw new Error("project_root is missing in context and env");
			}

			options = {
				projectRoot: projectRootValue,
				codeOutputPath: path.join(stepRoot, "code-files.json"),
				docOutputPath: path.join(stepRoot, "doc-files.json"),
				folderOutputPath: path.join(stepRoot, "folder-tree.json"),
				summaryOutputPath: path.join(stepRoot, "file-summary.json"),
				codeExtensions: [".ts", ".tsx", ".js", ".jsx"],
				docExtensions: [".md", ".mdx", ".rst", ".txt"],
			};
		}

		const result = await generateFileLists(options);
		const summary = {
			code_files_count: result.codeFiles.length,
			doc_files_count: result.docFiles.length,
			folder_count: result.folders.length,
		};
		console.log(JSON.stringify(summary));
	} catch (error) {
		console.error(
			`generate-file-lists failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exit(1);
	}
}

if (process.argv[1] && process.argv[1].endsWith("generate-file-lists.ts")) {
	void runCli();
}
