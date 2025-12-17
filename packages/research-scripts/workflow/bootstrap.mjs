import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadStageContext, getInputValue } from "./utils/context.mjs";
import { writeYAML } from "./utils/yaml.mjs";

function resolveWorkspaceRoot(startDir) {
	const explicit = process.env.AI_KOD_PROJECT_ROOT;
	if (typeof explicit === "string" && explicit.length > 0) {
		const candidate = path.isAbsolute(explicit) ? explicit : path.resolve(explicit);
		if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
			return candidate;
		}
	}

	let current = startDir;
	while (true) {
		const workspaceFile = path.join(current, "pnpm-workspace.yaml");
		if (fs.existsSync(workspaceFile)) {
			return current;
		}
		const parent = path.dirname(current);
		if (parent === current) {
			return undefined;
		}
		current = parent;
	}
}

function runCommand(command, args, options = {}) {
	const result = spawnSync(command, args, {
		stdio: "inherit",
		cwd: options.cwd ?? process.cwd(),
		env: { ...process.env, ...(options.env ?? {}) },
	});
	if (result.status !== 0) {
		throw new Error(`Command failed: ${command} ${args.join(" ")}`);
	}
	return result;
}

function runCapture(command, args, options = {}) {
	const result = spawnSync(command, args, {
		stdio: ["ignore", "pipe", "inherit"],
		encoding: "utf8",
		cwd: options.cwd ?? process.cwd(),
		env: { ...process.env, ...(options.env ?? {}) },
	});
	if (result.status !== 0) {
		throw new Error(`Command failed: ${command} ${args.join(" ")}`);
	}
	return result.stdout ?? "";
}

function ensureDir(dirPath) {
	fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
	fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function writeFailure(stepRoot, details) {
	const fallback = {
		status: "failed",
		deviations: [
			{
				error: "bootstrap_failed",
				message: details?.message ?? "Unknown error",
			},
		],
	};
	try {
		writeYAML(path.join(stepRoot, "output.yaml"), fallback);
	} catch {
		// swallow secondary errors; primary exception already logged
	}
}

try {
	const stepRoot = process.cwd();
	const context = loadStageContext(stepRoot);
	const taskId = context?.task?.id ?? "UNKNOWN";
	const workspaceRoot = resolveWorkspaceRoot(stepRoot);

	const projectInput = getInputValue(context, "project_root");
	if (typeof projectInput !== "string" || projectInput.length === 0) {
		throw new Error("project_root input is required");
	}
	const projectCandidate = path.isAbsolute(projectInput)
		? path.normalize(projectInput)
		: path.resolve(workspaceRoot ?? stepRoot, projectInput);
	if (!fs.existsSync(projectCandidate) || !fs.statSync(projectCandidate).isDirectory()) {
		throw new Error(`project_root does not exist or is not a directory: ${projectCandidate}`);
	}
	const projectRoot = fs.realpathSync(projectCandidate);

	const gitShaRaw = getInputValue(context, "git_sha");
	const gitSha = typeof gitShaRaw === "string" && gitShaRaw.length > 0 ? gitShaRaw : undefined;

	const globalRoot = fs.realpathSync(path.join(stepRoot, "global"));
	const bundleRoot = path.join(globalRoot, "bundle", "research-structure");
	const logsDir = path.join(globalRoot, "logs");
	const tmpDir = path.join(globalRoot, "tmp");
	const sharedDir = path.join(globalRoot, "shared/research-structure/shared-resources");
	const analysisDir = path.join(globalRoot, "analysis");

	[
		analysisDir,
		path.join(analysisDir, "exports"),
		path.join(globalRoot, "reports"),
		path.join(globalRoot, "structure"),
		logsDir,
		tmpDir,
		sharedDir,
	].forEach(ensureDir);

	const dbPath = path.join(sharedDir, "analysis.db");
	const initLogPath = path.join(logsDir, "init-db.log");
	const templateConfigPath = path.join(bundleRoot, "analysis/config.json");

	try {
		const templateConfig = readJson(templateConfigPath);
		const runtimeConfig = {
			...templateConfig,
			db_path: dbPath,
			repo_root: projectRoot,
			git_sha: gitSha ?? null,
			runtime: {
				project_root: projectRoot,
				git_sha: gitSha ?? null,
				workspace: {
					analysis_dir: analysisDir,
					logs_dir: logsDir,
					tmp_dir: tmpDir,
				},
			},
		};
		writeJson(path.join(analysisDir, "config.runtime.json"), runtimeConfig);
		writeJson(path.join(analysisDir, "config.json"), runtimeConfig);
	} catch (error) {
		console.warn("[warn] Failed to prepare runtime analysis config:", error);
	}

// Optional TS/JS check
	const pkgPath = path.join(projectRoot, "package.json");
	const tsconfigPath = path.join(projectRoot, "tsconfig.json");
	if (fs.existsSync(pkgPath) && fs.existsSync(tsconfigPath)) {
		try {
			const pkg = readJson(pkgPath);
			const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
			if (!deps.typescript) {
				console.warn("[warn] tsconfig.json detected but typescript dependency is missing");
			}
		} catch {
			console.warn("[warn] Failed to parse package.json for TypeScript check");
		}
	} else {
		console.warn("[warn] package.json or tsconfig.json not found — continuing");
	}

	const initArgs = [
		"exec",
		"tsx",
		path.join(bundleRoot, "scripts/init-db.ts"),
		"--project_root",
		projectRoot,
		"--db_path",
		dbPath,
		"--task_id",
		taskId,
		"--log_file",
		initLogPath,
	];
	if (gitSha) {
		initArgs.push("--git_sha", gitSha);
	}
	runCommand("pnpm", initArgs, {
		cwd: workspaceRoot ?? bundleRoot,
	});

	if (!fs.existsSync(dbPath)) {
		throw new Error(`analysis.db was not created at ${dbPath}`);
	}
	const tablesOutput = runCapture("sqlite3", [dbPath, ".tables"]);
	if (!tablesOutput || tablesOutput.trim().length === 0) {
		throw new Error("sqlite3 returned no tables for the initialized database");
	}
	const tables = tablesOutput
		.split(/\s+/g)
		.map((name) => name.trim())
		.filter((name) => name.length > 0 && !name.startsWith("sqlite_"));
	const indexesOutput = runCapture("sqlite3", [dbPath, ".indexes"]);
	const indexes = indexesOutput
		.split(/\s+/g)
		.map((name) => name.trim())
		.filter((name) => name.length > 0 && !name.startsWith("sqlite_"));
	const sqliteVersionRaw = runCapture("sqlite3", [dbPath, "SELECT sqlite_version();"]).trim();
	const runRegistrationRaw = runCapture("sqlite3", [
		dbPath,
		`SELECT COUNT(*) FROM runs WHERE id='${taskId.replace(/'/g, "''")}';`,
	]).trim();
	const runRegistered = Number(runRegistrationRaw || "0") > 0;

	const codeListPath = path.join(stepRoot, "code-files.json");
	const docListPath = path.join(stepRoot, "doc-files.json");
	const folderTreePath = path.join(stepRoot, "folder-tree.json");
	const summaryPath = path.join(stepRoot, "file-summary.json");

	runCommand(
		"pnpm",
		[
			"exec",
			"tsx",
			path.join(bundleRoot, "scripts/generate-file-lists.ts"),
			"--project_root",
			projectRoot,
			"--code_output",
			codeListPath,
			"--doc_output",
			docListPath,
			"--folder_output",
			folderTreePath,
			"--summary_output",
			summaryPath,
		],
		{
			cwd: workspaceRoot ?? bundleRoot,
		},
	);

	const ensureOutput = (filePath, label) => {
		if (!fs.existsSync(filePath)) {
			throw new Error(`${label} was not generated at ${filePath}`);
		}
	};

	ensureOutput(codeListPath, "code-files.json");
	ensureOutput(docListPath, "doc-files.json");
	ensureOutput(folderTreePath, "folder-tree.json");
	ensureOutput(summaryPath, "file-summary.json");

	const summary = readJson(summaryPath);
	const codeCount = Number(summary.code_files_count ?? 0);
	const docCount = Number(summary.doc_files_count ?? 0);
	const folderCount = Number(summary.folder_count ?? 0);

	const artefacts = {
		code_files_path: codeListPath,
		doc_files_path: docListPath,
		folder_tree_path: folderTreePath,
		summary_path: summaryPath,
	};

	const dbChecks = {
		sqlite_version: sqliteVersionRaw || "unknown",
		tables_count: tables.length,
		indexes_count: indexes.length,
		run_registered: runRegistered,
	};

	const result = {
		status: "success",
		project_root: projectRoot,
		db_path: dbPath,
		artefacts,
		metrics: {
			code_files_count: codeCount,
			doc_files_count: docCount,
			folder_count: folderCount,
		},
		db_checks: dbChecks,
		deviations: [],
		logs: {
			init_db: initLogPath,
		},
	};

	writeYAML(path.join(stepRoot, "output.yaml"), result);
} catch (error) {
	console.error("[bootstrap] failed:", error);
	writeFailure(process.cwd(), error);
	process.exitCode = 1;
}
