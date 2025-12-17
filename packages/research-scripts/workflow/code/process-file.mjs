import fs from "node:fs";
import path from "node:path";
import { getInputObject, loadStageContext } from "../utils/context.mjs";
import { writeYAML } from "../utils/yaml.mjs";

function formatError(error, filePath) {
	return {
		error: "file_missing",
		path: filePath,
		message: error instanceof Error ? error.message : String(error),
	};
}

try {
	const stepRoot = process.cwd();
	const context = loadStageContext(stepRoot);
	const codeItem = getInputObject(context, "code_item") ?? {};

	const filePath = typeof codeItem.path === "string" ? codeItem.path : null;
	if (!filePath) {
		throw new Error("code_item.path is missing in stage context");
	}

	const outputStatePath = path.join(stepRoot, "code-process.json");
	const outputYamlPath = path.join(stepRoot, "output.yaml");
	const recordedSize = Number(codeItem.size ?? codeItem.recorded_size ?? 0);
	const index = Number(codeItem.index ?? -1);
	const displayPath =
		typeof codeItem.display_path === "string"
			? codeItem.display_path
			: typeof codeItem.relative_path === "string"
				? codeItem.relative_path
				: path.basename(filePath);
	const extension =
		typeof codeItem.extension === "string"
			? codeItem.extension.toLowerCase()
			: path.extname(displayPath || filePath).toLowerCase();

	const output = {
		status: "success",
		lane_id: "code",
		file: {
			index,
			path: filePath,
			absolute_path: filePath,
			relative_path: displayPath,
			extension,
		},
		metrics: {
			size_bytes: 0,
			recorded_size_bytes: recordedSize,
		},
		checks: {
			exists: false,
			size_mismatch: false,
		},
		deviations: [],
	};

	try {
		const stats = fs.statSync(filePath);
		output.metrics.size_bytes = stats.size;
		output.checks.exists = true;
		output.checks.size_mismatch = stats.size !== recordedSize;
		if (stats.size === 0) {
			output.deviations.push({
				error: "empty_file",
				path: filePath,
			});
		}
	} catch (error) {
		output.status = "failed";
		output.deviations.push(formatError(error, filePath));
	}

	if (output.checks.size_mismatch) {
		output.status = "failed";
		output.deviations.push({
			error: "size_mismatch",
			expected: recordedSize,
			actual: output.metrics.size_bytes,
			path: filePath,
		});
	}

	fs.writeFileSync(outputStatePath, JSON.stringify(output, null, 2));
	writeYAML(outputYamlPath, output);
} catch (error) {
	console.error("code/process-file.mjs failed:", error);
	process.exitCode = 1;
}
