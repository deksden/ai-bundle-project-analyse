import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
	findInputBySuffix,
	getInputValue,
	loadStageContext,
	resolveBundleRoot,
} from "../utils/context.mjs";
import { writeYAML } from "../utils/yaml.mjs";
import { ensureDocId } from "./utils.mjs";

function readProcessedEntries(context) {
	const direct = getInputValue(context, "docs_processed");
	if (Array.isArray(direct)) {
		return direct;
	}
	const fallback = findInputBySuffix(context, ["docs_processed"]);
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
	if (!entry || typeof entry !== "object") {
		return {};
	}
	const clone = JSON.parse(JSON.stringify(entry));
	delete clone.ingest;
	return clone;
}

function toJsonLines(records) {
	if (records.length === 0) {
		return "";
	}
	return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function writeToDatabase(bundleRoot, dbPath, taskId, ingestPath, logPath) {
	const projectRootEnv = process.env.AI_KOD_PROJECT_ROOT;
	const cwd =
		typeof projectRootEnv === "string" && projectRootEnv.length > 0
			? path.isAbsolute(projectRootEnv)
				? projectRootEnv
				: path.resolve(projectRootEnv)
			: bundleRoot;
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
			"docs-lane",
			"--log_file",
			logPath,
		],
		{
			stdio: "inherit",
			cwd,
		},
	);
	if (result.status !== 0) {
		throw new Error("write-to-db command failed for docs lane");
	}
}

function convertDocEntities(entry) {
	if (Array.isArray(entry?.ingest?.raw_doc_entities)) {
		return entry.ingest.raw_doc_entities;
	}
	if (!Array.isArray(entry?.doc_entities)) {
		return [];
	}
	const documentPath = entry?.file?.path ?? entry?.file?.absolute_path ?? entry?.file?.relative_path ?? "document";
	return entry.doc_entities.map((entity, index) => ({
		type: "raw_doc_entity",
		doc_id: entity.doc_id ?? ensureDocId({ documentPath, heading: entity.heading, index }),
		document_path: documentPath,
		heading: entity.heading ?? `Section ${index + 1}`,
		anchor: entity.anchor ?? null,
		block_start_line: entity.block_start_line ?? null,
		block_end_line: entity.block_end_line ?? null,
		content_hash: entity.content_hash ?? null,
		metadata: {
			summary: entity.summary ?? null,
			tags: entity.tags ?? [],
			topics: entity.topics ?? [],
			references: entity.references ?? [],
			evidence: entity.evidence ?? null,
			doc_language: entry?.file?.language ?? null,
			doc_format: entry?.file?.format ?? entry?.file?.extension ?? null,
		},
	}));
}

function convertRelationships(entry) {
	if (Array.isArray(entry?.ingest?.raw_relationships)) {
		return entry.ingest.raw_relationships;
	}
	if (!Array.isArray(entry?.doc_relationships)) {
		return [];
	}
	const documentPath = entry?.file?.path ?? entry?.file?.absolute_path ?? null;
	return entry.doc_relationships
		.map((relationship, index) => {
			if (!relationship || typeof relationship !== "object") {
				return null;
			}
			const relationshipId =
				typeof relationship.relationship_id === "string" && relationship.relationship_id.length > 0
					? relationship.relationship_id
					: `${entry?.file?.relative_path ?? "doc"}#rel-${index + 1}`;
			return {
				type: "raw_relationship",
				relationship_id: relationshipId,
				kind: relationship.kind ?? "references-code",
				source_symbol_id: relationship.source_doc_id ?? null,
				target_symbol_id: relationship.target_symbol_id ?? null,
				source_path: documentPath,
				target_path: relationship.target_path ?? null,
				metadata: {
					description: relationship.description ?? null,
					evidence: relationship.evidence ?? null,
				},
			};
		})
		.filter(Boolean);
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
		throw new Error("db_path input is required for docs-collect");
	}

	const entries = readProcessedEntries(context)
		.map(unwrapEntry)
		.filter((entry) => entry && typeof entry === "object");

	const analysisRecords = entries.map(sanitizeForAnalysis);
	const aggregatedPath = path.join(analysisDir, "docs-process.json");
	fs.writeFileSync(aggregatedPath, JSON.stringify(analysisRecords, null, 2));

	const ingestionRecords = [];
	const deviations = [];
	let processedFiles = 0;
	let ingestedFiles = 0;
	let docEntitiesTotal = 0;
	let docRelationshipsTotal = 0;
	let cliMentions = 0;

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
		const docEntityRecords = convertDocEntities(entry);
		const relationshipRecords = convertRelationships(entry);
		if (docEntityRecords.length === 0) {
			deviations.push({
				error: "missing_doc_entities",
				file: entry?.file?.display_path ?? entry?.file?.path ?? "unknown",
			});
			continue;
		}
		docEntitiesTotal += docEntityRecords.length;
		docRelationshipsTotal += relationshipRecords.length;
		ingestionRecords.push(...docEntityRecords, ...relationshipRecords);
		ingestedFiles += 1;
		if (Array.isArray(entry?.mentions)) {
			cliMentions += entry.mentions.filter((mention) => mention?.type === "cli").length;
		}
	}

	const ingestPath = path.join(analysisDir, "docs-ingest.jsonl");
	fs.writeFileSync(ingestPath, toJsonLines(ingestionRecords));

	const logPath = path.join(logsDir, "docs-write-to-db.log");
	const taskId = context?.task?.id ?? "docs-lane";
	if (ingestionRecords.length > 0) {
		writeToDatabase(bundleRoot, dbPath, taskId, ingestPath, logPath);
	} else {
		deviations.push({
			error: "no_ingestion_records",
			message: "Документационная линия не произвела записей для ingest",
		});
	}

	const outputState = {
		status: deviations.length > 0 ? "failed" : "success",
		lane_id: "docs",
		metrics: {
			processed_files: processedFiles,
			ingested_files: ingestedFiles,
			doc_entities: docEntitiesTotal,
			doc_relationships: docRelationshipsTotal,
			mentions_cli: cliMentions,
		},
		artefacts: {
			analysis_records: aggregatedPath,
			ingest_jsonl: ingestPath,
			write_log: logPath,
		},
		deviations,
	};

	fs.writeFileSync(path.join(stepRoot, "docs-collect.json"), JSON.stringify(outputState, null, 2));
	writeYAML(path.join(stepRoot, "output.yaml"), outputState);
} catch (error) {
	console.error("docs/collect.mjs failed:", error);
	process.exitCode = 1;
}
