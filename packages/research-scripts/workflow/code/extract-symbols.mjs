import fs from "node:fs";
import path from "node:path";

import { getInputObject, getInputValue, loadStageContext, resolvePathRelativeToProject } from "../utils/context.mjs";
import { writeYAML } from "../utils/yaml.mjs";
import { createCodeExtractionOptions } from "../../code/index.js";
import { detectLanguage, parseWithTreeSitter } from "../../utils/tree-sitter.js";
import { sha256Hex, xxhash64 } from "../../utils/hash.js";

function requireAbsolute(candidate, projectRoot) {
	if (typeof candidate === "string" && candidate.length > 0) {
		return path.isAbsolute(candidate) ? candidate : path.join(projectRoot, candidate);
	}
	return null;
}

function createSymbolId(relativePath, entity, salt = "") {
	const stableParts = [
		relativePath ?? "",
		entity?.kind ?? "",
		entity?.name ?? "",
		entity?.location?.start?.line ?? 0,
		salt,
	];
	return `sym_${sha256Hex(stableParts.join(":")).slice(0, 16)}`;
}

function createFileSymbolId(relativePath) {
	return `file_${sha256Hex(relativePath ?? "").slice(0, 12)}`;
}

function buildFileRecord(fileInfo, language, hashAlgorithm) {
	return {
		type: "file",
		path: fileInfo.absolute_path,
		hash: fileInfo.content_hash,
		hash_algorithm: hashAlgorithm,
		kind: "code",
		size: fileInfo.size,
		metadata: {
			language,
			display_path: fileInfo.display_path,
			index: fileInfo.index,
			relative_path: fileInfo.relative_path,
		},
	};
}

function summarizeEntity(entity) {
	return {
		name: entity.name,
		kind: entity.kind,
		category: entity.category,
		exported: entity.exported,
		lines:
			entity.location != null
				? [entity.location.start.line + 1, entity.location.end.line + 1]
				: undefined,
		doc_summary: entity.doc?.summary ?? null,
	};
}

function buildRawEntityRecord(entity, fileInfo, language) {
	const symbolId = createSymbolId(fileInfo.relative_path, entity);
	const snippetHash = entity.snippet ? sha256Hex(entity.snippet) : null;
	const docHash = entity.doc?.raw ? sha256Hex(entity.doc.raw) : null;
	return {
		type: "raw_code_entity",
		file_path: fileInfo.absolute_path,
		symbol_id: symbolId,
		stable_key: symbolId,
		kind: entity.kind,
		name: entity.name,
		signature: entity.signature,
		start_offset: entity.location?.start?.offset ?? 0,
		end_offset: entity.location?.end?.offset ?? 0,
		line_start: (entity.location?.start?.line ?? 0) + 1,
		line_end: (entity.location?.end?.line ?? 0) + 1,
		content_hash: snippetHash,
		docblock_hash: docHash,
		metadata: {
			language,
			exported: entity.exported,
			async: entity.async,
			doc: entity.doc
				? {
						summary: entity.doc.summary,
						description: entity.doc.description,
						tags: entity.doc.tags,
					}
				: null,
		},
	};
}

function buildRelationshipRecords(imports = [], fileInfo) {
	const fileSymbol = createFileSymbolId(fileInfo.relative_path);
	const rows = [];
	for (const entry of imports) {
		const base = `${fileSymbol}:${entry.module}:${entry.specifiers?.join(",") ?? ""}`;
		rows.push({
			type: "raw_relationship",
			relationship_id: `rel_${sha256Hex(base).slice(0, 16)}`,
			kind: entry.kind ?? "import",
			source_symbol_id: fileSymbol,
			target_symbol_id: `module:${entry.module}`,
			source_path: fileInfo.absolute_path,
			target_path: entry.module,
			metadata: {
				module: entry.module,
				specifiers: entry.specifiers ?? [],
				kind: entry.kind ?? "import",
			},
		});
	}
	return rows;
}

function ensureOptions(stepRoot) {
	const globalRoot = path.join(stepRoot, "global");
	const analysisDir = path.join(globalRoot, "analysis");
	const runtimePath = path.join(analysisDir, "config.runtime.json");
	const fallbackPath = path.join(analysisDir, "config.json");
	let codeOptions = {};
	if (fs.existsSync(runtimePath)) {
		try {
			const runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8"));
			codeOptions = runtime?.code_lane ?? {};
		} catch {
			codeOptions = {};
		}
	} else if (fs.existsSync(fallbackPath)) {
		try {
			const runtime = JSON.parse(fs.readFileSync(fallbackPath, "utf8"));
			codeOptions = runtime?.code_lane ?? {};
		} catch {
			codeOptions = {};
		}
	}
	return createCodeExtractionOptions(codeOptions);
}

function resolveFileInfo(codeItem, projectRoot) {
	const absolute =
		requireAbsolute(codeItem.path, projectRoot) ??
		requireAbsolute(codeItem.absolute_path, projectRoot) ??
		requireAbsolute(codeItem.relative_path, projectRoot);
	if (!absolute) {
		throw new Error("code_item.path is missing in stage context");
	}
	if (!fs.existsSync(absolute)) {
		throw new Error(`Code file not found: ${absolute}`);
	}
	const stats = fs.statSync(absolute);
	const resolution = resolvePathRelativeToProject(projectRoot, absolute);
	const relativePath = resolution.ok ? resolution.relative : path.relative(projectRoot, absolute);
	return {
		absolute_path: absolute,
		relative_path: relativePath,
		display_path:
			typeof codeItem.display_path === "string"
				? codeItem.display_path
				: relativePath ?? path.basename(absolute),
		size: stats.size,
		index: Number.isFinite(codeItem.index) ? Number(codeItem.index) : -1,
		content_hash: typeof codeItem.content_hash === "string" ? codeItem.content_hash : null,
		hash_algorithm: codeItem.hash_algorithm ?? null,
	};
}

function ensureFileHash(fileInfo) {
	if (fileInfo.content_hash) {
		return fileInfo.content_hash;
	}
	return xxhash64(fs.readFileSync(fileInfo.absolute_path));
}

async function run() {
	const stepRoot = process.cwd();
	const context = loadStageContext(stepRoot);
	const projectRoot = getInputValue(context, "project_root");
	if (typeof projectRoot !== "string" || projectRoot.length === 0) {
		throw new Error("project_root input is required for code lane");
	}

	const options = ensureOptions(stepRoot);
	const codeItem = getInputObject(context, "code_item") ?? {};
	const fileInfo = resolveFileInfo(codeItem, projectRoot);

	const language =
		codeItem.language ??
		detectLanguage(fileInfo.absolute_path, path.extname(fileInfo.absolute_path));
	if (!language) {
		throw new Error(`Unable to determine language for ${fileInfo.absolute_path}`);
	}

	const outputStatePath = path.join(stepRoot, "code-process.json");
	const outputYamlPath = path.join(stepRoot, "output.yaml");

	const output = {
		status: "success",
		lane_id: "code",
		file: {
			index: fileInfo.index,
			path: fileInfo.absolute_path,
			absolute_path: fileInfo.absolute_path,
			relative_path: fileInfo.relative_path,
			display_path: fileInfo.display_path,
			extension: path.extname(fileInfo.display_path).toLowerCase(),
			language,
		},
		hash: {
			algorithm: options.hashAlgorithm,
			value: ensureFileHash(fileInfo),
		},
		metrics: {
			size_bytes: fileInfo.size,
		},
		entities: [],
		relationships: [],
		ingest: {
			files: null,
			raw_code_entities: [],
			raw_relationships: [],
		},
		deviations: [],
		diagnostics: [],
	};

	try {
		const parseResult = await parseWithTreeSitter(
			fileInfo.absolute_path,
			language,
			{
				includeJsdoc: options.includeJsdoc,
			},
		);

		const summaryEntities = (parseResult.entities ?? []).map(summarizeEntity);
		const rawEntityRecords = (parseResult.entities ?? []).map((entity) =>
			buildRawEntityRecord(entity, fileInfo, language),
		);
		const relationshipRecords = buildRelationshipRecords(parseResult.imports, fileInfo);

		output.entities = summaryEntities;
		output.relationships = parseResult.imports ?? [];
		output.metrics.total_entities = summaryEntities.length;
		output.metrics.documented_entities = summaryEntities.filter(
			(item) => typeof item.doc_summary === "string" && item.doc_summary.length > 0,
		).length;
		output.metrics.imports = (parseResult.imports ?? []).length;
		output.diagnostics = parseResult.diagnostics ?? [];
		output.ingest.files = buildFileRecord(fileInfo, language, options.hashAlgorithm);
		output.ingest.raw_code_entities = rawEntityRecords;
		output.ingest.raw_relationships = relationshipRecords;
	} catch (error) {
		output.status = "failed";
		output.deviations.push({
			error: "parse_failed",
			message: error instanceof Error ? error.message : String(error),
		});
	}

	fs.writeFileSync(outputStatePath, JSON.stringify(output, null, 2));
	writeYAML(outputYamlPath, output);
}

run().catch((error) => {
	console.error("code/extract-symbols.mjs failed:", error);
	process.exitCode = 1;
});
