import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { findInputBySuffix, getInputValue, loadStageContext, resolveBundleRoot } from "../utils/context.mjs";
import { writeYAML } from "../utils/yaml.mjs";

function readProcessedEntries(context) {
	const direct = getInputValue(context, "code_processed");
	if (Array.isArray(direct)) {
		return direct;
	}
	const fallback = findInputBySuffix(context, ["code_processed"]);
	return Array.isArray(fallback) ? fallback : [];
}

function unwrapEntry(entry) {
	if (!entry || typeof entry !== "object") {
		return null;
	}
	if (entry.outputs && typeof entry.outputs === "object") {
		return entry.outputs;
	}
	return entry;
}

function sanitizeForAnalysis(entry) {
	const clone = structuredClone ? structuredClone(entry) : JSON.parse(JSON.stringify(entry));
	if (clone && typeof clone === "object") {
		delete clone.ingest;
	}
	return clone;
}

function toJsonLines(records) {
	if (records.length === 0) {
		return "";
	}
	return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function writeToDatabase(bundleRoot, dbPath, taskId, ingestPath, logPath) {
	const result = spawnSync(
		"pnpm",
		[
			"exec",
			"tsx",
			path.join(bundleRoot, "scripts/write-to-db.ts"),
			"--db_path",
			dbPath,
			"--task_id",
			taskId,
			"--ingest_path",
			ingestPath,
			"--source",
			"code-lane",
			"--log_file",
			logPath,
		],
		{
			stdio: "inherit",
			cwd: bundleRoot,
		},
	);
	if (result.status !== 0) {
		throw new Error("write-to-db command failed for code lane");
	}
}

try {
	const stepRoot = process.cwd();
	const context = loadStageContext(stepRoot);
	const bundleRoot = resolveBundleRoot(stepRoot);
	const globalRoot = path.join(stepRoot, "global");
	const analysisDir = path.join(globalRoot, "analysis");
	const logsDir = path.join(globalRoot, "logs");
	fs.mkdirSync(analysisDir, { recursive: true });
	fs.mkdirSync(logsDir, { recursive: true });

	const dbPath =
		getInputValue(context, "db_path") ??
		findInputBySuffix(context, ["db_path", "start.db_path"]);
	if (typeof dbPath !== "string" || dbPath.length === 0) {
		throw new Error("db_path input is required for code-collect");
	}

	const entries = readProcessedEntries(context)
		.map(unwrapEntry)
		.filter((entry) => entry && typeof entry === "object");

	const analysisRecords = entries.map(sanitizeForAnalysis);
	const aggregatedPath = path.join(analysisDir, "code-process.json");
	fs.writeFileSync(aggregatedPath, JSON.stringify(analysisRecords, null, 2));

	const ingestionRecords = [];
	const deviations = [];
	let processedFiles = 0;
	let ingestedFiles = 0;
	let rawEntities = 0;
	let rawRelationships = 0;

	for (const entry of entries) {
		if (entry.status !== "success") {
			deviations.push({
				error: "branch_failed",
				file: entry?.file?.display_path ?? entry?.file?.path ?? "unknown",
				message: entry?.deviations ?? entry?.error ?? "Branch reported failure",
			});
			continue;
		}
		processedFiles += 1;
		if (entry.ingest?.files) {
			ingestionRecords.push(entry.ingest.files);
			ingestedFiles += 1;
		}
		if (Array.isArray(entry.ingest?.raw_code_entities)) {
			for (const record of entry.ingest.raw_code_entities) {
				ingestionRecords.push(record);
				rawEntities += 1;
			}
		}
		if (Array.isArray(entry.ingest?.raw_relationships)) {
			for (const record of entry.ingest.raw_relationships) {
				ingestionRecords.push(record);
				rawRelationships += 1;
			}
		}
	}

	const ingestPath = path.join(analysisDir, "code-ingest.jsonl");
	fs.writeFileSync(ingestPath, toJsonLines(ingestionRecords));

	const logPath = path.join(logsDir, "code-write-to-db.log");
	const taskId = context?.task?.id ?? "code-lane";
	if (ingestionRecords.length > 0) {
		writeToDatabase(bundleRoot, dbPath, taskId, ingestPath, logPath);
	} else {
		deviations.push({
			error: "no_ingestion_records",
			message: "No code entities were produced for ingestion",
		});
	}

	const outputState = {
		status: deviations.length > 0 ? "failed" : "success",
		lane_id: "code",
		metrics: {
			processed_files: processedFiles,
			ingested_files: ingestedFiles,
			raw_entities: rawEntities,
			raw_relationships: rawRelationships,
		},
		artefacts: {
			analysis_records: aggregatedPath,
			ingest_jsonl: ingestPath,
			write_log: logPath,
		},
		deviations,
	};

	fs.writeFileSync(path.join(stepRoot, "code-collect.json"), JSON.stringify(outputState, null, 2));
	writeYAML(path.join(stepRoot, "output.yaml"), outputState);
} catch (error) {
	console.error("code/collect.mjs failed:", error);
	process.exitCode = 1;
}
