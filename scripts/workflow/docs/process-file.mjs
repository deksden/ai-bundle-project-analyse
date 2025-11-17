import fs from "node:fs";
import path from "node:path";

import { getInputObject, loadStageContext } from "../utils/context.mjs";
import { writeYAML } from "../utils/yaml.mjs";
import {
	buildRelationshipId,
	deriveDocumentSummary,
	ensureDocId,
	normalizeMentions,
	slugifyHeading,
	computeContentHashFromText,
} from "./utils.mjs";

function ensureArray(value, description) {
	if (!Array.isArray(value)) {
		throw new Error(`${description} must be an array`);
	}
	return value;
}

function readJsonFile(filePath) {
	if (!fs.existsSync(filePath)) {
		throw new Error(
			`docs-process.json не найден. Подготовь JSON с docEntityRaw и сохраните по пути: ${filePath}`,
		);
	}
	try {
		const raw = fs.readFileSync(filePath, "utf8");
		return JSON.parse(raw);
	} catch (error) {
		throw new Error(
			`Не удалось прочитать docs-process.json: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function normalizeDocEntities(rawEntities, fileInfo) {
	const entities = ensureArray(rawEntities, "doc_entities");
	return entities.map((entry, index) => {
		if (!entry || typeof entry !== "object") {
			throw new Error(`doc_entities[${index}] должен быть объектом`);
		}
		const heading =
			typeof entry.heading === "string" && entry.heading.trim()
				? entry.heading.trim()
				: typeof entry.title === "string" && entry.title.trim()
					? entry.title.trim()
					: `Section ${index + 1}`;
		const anchor =
			typeof entry.anchor === "string" && entry.anchor.trim().length > 0
				? slugifyHeading(entry.anchor)
				: slugifyHeading(heading, `section-${index + 1}`);
		const docId =
			typeof entry.doc_id === "string" && entry.doc_id.trim().length > 0
				? entry.doc_id.trim()
				: ensureDocId({
						documentPath: fileInfo.path,
						relativePath: fileInfo.relative_path,
						heading,
						anchor,
						index,
					});
		const summary =
			typeof entry.summary === "string" && entry.summary.trim().length > 0 ? entry.summary.trim() : null;
		const lineStart =
			typeof entry.block_start_line === "number"
				? entry.block_start_line
				: typeof entry.line_start === "number"
					? entry.line_start
					: null;
		const lineEnd =
			typeof entry.block_end_line === "number"
				? entry.block_end_line
				: typeof entry.line_end === "number"
					? entry.line_end
					: null;
		const topics = Array.isArray(entry.topics) ? entry.topics.map(String) : [];
		const tags = Array.isArray(entry.tags) ? entry.tags.map(String) : [];
		const references = Array.isArray(entry.references) ? entry.references : [];
		const evidence =
			typeof entry.evidence === "string" && entry.evidence.trim().length > 0 ? entry.evidence.trim() : null;
		const primaryContent =
			typeof entry.content === "string" && entry.content.length > 0
				? entry.content
				: [heading, summary ?? "", evidence ?? ""].join("\n");
		const contentHash =
			typeof entry.content_hash === "string" && entry.content_hash.length > 0
				? entry.content_hash
				: computeContentHashFromText(primaryContent);

		return {
			doc_id: docId,
			heading,
			anchor,
			block_start_line: lineStart,
			block_end_line: lineEnd,
			summary,
			tags,
			topics,
			references,
			evidence,
			content_hash: contentHash,
		};
	});
}

function normalizeRelationships(rawRelationships, entities, fileInfo) {
	if (!rawRelationships) {
		return [];
	}
	const relationships = ensureArray(rawRelationships, "doc_relationships");
	const knownIds = new Set(entities.map((entity) => entity.doc_id));

	return relationships
		.map((entry, index) => {
			if (!entry || typeof entry !== "object") {
				return null;
			}
			const sourceId =
				typeof entry.source_doc_id === "string" && knownIds.has(entry.source_doc_id)
					? entry.source_doc_id
					: entities[0]?.doc_id;
			if (!sourceId) {
				return null;
			}
			const relationshipId =
				typeof entry.relationship_id === "string" && entry.relationship_id.trim().length > 0
					? entry.relationship_id.trim()
					: buildRelationshipId(sourceId, `${entry.kind ?? "reference"}-${index + 1}`);
			const targetSymbol =
				typeof entry.target_symbol_id === "string"
					? entry.target_symbol_id
					: typeof entry.target === "string"
						? entry.target
						: null;

			return {
				relationship_id: relationshipId,
				kind: entry.kind ?? "references-code",
				source_doc_id: sourceId,
				target_symbol_id: targetSymbol,
				target_path: entry.target_path ?? null,
				description:
					typeof entry.description === "string"
						? entry.description
						: typeof entry.notes === "string"
							? entry.notes
							: null,
				evidence:
					typeof entry.evidence === "string"
						? entry.evidence
						: typeof entry.quote === "string"
							? entry.quote
							: null,
			};
		})
		.filter(Boolean);
}

function buildFileInfo(docItem) {
	const relativePath =
		typeof docItem?.relative_path === "string" && docItem.relative_path.length > 0
			? docItem.relative_path
			: docItem?.display_path ?? docItem?.path ?? "document";
	const displayPath =
		typeof docItem?.display_path === "string" && docItem.display_path.length > 0
			? docItem.display_path
			: relativePath;
	const extension =
		typeof docItem?.extension === "string" && docItem.extension.length > 0
			? docItem.extension
			: path.extname(displayPath || docItem?.path || "").toLowerCase();
	return {
		index: Number(docItem?.index ?? -1),
		path: docItem?.path ?? docItem?.absolute_path ?? "",
		absolute_path: docItem?.path ?? docItem?.absolute_path ?? "",
		relative_path: relativePath,
		display_path: displayPath,
		extension,
		top_directory: docItem?.top_directory ?? displayPath.split("/")[0] ?? ".",
		format: docItem?.format ?? docItem?.doc_format ?? "plain_text",
		language: docItem?.language ?? "en",
		content_hash: docItem?.content_hash ?? null,
		hash_algorithm: docItem?.hash_algorithm ?? "xxhash64",
	};
}

try {
	const stepRoot = process.cwd();
	const context = loadStageContext(stepRoot);
	const docItem = getInputObject(context, "doc_item") ?? {};
	const fileInfo = buildFileInfo(docItem);
	if (!fileInfo.path) {
		throw new Error("doc_item.path отсутствует в контексте стадии");
	}

	const statePath = path.join(stepRoot, "docs-process.json");
	const rawData = readJsonFile(statePath);
	const docEntities = normalizeDocEntities(rawData.doc_entities ?? rawData.entities ?? [], fileInfo);
	const docRelationships = normalizeRelationships(
		rawData.doc_relationships ?? rawData.relationships ?? [],
		docEntities,
		fileInfo,
	);
	const mentions = normalizeMentions(rawData.mentions ?? rawData.notes ?? []);

	const deviations = [];
	if (docEntities.length === 0) {
		deviations.push({
			error: "missing_doc_entities",
			message: "Добавьте как минимум одну запись docEntityRaw в docs-process.json",
		});
	}
	if (!mentions.some((entry) => entry.type === "cli")) {
		deviations.push({
			error: "missing_cli_mention",
			severity: "warning",
			message: "Добавьте запись в mentions с type=cli (analysis-cli doc insert — обязательная команда).",
		});
	}

	const docSummary =
		typeof rawData.doc === "object" && rawData.doc
			? {
					title:
						typeof rawData.doc.title === "string" && rawData.doc.title.length > 0
							? rawData.doc.title
							: deriveDocumentSummary(docItem, docEntities).title,
					summary:
						typeof rawData.doc.summary === "string" && rawData.doc.summary.length > 0
							? rawData.doc.summary
							: deriveDocumentSummary(docItem, docEntities).summary,
					topics: Array.isArray(rawData.doc.topics) ? rawData.doc.topics : [],
					hash: rawData.doc.hash ?? docItem?.content_hash ?? null,
			  }
			: deriveDocumentSummary(docItem, docEntities);

	const output = {
		status: docEntities.length > 0 && deviations.length === 0 ? "success" : "failed",
		lane_id: "docs",
		file: fileInfo,
		doc_summary: docSummary,
		doc_entities: docEntities,
		doc_relationships: docRelationships,
		mentions,
		metrics: {
			total_sections: docEntities.length,
			relationships_total: docRelationships.length,
			mentions_total: mentions.length,
			doc_language: fileInfo.language,
			doc_format: fileInfo.format,
		},
		deviations,
	};

	fs.writeFileSync(statePath, JSON.stringify(output, null, 2));
	writeYAML(path.join(stepRoot, "output.yaml"), output);
} catch (error) {
	console.error("docs/process-file.mjs failed:", error);
	process.exitCode = 1;
}
