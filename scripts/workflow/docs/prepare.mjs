import fs from "node:fs";
import path from "node:path";
import {
	findInputBySuffix,
	getInputValue,
	loadStageContext,
	loadStageEnv,
	resolvePathRelativeToProject,
} from "../utils/context.mjs";
import { writeYAML } from "../utils/yaml.mjs";
import {
	computeContentHashFromText,
	detectDocFormat,
	detectDocLanguage,
} from "./utils.mjs";

function ensureArray(value, description) {
	if (!Array.isArray(value)) {
		throw new Error(`${description} must be an array`);
	}
	return value;
}

function toNumber(value) {
	const num = Number(value);
	return Number.isFinite(num) ? num : undefined;
}

function ensureAbsolutePath(candidate) {
	if (typeof candidate !== "string" || candidate.length === 0) {
		return undefined;
	}
	return path.isAbsolute(candidate) ? candidate : path.resolve(candidate);
}

try {
	const stepRoot = process.cwd();
	const context = loadStageContext(stepRoot);
	const envData = loadStageEnv(stepRoot);
	const defaultLanguageRaw =
		typeof envData?.DOCS_DEFAULT_LANGUAGE === "string" ? envData.DOCS_DEFAULT_LANGUAGE.trim() : "";
	const defaultLanguage = defaultLanguageRaw.length > 0 ? defaultLanguageRaw.toLowerCase() : "en";
	const projectRootValue = getInputValue(context, "project_root") ?? findInputBySuffix(context, "project_root");
	const projectRoot = ensureAbsolutePath(projectRootValue);
	if (!projectRoot) {
		throw new Error("project_root input is required");
	}
	const normalizedProjectRoot = path.resolve(projectRoot);

	let docListValue = getInputValue(context, "artefacts.doc_files_path");
	if (!docListValue) {
		docListValue = findInputBySuffix(context, [
			"artefacts.doc_files_path",
			"doc_files_path",
			"docs.artefacts.doc_files_path",
			"start.artefacts.doc_files_path",
		]);
	}
	let docListPath = ensureAbsolutePath(docListValue);
	if (!docListPath) {
		const taskRoot = path.resolve(stepRoot, "..");
		docListPath = path.join(taskRoot, "STEP-0001", "doc-files.json");
	}
	if (!docListPath) {
		throw new Error("doc_files_path input is missing or invalid");
	}
	if (!fs.existsSync(docListPath)) {
		throw new Error(`Doc list not found: ${docListPath}`);
	}

	const rawList = JSON.parse(fs.readFileSync(docListPath, "utf8"));
	ensureArray(rawList, "doc list");

	const fanoutDir = path.join(stepRoot, "fanout");
	const fanoutJsonPath = path.join(fanoutDir, "docs-items.json");
	fs.mkdirSync(fanoutDir, { recursive: true });

	const languageBreakdown = {};
	const formatBreakdown = {};

	const items = rawList.map((entry, index) => {
		const rel = typeof entry?.relative_path === "string" ? entry.relative_path.trim() : "";
		const rawPath = typeof entry?.path === "string" ? entry.path : rel;
		const absolutePath = ensureAbsolutePath(rawPath);
		if (!absolutePath) {
			throw new Error(`Invalid entry.path for index ${index}`);
		}
		const resolved = resolvePathRelativeToProject(projectRoot, absolutePath);
		const relativePath = resolved.ok ? resolved.relative : absolutePath;
		const displayPath = rel && rel.length > 0 ? rel.replace(/^\.\\?\/?/, "") : relativePath;
		const extension = path.extname(displayPath || absolutePath).toLowerCase();
		const size = Number(entry?.size ?? 0);
		const topDirectory =
			displayPath && displayPath.includes("/") ? displayPath.split("/")[0] : displayPath || ".";
		let fileContent = "";
		try {
			fileContent = fs.readFileSync(absolutePath, "utf8");
		} catch (error) {
			throw new Error(
				`Failed to read document #${index} (${absolutePath}): ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
		const format = detectDocFormat(extension);
		const language =
			typeof entry?.language === "string" && entry.language.length > 0
				? entry.language
				: detectDocLanguage(fileContent, defaultLanguage);
		const contentHash = computeContentHashFromText(fileContent);
		languageBreakdown[language] = (languageBreakdown[language] ?? 0) + 1;
		formatBreakdown[format] = (formatBreakdown[format] ?? 0) + 1;

		return {
			index,
			path: resolved.ok ? resolved.absolute : absolutePath,
			relative_path: relativePath,
			display_path: displayPath,
			extension,
			top_directory: topDirectory,
			size,
			format,
			language,
			content_hash: contentHash,
			hash_algorithm: "xxhash64",
			validation: {
				resolved,
				originalRelative: rel,
			},
		};
	});

	const sanitizedItems = items.map(({ validation: _validation, ...rest }) => rest);
	fs.writeFileSync(fanoutJsonPath, JSON.stringify(sanitizedItems, null, 2));

	const expectedTotal =
		toNumber(getInputValue(context, "metrics.doc_files_count")) ??
		toNumber(
			findInputBySuffix(context, [
				"metrics.doc_files_count",
				"doc_files_count",
				"docs.metrics.doc_files_count",
				"start.metrics.doc_files_count",
			]),
		) ??
		sanitizedItems.length;

	const deviations = [];
	if (sanitizedItems.length !== expectedTotal) {
		deviations.push({
			error: "count_mismatch",
			expected: expectedTotal,
			actual: sanitizedItems.length,
		});
	}

	for (const item of items) {
		const { resolved, originalRelative } = item.validation;
		if (!resolved.ok) {
			deviations.push({
				error: "invalid_source_path",
				index: item.index,
				reason: resolved.reason,
				path: item.path,
			});
			continue;
		}
		if (!originalRelative || originalRelative === "." || originalRelative.startsWith("./")) {
			deviations.push({
				error: "invalid_relative_path",
				index: item.index,
				relative_path: originalRelative,
			});
		}
		if (!item.extension) {
			deviations.push({
				error: "missing_extension",
				index: item.index,
				path: item.path,
			});
		}
		if (!item.top_directory || item.top_directory === ".") {
			deviations.push({
				error: "invalid_top_directory",
				index: item.index,
				top_directory: item.top_directory,
			});
		}
	}

	const outputJsonPath = path.join(stepRoot, "docs-prepare.json");
	const output = {
		status: deviations.length > 0 ? "failed" : "success",
		lane_id: "docs",
		source_list: docListPath,
		project_root: normalizedProjectRoot,
		metrics: {
			total_files: sanitizedItems.length,
			expected_files: expectedTotal,
			language_breakdown: languageBreakdown,
			format_breakdown: formatBreakdown,
		},
		artefacts: {
			fanout_items_path: fanoutJsonPath,
		},
		fanout_items: sanitizedItems,
		deviations,
	};

	fs.writeFileSync(outputJsonPath, JSON.stringify(output, null, 2));
	writeYAML(path.join(stepRoot, "output.yaml"), output);
} catch (error) {
	console.error("docs/prepare.mjs failed:", error);
	process.exitCode = 1;
}
