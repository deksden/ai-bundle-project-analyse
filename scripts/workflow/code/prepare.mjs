import fs from "node:fs";
import path from "node:path";

import { findInputBySuffix, getInputValue, loadStageContext, resolvePathRelativeToProject } from "../utils/context.mjs";
import { writeYAML } from "../utils/yaml.mjs";
import { createCodeExtractionOptions } from "../../code/index.js";
import { detectLanguage } from "../../utils/tree-sitter.js";
import { xxhash64 } from "../../utils/hash.js";

function ensureArray(value, description) {
	if (!Array.isArray(value)) {
		throw new Error(`${description} must be an array`);
	}
	return value;
}

function ensureAbsolutePath(candidate) {
	if (typeof candidate !== "string" || candidate.length === 0) {
		return undefined;
	}
	return path.isAbsolute(candidate) ? candidate : path.resolve(candidate);
}

function loadCodeLaneOptions(stepRoot) {
	const globalRoot = path.join(stepRoot, "global");
	const analysisDir = path.join(globalRoot, "analysis");
	const runtimePath = path.join(analysisDir, "config.runtime.json");
	const fallbackPath = path.join(analysisDir, "config.json");
	let options = {};
	if (fs.existsSync(runtimePath)) {
		try {
			options = JSON.parse(fs.readFileSync(runtimePath, "utf8"))?.code_lane ?? {};
		} catch {
			options = {};
		}
	} else if (fs.existsSync(fallbackPath)) {
		try {
			options = JSON.parse(fs.readFileSync(fallbackPath, "utf8"))?.code_lane ?? {};
		} catch {
			options = {};
		}
	}
	return createCodeExtractionOptions(options);
}

function computeFileHash(filePath) {
	return xxhash64(fs.readFileSync(filePath));
}

try {
	const stepRoot = process.cwd();
	const context = loadStageContext(stepRoot);
	const projectRootRaw = getInputValue(context, "project_root");
	const projectRoot = ensureAbsolutePath(projectRootRaw);
	if (!projectRoot) {
		throw new Error("project_root input is missing or invalid");
	}

	let codeListRaw = getInputValue(context, "artefacts.code_files_path");
	if (!codeListRaw) {
		codeListRaw = findInputBySuffix(context, [
			"artefacts.code_files_path",
			"code_files_path",
			"code.artefacts.code_files_path",
			"start.artefacts.code_files_path",
		]);
	}
	let codeListPath = ensureAbsolutePath(codeListRaw);
	if (!codeListPath) {
		const taskRoot = path.resolve(stepRoot, "..");
		codeListPath = path.join(taskRoot, "STEP-0001", "code-files.json");
	}
	if (!codeListPath || !fs.existsSync(codeListPath)) {
		throw new Error("code_files_path input is missing or invalid");
	}

	const options = loadCodeLaneOptions(stepRoot);
	const allowedLanguages = new Set(options.languages);

	const outputJsonPath = path.join(stepRoot, "code-prepare.json");
	const fanoutDir = path.join(stepRoot, "fanout");
	const fanoutJsonPath = path.join(fanoutDir, "code-items.json");
	fs.mkdirSync(fanoutDir, { recursive: true });

	const rawList = JSON.parse(fs.readFileSync(codeListPath, "utf8"));
	ensureArray(rawList, "code list");

	const normalizedProjectRoot = path.resolve(projectRoot);
	const processedItems = [];
	const skippedItems = [];
	const languageBreakdown = {};
	const deviations = [];

	rawList.forEach((entry, index) => {
		const rel = typeof entry?.relative_path === "string" ? entry.relative_path.trim() : "";
		const rawPath = typeof entry?.path === "string" ? entry.path : rel;
		const absolutePath = ensureAbsolutePath(rawPath);
		if (!absolutePath || !fs.existsSync(absolutePath)) {
			deviations.push({
				error: "invalid_source_path",
				index,
				path: rawPath,
			});
			return;
		}

		const resolution = resolvePathRelativeToProject(projectRoot, absolutePath);
		const displayPath =
			rel && rel.length > 0
				? rel.replace(/^\.\\?\/?/, "")
				: resolution.ok
					? resolution.relative
					: absolutePath;
		const relativePath = resolution.ok ? resolution.relative : displayPath;

		let stats;
		try {
			stats = fs.statSync(absolutePath);
		} catch (error) {
			deviations.push({
				error: "stat_failed",
				index,
				path: absolutePath,
				message: error instanceof Error ? error.message : String(error),
			});
			return;
		}

		const detectedLanguage = detectLanguage(absolutePath, entry?.language);
		if (!detectedLanguage || !allowedLanguages.has(detectedLanguage)) {
			skippedItems.push({
				index,
				path: absolutePath,
				reason: detectedLanguage ? "language_disabled" : "language_unknown",
				language: detectedLanguage ?? null,
			});
			return;
		}

		const contentHash = computeFileHash(absolutePath);
		const item = {
			index,
			path: absolutePath,
			relative_path: relativePath,
			display_path: displayPath,
			extension: path.extname(displayPath).toLowerCase(),
			size: stats.size,
			language: detectedLanguage,
			content_hash: contentHash,
			hash_algorithm: options.hashAlgorithm,
		};
		processedItems.push(item);
		languageBreakdown[item.language] = (languageBreakdown[item.language] ?? 0) + 1;
	});

	fs.writeFileSync(fanoutJsonPath, JSON.stringify(processedItems, null, 2));

	const expectedTotalRaw =
		getInputValue(context, "metrics.code_files_count") ??
		findInputBySuffix(context, [
			"metrics.code_files_count",
			"code.metrics.code_files_count",
			"start.metrics.code_files_count",
		]);
	const expectedTotal =
		typeof expectedTotalRaw === "number" && Number.isFinite(expectedTotalRaw)
			? expectedTotalRaw
			: processedItems.length;

	if (processedItems.length !== expectedTotal) {
		deviations.push({
			error: "count_mismatch",
			expected: expectedTotal,
			actual: processedItems.length,
		});
	}

	const metrics = {
		total_files: rawList.length,
		supported_files: processedItems.length,
		skipped_files: skippedItems.length,
		language_breakdown: languageBreakdown,
		expected_files: expectedTotal,
	};

	const output = {
		status: deviations.length > 0 ? "failed" : "success",
		lane_id: "code",
		source_list: codeListPath,
		project_root: normalizedProjectRoot,
		options,
		metrics,
		artefacts: {
			fanout_items_path: fanoutJsonPath,
		},
		fanout_items: processedItems,
		skipped_items: skippedItems,
		deviations,
	};

	fs.writeFileSync(outputJsonPath, JSON.stringify(output, null, 2));
	writeYAML(path.join(stepRoot, "output.yaml"), output);
} catch (error) {
	console.error("code/prepare.mjs failed:", error);
	process.exitCode = 1;
}
