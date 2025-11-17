import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadStageContext, getInputValue } from "../utils/context.mjs";
import { writeYAML } from "../utils/yaml.mjs";

function resolveWorkspaceRoot(startDir) {
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

function runReport(commandArgs, options = {}) {
	runCommand("pnpm", commandArgs, options);
}

function ensureFileExists(filePath, label) {
	if (!fs.existsSync(filePath)) {
		throw new Error(`${label} не создан: ${filePath}`);
	}
}

try {
	const stepRoot = process.cwd();
	const workspaceRoot = resolveWorkspaceRoot(stepRoot);
	const context = loadStageContext(stepRoot);
	const taskId = context?.task?.id ?? "UNKNOWN";

	const dbPathRaw =
		getInputValue(context, "db_path") ??
		getInputValue(context, "start.db_path") ??
		getInputValue(context, "start.output.db_path");
	if (typeof dbPathRaw !== "string" || dbPathRaw.length === 0) {
		throw new Error("db_path input is missing or invalid");
	}
	const dbPath = path.resolve(dbPathRaw);
	ensureFileExists(dbPath, "analysis.db");

	const globalRoot = fs.realpathSync(path.join(stepRoot, "global"));
	const bundleRoot = path.join(globalRoot, "bundle", "research-structure");
	const logsDir = path.join(globalRoot, "logs");
	fs.mkdirSync(logsDir, { recursive: true });
	const logFile = path.join(logsDir, "structure-report.log");

	const outputsDir = globalRoot;
	const reportPath = path.join(globalRoot, "reports", "structure.md");

	const reportArgs = [
		"exec",
		"tsx",
		path.join(bundleRoot, "scripts/generate-structure-report.ts"),
		"--db_path",
		dbPath,
		"--task_id",
		taskId,
		"--outputs_dir",
		outputsDir,
		"--log_file",
		logFile,
	];

	runReport(reportArgs, {
		cwd: workspaceRoot ?? bundleRoot,
	});

	ensureFileExists(reportPath, "structure.md");

	const result = {
		status: "success",
		report_path: reportPath,
		log_file: logFile,
	};

	writeYAML(path.join(stepRoot, "output.yaml"), result);
} catch (error) {
	console.error("[final-report] failed:", error);
	const fallback = {
		status: "failed",
		error: error instanceof Error ? error.message : String(error),
	};
	try {
		writeYAML(path.join(process.cwd(), "output.yaml"), fallback);
	} catch {
		// ignore secondary failures
	}
	process.exitCode = 1;
}
