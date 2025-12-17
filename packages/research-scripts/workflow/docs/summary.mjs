import fs from "node:fs";
import path from "node:path";
import { findInputBySuffix, getInputValue, loadStageContext } from "../utils/context.mjs";
import { writeYAML } from "../utils/yaml.mjs";

const LANE_ID = "docs";
const PROCESS_FILENAME = "docs-process.json";

function readArrayInput(context, key) {
	const value = getInputValue(context, key) ?? findInputBySuffix(context, [key]) ?? [];
	if (!Array.isArray(value)) {
		throw new Error(`${key} input must be an array`);
	}
	return value;
}

function toNumber(value) {
	const num = Number(value);
	return Number.isFinite(num) ? num : undefined;
}

function extractBranchResult(entry) {
	if (!entry || typeof entry !== "object") {
		return {};
	}
	if (entry.outputs && typeof entry.outputs === "object") {
		return entry.outputs;
	}
	return entry;
}

function collectBranchResultsFromFiles(taskRoot, filename, laneId) {
	const results = [];
	const entries = fs.readdirSync(taskRoot, { withFileTypes: true });
	for (const dirent of entries) {
		if (!dirent.isDirectory() || !dirent.name.startsWith("STEP-")) {
			continue;
		}
		const candidate = path.join(taskRoot, dirent.name, filename);
		if (!fs.existsSync(candidate)) {
			continue;
		}
		try {
			const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
			const lane = parsed?.lane_id ?? parsed?.lane;
			if (laneId && lane && lane !== laneId) {
				continue;
			}
			parsed.__source_step = dirent.name;
			results.push(parsed);
		} catch (error) {
			console.warn(`[docs-summary] Failed to parse ${candidate}:`, error instanceof Error ? error.message : error);
		}
	}
	return results;
}

function sleep(ms) {
	const array = new Int32Array(new SharedArrayBuffer(4));
	Atomics.wait(array, 0, 0, ms);
}

function collectBranchResultsWithWait(taskRoot, filename, laneId, options = {}) {
	const minRecords = typeof options.minRecords === "number" ? options.minRecords : 1;
	const maxWaitMs = typeof options.maxWaitMs === "number" ? options.maxWaitMs : 30_000;
	const collected = new Map();
	const deadline = Date.now() + maxWaitMs;

	const collectOnce = () => {
		const entries = collectBranchResultsFromFiles(taskRoot, filename, laneId);
		for (const entry of entries) {
			const branch = extractBranchResult(entry);
			const key = branch?.file?.path ?? branch?.file?.absolute_path ?? entry.__source_step;
			if (!key) {
				continue;
			}
			collected.set(key, entry);
		}
	};

	do {
		collectOnce();
		if (collected.size >= minRecords) {
			break;
		}
		sleep(500);
	} while (Date.now() < deadline);

	return Array.from(collected.values());
}

function collectLaneRecords({ primaryEntries, fallbackEntries, laneId }) {
	const combined = [];
	const seen = new Set();

	const register = (entry) => {
		if (!entry || typeof entry !== "object") return;
		const branch = extractBranchResult(entry);
		const lane =
			entry?.lane_id ?? entry?.lane ?? entry?.outputs?.lane_id ?? branch?.lane_id ?? null;
		if (lane && lane !== laneId) {
			return;
		}
		const hasFileInfo =
			typeof branch?.file?.path === "string" ||
			typeof branch?.file?.absolute_path === "string" ||
			typeof branch?.file?.top_directory === "string";
		const hasError = Boolean(entry && entry.error);
		if (!hasFileInfo && !hasError) {
			return;
		}
		const key =
			typeof branch?.file?.path === "string"
				? path.normalize(branch.file.path)
				: typeof branch?.file?.absolute_path === "string"
					? path.normalize(branch.file.absolute_path)
					: typeof entry?.step_id === "string"
						? entry.step_id
						: typeof entry?.__source_step === "string"
							? entry.__source_step
							: `seq:${combined.length}`;
		if (seen.has(key)) {
			return;
		}
		seen.add(key);
		combined.push({
			branch: branch ?? {},
			source: entry,
			key,
		});
	};

	const visitEntry = (entry) => {
		if (
			entry &&
			typeof entry === "object" &&
			Array.isArray(entry.docs_processed) &&
			entry.docs_processed.length > 0
		) {
			for (const child of entry.docs_processed) {
				visitEntry(child);
			}
			return;
		}
		register(entry);
	};

	(primaryEntries ?? []).forEach(visitEntry);
	(fallbackEntries ?? []).forEach(visitEntry);
	return combined;
}

function buildMarkdown(summary) {
	const lines = [
		"# Documentation Lane Summary",
		"",
		`Generated: ${summary.generated_at}`,
		"",
		"## Totals",
		"",
		`- Expected files: ${summary.metrics.expected_files}`,
		`- Processed files: ${summary.metrics.processed_files}`,
		`- Coverage (docs-only): ${summary.metrics.coverage_ratio}`,
		`- Fan-out branches: ${summary.metrics.total_branches}`,
		`- Doc entities: ${summary.metrics.doc_entities}`,
		`- Doc relationships: ${summary.metrics.doc_relationships}`,
		`- Files missing title: ${summary.metrics.files_missing_title}`,
		`- Branch errors: ${summary.metrics.branch_errors}`,
		"",
		"## Formats (top 5)",
		"",
		"| Format | Count |",
		"|--------|-------|",
	];

	const formats = Object.entries(summary.metrics.format_breakdown ?? {});
	if (formats.length === 0) {
		lines.push("| (none) | 0 |");
	} else {
		for (const [format, count] of formats) {
			lines.push(`| ${format} | ${count} |`);
		}
	}

	lines.push("");
	lines.push("## Languages (top 5)");
	lines.push("");
	lines.push("| Language | Count |");
	lines.push("|----------|-------|");

	const languages = Object.entries(summary.metrics.language_breakdown ?? {});
	if (languages.length === 0) {
		lines.push("| (none) | 0 |");
	} else {
		for (const [language, count] of languages) {
			lines.push(`| ${language} | ${count} |`);
		}
	}

	lines.push("");
	lines.push("## Top Directories (top 5)");
	lines.push("");
	lines.push("| Directory | Count |");
	lines.push("|-----------|-------|");

	const topEntries = Object.entries(summary.metrics.top_directories ?? {});
	if (topEntries.length === 0) {
		lines.push("| (none) | 0 |");
	} else {
		for (const [dir, count] of topEntries) {
			lines.push(`| ${dir} | ${count} |`);
		}
	}

	return `${lines.join("\n")}\n`;
}

try {
	const stepRoot = process.cwd();
	const context = loadStageContext(stepRoot);
	const reportsDir = path.join(stepRoot, "reports");
	const tmpDir = path.join(stepRoot, "tmp");
	fs.mkdirSync(reportsDir, { recursive: true });
	fs.mkdirSync(tmpDir, { recursive: true });

	const summaryJsonPath = path.join(reportsDir, "doc-summary.json");
	const summaryMdPath = path.join(reportsDir, "doc-summary.md");
	const aggregatedPath = path.join(tmpDir, "docs-processed.json");
	const outputStatePath = path.join(tmpDir, "doc-summary-output.json");
	const outputYamlPath = path.join(stepRoot, "output.yaml");

	const primaryEntries = readArrayInput(context, "docs_processed");
	const expectedDocsHint =
		toNumber(getInputValue(context, "metrics.doc_files_count")) ??
		toNumber(
			findInputBySuffix(context, [
				"metrics.doc_files_count",
				"doc_files_count",
				"docs.metrics.doc_files_count",
				"start.metrics.doc_files_count",
			]),
		) ??
		0;
	const taskRoot = path.resolve(stepRoot, "..");
	const fallbackRecords = collectBranchResultsWithWait(taskRoot, PROCESS_FILENAME, LANE_ID, {
		minRecords: expectedDocsHint > 0 ? expectedDocsHint : 1,
		maxWaitMs: 30_000,
	});

const laneRecords = collectLaneRecords({
	primaryEntries,
	fallbackEntries: fallbackRecords,
	laneId: LANE_ID,
});

	console.info(
		"[docs-summary-debug] inputs",
		JSON.stringify(
			{
				stepRoot,
				primaryCount: primaryEntries.length,
				fallbackCount: fallbackRecords.length,
				uniqueLaneRecords: laneRecords.length,
			},
			null,
			2,
		),
	);

	if (laneRecords.length === 0) {
		throw new Error("docs lane did not produce any branch results");
	}

	const outputs = [];
	let branchErrors = 0;
	let missingTitle = 0;
	const topDirectories = new Map();
	const formatBreakdown = new Map();
	const languageBreakdown = new Map();
	let docEntitiesCount = 0;
	let docRelationshipsCount = 0;

	for (const entry of laneRecords) {
		const branchResult = entry.branch;
		const sourceRecord = entry.source ?? {};
		if (sourceRecord && sourceRecord.error) {
			branchErrors += 1;
			continue;
		}
		outputs.push(branchResult ?? {});
		const dir =
			typeof branchResult?.file?.top_directory === "string" && branchResult.file.top_directory
				? branchResult.file.top_directory
				: ".";
		topDirectories.set(dir, (topDirectories.get(dir) ?? 0) + 1);
		const format =
			typeof branchResult?.file?.format === "string"
				? branchResult.file.format
				: typeof branchResult?.file?.extension === "string"
					? branchResult.file.extension
					: "unknown";
		formatBreakdown.set(format, (formatBreakdown.get(format) ?? 0) + 1);
		const language =
			typeof branchResult?.file?.language === "string" && branchResult.file.language.length > 0
				? branchResult.file.language
				: "n/a";
		languageBreakdown.set(language, (languageBreakdown.get(language) ?? 0) + 1);
		if (branchResult?.metrics?.has_title === false) {
			missingTitle += 1;
		}
		docEntitiesCount += Array.isArray(branchResult?.doc_entities) ? branchResult.doc_entities.length : 0;
		docRelationshipsCount += Array.isArray(branchResult?.doc_relationships)
			? branchResult.doc_relationships.length
			: 0;
	}

	const orderedTop = [...topDirectories.entries()]
		.sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0])))
		.slice(0, 5);

	const expectedTotal = expectedDocsHint > 0 ? expectedDocsHint : outputs.length;

	const summary = {
		generated_at: new Date().toISOString(),
		source: {
			list:
				getInputValue(context, "doc_files_path") ??
				findInputBySuffix(context, [
					"doc_files_path",
					"docs.doc_files_path",
					"start.artefacts.doc_files_path",
				]),
		},
		metrics: {
			expected_files: expectedTotal,
			processed_files: outputs.length,
			coverage_ratio:
				expectedTotal > 0 ? Number((outputs.length / expectedTotal).toFixed(3)) : outputs.length > 0 ? 1 : 0,
			total_branches: laneRecords.length,
			doc_entities: docEntitiesCount,
			doc_relationships: docRelationshipsCount,
			top_directories: Object.fromEntries(orderedTop),
			format_breakdown: Object.fromEntries(
				[...formatBreakdown.entries()]
					.sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0])))
					.slice(0, 5),
			),
			language_breakdown: Object.fromEntries(
				[...languageBreakdown.entries()]
					.sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0])))
					.slice(0, 5),
			),
			files_missing_title: missingTitle,
			branch_errors: branchErrors,
		},
	};
	summary.metrics.total_files = summary.metrics.processed_files;

	fs.writeFileSync(aggregatedPath, JSON.stringify(outputs, null, 2));
	fs.writeFileSync(summaryJsonPath, JSON.stringify(summary, null, 2));
	fs.writeFileSync(summaryMdPath, buildMarkdown(summary));

	const deviations = [];
	if (outputs.length !== expectedTotal) {
		deviations.push({
			error: "count_mismatch",
			expected: expectedTotal,
			actual: outputs.length,
		});
	}
	if (missingTitle > 0) {
		deviations.push({
			error: "missing_title_detected",
			files: missingTitle,
			severity: "info",
		});
	}
	if (branchErrors > 0) {
		deviations.push({
			error: "branch_errors",
			count: branchErrors,
		});
	}

	const hasBlocking = deviations.some((item) => (item.severity ?? "error") !== "info");
	const output = {
		status: hasBlocking ? "failed" : "success",
		lane_id: LANE_ID,
		metrics: summary.metrics,
		artefacts: {
			summary_json: summaryJsonPath,
			summary_report: summaryMdPath,
			processed_records: aggregatedPath,
		},
		deviations,
	};

	if (deviations.length > 0) {
		console.warn(
			"[docs-summary-debug] deviations",
			JSON.stringify(
				{
					deviations,
					expected: expectedTotal,
					processed: outputs.length,
					topDirectories: summary.metrics.top_directories,
				},
				null,
				2,
			),
		);
	} else {
		console.info(
			"[docs-summary-debug] success",
			JSON.stringify(
				{
					processed: outputs.length,
					expected: expectedTotal,
					topDirectories: summary.metrics.top_directories,
				},
				null,
				2,
			),
		);
	}

	fs.writeFileSync(outputStatePath, JSON.stringify(output, null, 2));
	writeYAML(outputYamlPath, output);
} catch (error) {
	console.error("docs/summary.mjs failed:", error);
	process.exitCode = 1;
}
