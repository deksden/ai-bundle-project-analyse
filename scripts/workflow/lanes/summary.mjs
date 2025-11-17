import fs from "node:fs";
import path from "node:path";
import { findInputBySuffix, getInputValue, loadStageContext } from "../utils/context.mjs";
import { writeYAML } from "../utils/yaml.mjs";
import { synchronizeDocMatches } from "./utils/doc-matcher.mjs";

function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toNumber(value) {
	const num = Number(value);
	return Number.isFinite(num) ? num : undefined;
}

function findLaneEntry(container, laneId) {
	if (!container) return undefined;
	if (Array.isArray(container)) {
		return container.find((entry) => entry?.lane_id === laneId);
	}
	if (isObject(container) && container[laneId]) {
		return container[laneId];
	}
	if (isObject(container)) {
		return Object.values(container).find((entry) => entry?.lane_id === laneId);
	}
	return undefined;
}

function collectLaneInfo(lane, expected, laneId) {
	const laneDeviations = [];

	if (!lane || !isObject(lane)) {
		return {
			info: {
				lane_id: laneId,
				step_id: null,
				status: "missing",
				output_status: "missing",
				metrics: {},
				deviations: [],
			},
			laneDeviations: [
				{
					lane: laneId,
					error: "lane_missing",
				},
			],
		};
	}

	const outputs = lane.outputs ?? {};
	const metrics = outputs?.metrics ?? {};
	const deviations = Array.isArray(outputs?.deviations) ? outputs.deviations : [];
	const laneStatus = lane?.status ?? "unknown";
	const outputStatus = outputs?.status ?? "unknown";

	const info = {
		lane_id: laneId,
		step_id: lane?.step_id ?? null,
		status: laneStatus,
		output_status: outputStatus,
		metrics,
		deviations,
	};

	if (laneStatus !== "completed") {
		laneDeviations.push({
			lane: laneId,
			error: "lane_not_completed",
			status: laneStatus,
		});
	}

	if (outputStatus !== "success") {
		laneDeviations.push({
			lane: laneId,
			error: "lane_output_status",
			status: outputStatus,
		});
	}

	const totalFiles = Number(metrics?.total_files ?? NaN);
	if (!Number.isFinite(totalFiles) || totalFiles < 0) {
		laneDeviations.push({
			lane: laneId,
			error: "metrics_missing",
			field: "total_files",
		});
	} else if (expected && totalFiles !== expected) {
		laneDeviations.push({
			lane: laneId,
			error: "count_mismatch",
			expected,
			actual: totalFiles,
		});
	}

	const branchErrors = Number(metrics?.branch_errors ?? 0);
	if (branchErrors > 0) {
		laneDeviations.push({
			lane: laneId,
			error: "branch_errors",
			count: branchErrors,
		});
	}

	return { info, laneDeviations };
}

function buildMarkdown(summary) {
	const lines = [
		"# Combined Lane Summary",
		"",
		`Generated: ${summary.generated_at}`,
		"",
		"## Totals",
		"",
		`- Expected code files: ${summary.metrics.expected_code}`,
		`- Processed code files: ${summary.metrics.processed_code}`,
		`- Expected docs files: ${summary.metrics.expected_docs}`,
		`- Processed docs files: ${summary.metrics.processed_docs}`,
		`- Total processed files: ${summary.metrics.processed_files}`,
		`- Total branch errors: ${summary.metrics.branch_errors}`,
		`- Exported entities: ${summary.metrics.exports_total ?? 0}`,
		`- Documented exports: ${summary.metrics.export_documented ?? 0}`,
		`- Undocumented exports: ${summary.metrics.export_undocumented ?? 0}`,
		"",
		"## Lane Status",
		"",
		`- Code lane status: ${summary.lanes.code.status} (output: ${summary.lanes.code.output_status})`,
		`- Docs lane status: ${summary.lanes.docs.status} (output: ${summary.lanes.docs.output_status})`,
	];

	return `${lines.join("\n")}\n`;
}

try {
	const stepRoot = process.cwd();
	const context = loadStageContext(stepRoot);
	const parallelResults =
		getInputValue(context, "parallel_results") ??
		findInputBySuffix(context, ["parallel_results", "parallel.parallel_results"]);
	if (!isObject(parallelResults) && !Array.isArray(parallelResults)) {
		throw new Error("parallel_results payload missing or invalid");
	}

	const expectedCode =
		toNumber(getInputValue(context, "code.metrics.expected_files")) ??
		toNumber(
			findInputBySuffix(context, [
				"code.metrics.expected_files",
				"code_processed.metrics.expected_files",
				"start.metrics.code_files_count",
				"code_files_count",
			]),
		) ??
		0;

	const expectedDocs =
		toNumber(getInputValue(context, "docs.metrics.expected_files")) ??
		toNumber(
			findInputBySuffix(context, [
				"docs.metrics.expected_files",
				"docs_processed.metrics.expected_files",
				"start.metrics.doc_files_count",
				"doc_files_count",
			]),
		) ??
		0;

	const tmpDir = path.join(stepRoot, "tmp");
	const reportsDir = path.join(stepRoot, "reports");
	const analysisDir = path.join(stepRoot, "global", "analysis");
	fs.mkdirSync(tmpDir, { recursive: true });
	fs.mkdirSync(reportsDir, { recursive: true });

	const parallelPath = path.join(tmpDir, "parallel-results.json");
	fs.writeFileSync(parallelPath, JSON.stringify(parallelResults, null, 2));

	const codeLane = findLaneEntry(parallelResults, "code");
	const docsLane = findLaneEntry(parallelResults, "docs");

	const codeResult = collectLaneInfo(codeLane, expectedCode, "code");
	const docsResult = collectLaneInfo(docsLane, expectedDocs, "docs");

	const lanesSummary = {
		code: codeResult.info,
		docs: docsResult.info,
	};

	const dbPath =
		getInputValue(context, "db_path") ?? findInputBySuffix(context, ["db_path", "start.db_path"]);
	const taskId =
		context?.task?.id ??
		getInputValue(context, "task_id") ??
		findInputBySuffix(context, ["start.task_id"]);
	let docMatchResult = null;
	try {
		if (dbPath && taskId && fs.existsSync(path.join(analysisDir, "docs-process.json"))) {
			docMatchResult = synchronizeDocMatches({
				dbPath,
				taskId,
				analysisDir,
				reportsDir,
			});
		}
	} catch (error) {
		console.warn("[lanes-summary] doc match sync failed:", error instanceof Error ? error.message : error);
		deviations.push({
			lane: "docs",
			error: "doc_match_failed",
			message: error instanceof Error ? error.message : String(error),
		});
	}

	const totals = {
		expected_code: expectedCode,
		expected_docs: expectedDocs,
		processed_code: Number(codeResult.info.metrics?.total_files ?? 0),
		processed_docs: Number(docsResult.info.metrics?.total_files ?? 0),
		exports_total: docMatchResult?.metrics.exports_total ?? 0,
		export_documented: docMatchResult?.metrics.export_documented ?? 0,
		export_undocumented: docMatchResult?.metrics.export_undocumented ?? 0,
	};
	totals.processed_files = totals.processed_code + totals.processed_docs;
	totals.branch_errors =
		Number(codeResult.info.metrics?.branch_errors ?? 0) +
		Number(docsResult.info.metrics?.branch_errors ?? 0);

	const deviations = [...codeResult.laneDeviations, ...docsResult.laneDeviations];
	if ((docMatchResult?.metrics.export_undocumented ?? 0) > 0) {
		deviations.push({
			lane: "docs",
			error: "undocumented_exports",
			count: docMatchResult.metrics.export_undocumented,
		});
	}

	const summary = {
		generated_at: new Date().toISOString(),
		lanes: lanesSummary,
		metrics: totals,
		doc_matches: docMatchResult?.metrics,
	};

	const summaryJsonPath = path.join(reportsDir, "combined-summary.json");
	const summaryMdPath = path.join(reportsDir, "combined-summary.md");
	fs.writeFileSync(summaryJsonPath, JSON.stringify(summary, null, 2));
	fs.writeFileSync(summaryMdPath, buildMarkdown(summary));

	const status =
		deviations.some((item) => item.error !== "lane_missing" && item.error !== "missing_branch_results")
			? "failed"
			: "success";

	const outputStatePath = path.join(tmpDir, "lanes-summary-output.json");
	const output = {
		status,
		metrics: totals,
		lanes: lanesSummary,
		deviations,
		artefacts: {
			summary_json: summaryJsonPath,
			summary_report: summaryMdPath,
			parallel_snapshot: parallelPath,
		},
	};
	if (docMatchResult?.report) {
		output.artefacts.doc_matches_json = docMatchResult.report.jsonPath;
		output.artefacts.doc_matches_report = docMatchResult.report.mdPath;
	}

	fs.writeFileSync(outputStatePath, JSON.stringify(output, null, 2));
	writeYAML(path.join(stepRoot, "output.yaml"), output);
} catch (error) {
	console.error("lanes/summary.mjs failed:", error);
	process.exitCode = 1;
}
