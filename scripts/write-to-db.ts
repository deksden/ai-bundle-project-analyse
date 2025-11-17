import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { setupLogWriter } from "./utils/logging.js";
import { isMainModule } from "./utils/module.js";
import { escapeSqlValue, runSql } from "./utils/sqlite.js";

type LegacyRecordType = "entity" | "relationship" | "layer" | "slice" | "evidence";

type IngestRecord =
	| { type: LegacyRecordType; [key: string]: unknown }
	| FileRecord
	| RawCodeEntityRecord
	| RawDocEntityRecord
	| RawDocBlockRecord
	| RawRelationshipRecord
	| ResultEntityRecord
	| ResultRelationshipRecord
	| DocMatchRecord;

interface FileRecord {
	type: "file";
	path: string;
	hash?: string;
	hash_algorithm?: string;
	kind?: string;
	size?: number;
	metadata?: unknown;
}

interface RawCodeEntityRecord {
	type: "raw_code_entity";
	run_id?: string;
	file_path: string;
	symbol_id: string;
	stable_key?: string;
	kind?: string;
	name?: string;
	signature?: string;
	start_offset?: number;
	end_offset?: number;
	line_start?: number;
	line_end?: number;
	content_hash?: string;
	docblock_hash?: string;
	jsdoc_text?: string;
	metadata?: unknown;
}

interface RawDocEntityRecord {
	type: "raw_doc_entity";
	run_id?: string;
	doc_id: string;
	document_path: string;
	heading?: string;
	anchor?: string;
	block_start_line?: number;
	block_end_line?: number;
	content_hash?: string;
	metadata?: unknown;
}

interface RawDocBlockRecord {
	type: "raw_doc_block";
	run_id?: string;
	block_id: string;
	doc_id: string;
	document_path: string;
	block_index?: number;
	heading?: string;
	content?: string;
	content_hash?: string;
	metadata?: unknown;
}

interface RawRelationshipRecord {
	type: "raw_relationship";
	run_id?: string;
	relationship_id: string;
	kind?: string;
	source_symbol_id?: string;
	target_symbol_id?: string;
	source_path?: string;
	target_path?: string;
	metadata?: unknown;
}

interface ResultEntityRecord {
	type: "result_entity";
	entity_id: string;
	entity_type: string;
	name: string;
	stable_key?: string;
	coverage_status?: string | null;
	confidence?: number | null;
	path?: string | null;
	metadata?: unknown;
}

interface ResultRelationshipRecord {
	type: "result_relationship";
	relationship_id: string;
	kind: string;
	source_id: string;
	target_id: string;
	metadata?: unknown;
}

interface DocMatchRecord {
	type: "doc_match";
	doc_key: string;
	code_key: string;
	match_kind?: string;
	confidence?: number;
	metadata?: unknown;
}

interface RuntimeConfig {
	hash_algorithm?: string;
	cleanup_batch_size?: number;
	ingest?: {
		hash_algorithm?: string;
		cleanup_batch_size?: number;
	};
}

export interface WriteToDbOptions {
	dbPath: string;
	taskId: string;
	ingestPath: string;
	source?: string;
}

export interface WriteToDbResult {
	taskId: string;
	source: string;
	totalRecords: number;
	counts: Record<string, number>;
}

interface HandlerContext {
	nowIso: string;
	nowValue: string;
	runValue: string;
	taskId: string;
	hashAlgorithm: string;
	counts: Record<string, number>;
	statements: string[];
}

const LEGACY_TYPES: LegacyRecordType[] = ["entity", "relationship", "layer", "slice", "evidence"];

function serializeMetadata(metadata: unknown): string | null {
	if (metadata == null) return null;
	try {
		return JSON.stringify(metadata);
	} catch {
		return null;
	}
}

function computeHash(payload: unknown, algorithm: string): string {
	const hash = createHash(algorithm);
	hash.update(JSON.stringify(payload));
	return hash.digest("hex");
}

function loadRuntimeConfig(dbPath: string): RuntimeConfig {
	const dbDir = path.dirname(dbPath);
	const candidates = [
		path.join(dbDir, "config.runtime.json"),
		path.join(dbDir, "config.json"),
	];

	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			try {
				return JSON.parse(fs.readFileSync(candidate, "utf8")) as RuntimeConfig;
			} catch {
				// ignore parse errors, fall back to defaults
			}
		}
	}

	return {};
}

function resolveHashAlgorithm(config: RuntimeConfig): string {
	return (
		config.ingest?.hash_algorithm ??
		config.hash_algorithm ??
		"sha256"
	).toLowerCase();
}

function resolveCleanupBatchSize(config: RuntimeConfig): number {
	const value = config.ingest?.cleanup_batch_size ?? config.cleanup_batch_size;
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return Math.floor(value);
	}
	return 500;
}

function readJsonLines(ingestPath: string): unknown[] {
	const raw = fs.readFileSync(ingestPath, "utf8");
	const lines = raw
		.split(/\r?\n/g)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	return lines.map((line, index) => {
		try {
			return JSON.parse(line) as unknown;
		} catch (error) {
			throw new Error(`Failed to parse JSON on line ${index + 1}: ${(error as Error).message}`);
		}
	});
}

function ensureIngestLog(dbPath: string, runValue: string, sourceValue: string, nowValue: string) {
	runSql(dbPath, [
		"BEGIN",
		`DELETE FROM ingest_log WHERE run_id=${runValue} AND source=${sourceValue}`,
		`INSERT INTO ingest_log (run_id, source, status, created_at, details) VALUES (${runValue}, ${sourceValue}, 'processing', ${nowValue}, NULL)`,
		"COMMIT",
	]);
}

function updateIngestLogStatus(
	dbPath: string,
	runValue: string,
	sourceValue: string,
	status: "completed" | "failed",
	details: unknown,
) {
	runSql(dbPath, [
		`UPDATE ingest_log SET status='${status}', details=${escapeSqlValue(
			details == null ? null : JSON.stringify(details),
		)} WHERE run_id=${runValue} AND source=${sourceValue}`,
	]);
}

function incrementCounter(counts: Record<string, number>, key: string): void {
	counts[key] = (counts[key] ?? 0) + 1;
}

function handleFileRecord(record: FileRecord, ctx: HandlerContext): void {
	const metadata = serializeMetadata(record.metadata);
	const hash =
		record.hash ??
		computeHash(
			{
				path: record.path,
				size: record.size ?? null,
				kind: record.kind ?? "unknown",
			},
			ctx.hashAlgorithm,
		);

	const pathValue = escapeSqlValue(record.path);
	const kindValue = escapeSqlValue(record.kind ?? "unknown");
	const hashValue = escapeSqlValue(hash);
	const hashAlgorithmValue = escapeSqlValue(record.hash_algorithm ?? ctx.hashAlgorithm);
	const sizeValue =
		typeof record.size === "number" && Number.isFinite(record.size)
			? String(Math.floor(record.size))
			: "NULL";

	ctx.statements.push(
		`INSERT INTO files (path, kind, hash, hash_algorithm, size, metadata, last_seen_run, first_seen_run, created_at, updated_at)
VALUES (${pathValue}, ${kindValue}, ${hashValue}, ${hashAlgorithmValue}, ${sizeValue}, ${escapeSqlValue(metadata)}, ${ctx.runValue}, COALESCE((SELECT first_seen_run FROM files WHERE path=${pathValue}), ${ctx.runValue}), ${ctx.nowValue}, ${ctx.nowValue})
ON CONFLICT(path) DO UPDATE SET kind=excluded.kind, hash=excluded.hash, hash_algorithm=excluded.hash_algorithm, size=excluded.size, metadata=excluded.metadata, last_seen_run=${ctx.runValue}, updated_at=${ctx.nowValue}`,
	);

	incrementCounter(ctx.counts, "files");
}

function handleRawCodeEntity(record: RawCodeEntityRecord, ctx: HandlerContext): void {
	if (!record.symbol_id) {
		throw new Error("raw_code_entity requires symbol_id");
	}
	let metadataPayload: unknown = record.metadata ?? null;
	if (record.jsdoc_text) {
		if (
			metadataPayload &&
			typeof metadataPayload === "object" &&
			!Array.isArray(metadataPayload)
		) {
			(metadataPayload as Record<string, unknown>).jsdoc_text = record.jsdoc_text;
		} else {
			metadataPayload = { jsdoc_text: record.jsdoc_text };
		}
	}
	const metadata = serializeMetadata(metadataPayload);
	const payload = {
		file_path: record.file_path,
		symbol_id: record.symbol_id,
		stable_key: record.stable_key ?? null,
		kind: record.kind ?? null,
		signature: record.signature ?? null,
		content_hash: record.content_hash ?? null,
		docblock_hash: record.docblock_hash ?? null,
	};
	const hash = computeHash(payload, ctx.hashAlgorithm);
	const symbolValue = escapeSqlValue(record.symbol_id);
	const fileValue = escapeSqlValue(record.file_path);
	const stableKey = escapeSqlValue(record.stable_key ?? null);
	const kindValue = escapeSqlValue(record.kind ?? null);
	const nameValue = escapeSqlValue(record.name ?? null);
	const signatureValue = escapeSqlValue(record.signature ?? null);
	const startOffset =
		record.start_offset != null && Number.isFinite(record.start_offset)
			? String(Math.floor(record.start_offset))
			: "NULL";
	const endOffset =
		record.end_offset != null && Number.isFinite(record.end_offset)
			? String(Math.floor(record.end_offset))
			: "NULL";
	const lineStart =
		record.line_start != null && Number.isFinite(record.line_start)
			? String(Math.floor(record.line_start))
			: "NULL";
	const lineEnd =
		record.line_end != null && Number.isFinite(record.line_end)
			? String(Math.floor(record.line_end))
			: "NULL";
	const jsdocValue = escapeSqlValue(record.jsdoc_text ?? null);

	ctx.statements.push(
		`INSERT INTO raw_code_entities (run_id, symbol_id, file_path, stable_key, kind, name, signature, start_offset, end_offset, line_start, line_end, content_hash, docblock_hash, hash, metadata, last_seen_run, created_at, updated_at)
VALUES (${ctx.runValue}, ${symbolValue}, ${fileValue}, ${stableKey}, ${kindValue}, ${nameValue}, ${signatureValue}, ${startOffset}, ${endOffset}, ${lineStart}, ${lineEnd}, ${escapeSqlValue(record.content_hash ?? null)}, ${escapeSqlValue(record.docblock_hash ?? null)}, ${escapeSqlValue(
			hash,
		)}, ${escapeSqlValue(metadata)}, ${ctx.runValue}, ${ctx.nowValue}, ${ctx.nowValue})
ON CONFLICT(run_id, symbol_id) DO UPDATE SET file_path=excluded.file_path, stable_key=excluded.stable_key, kind=excluded.kind, name=excluded.name, signature=excluded.signature, start_offset=excluded.start_offset, end_offset=excluded.end_offset, line_start=excluded.line_start, line_end=excluded.line_end, content_hash=excluded.content_hash, docblock_hash=excluded.docblock_hash, hash=excluded.hash, metadata=excluded.metadata, last_seen_run=${ctx.runValue}, updated_at=${ctx.nowValue}`,
	);

	incrementCounter(ctx.counts, "raw_code_entities");
}

function handleRawDocEntity(record: RawDocEntityRecord, ctx: HandlerContext): void {
	if (!record.doc_id) {
		throw new Error("raw_doc_entity requires doc_id");
	}
	const metadata = serializeMetadata(record.metadata);
	const payload = {
		doc_id: record.doc_id,
		document_path: record.document_path,
		heading: record.heading ?? null,
		anchor: record.anchor ?? null,
		content_hash: record.content_hash ?? null,
	};
	const hash = computeHash(payload, ctx.hashAlgorithm);

	ctx.statements.push(
		`INSERT INTO raw_doc_entities (run_id, doc_id, document_path, heading, anchor, block_start_line, block_end_line, content_hash, hash, metadata, last_seen_run, created_at, updated_at)
VALUES (${ctx.runValue}, ${escapeSqlValue(record.doc_id)}, ${escapeSqlValue(record.document_path)}, ${escapeSqlValue(
			record.heading ?? null,
		)}, ${escapeSqlValue(record.anchor ?? null)}, ${
			record.block_start_line != null && Number.isFinite(record.block_start_line)
				? String(Math.floor(record.block_start_line))
				: "NULL"
		}, ${
			record.block_end_line != null && Number.isFinite(record.block_end_line)
				? String(Math.floor(record.block_end_line))
				: "NULL"
		}, ${escapeSqlValue(record.content_hash ?? null)}, ${escapeSqlValue(hash)}, ${escapeSqlValue(
			metadata,
		)}, ${ctx.runValue}, ${ctx.nowValue}, ${ctx.nowValue})
ON CONFLICT(run_id, doc_id) DO UPDATE SET document_path=excluded.document_path, heading=excluded.heading, anchor=excluded.anchor, block_start_line=excluded.block_start_line, block_end_line=excluded.block_end_line, content_hash=excluded.content_hash, hash=excluded.hash, metadata=excluded.metadata, last_seen_run=${ctx.runValue}, updated_at=${ctx.nowValue}`,
	);

	incrementCounter(ctx.counts, "raw_doc_entities");
}

function handleRawDocBlock(record: RawDocBlockRecord, ctx: HandlerContext): void {
	if (!record.block_id) {
		throw new Error("raw_doc_block requires block_id");
	}
	const metadata = serializeMetadata(record.metadata);
	const payload = {
		block_id: record.block_id,
		doc_id: record.doc_id,
		document_path: record.document_path,
		block_index: record.block_index ?? null,
		content_hash: record.content_hash ?? null,
	};
	const hash = computeHash(payload, ctx.hashAlgorithm);

	const blockIndex =
		record.block_index != null && Number.isFinite(record.block_index)
			? String(Math.floor(record.block_index))
			: "NULL";

	ctx.statements.push(
		`INSERT INTO raw_doc_blocks (run_id, block_id, doc_id, document_path, block_index, heading, content, content_hash, hash, metadata, created_at, updated_at)
VALUES (${ctx.runValue}, ${escapeSqlValue(record.block_id)}, ${escapeSqlValue(record.doc_id)}, ${escapeSqlValue(
			record.document_path,
		)}, ${blockIndex}, ${escapeSqlValue(record.heading ?? null)}, ${escapeSqlValue(
			record.content ?? null,
		)}, ${escapeSqlValue(record.content_hash ?? null)}, ${escapeSqlValue(hash)}, ${escapeSqlValue(
			metadata,
		)}, ${ctx.nowValue}, ${ctx.nowValue})
ON CONFLICT(run_id, block_id) DO UPDATE SET doc_id=excluded.doc_id, document_path=excluded.document_path, block_index=excluded.block_index, heading=excluded.heading, content=excluded.content, content_hash=excluded.content_hash, hash=excluded.hash, metadata=excluded.metadata, updated_at=${ctx.nowValue}`,
	);

	incrementCounter(ctx.counts, "raw_doc_blocks");
}

function handleRawRelationship(record: RawRelationshipRecord, ctx: HandlerContext): void {
	if (!record.relationship_id) {
		throw new Error("raw_relationship requires relationship_id");
	}
	const metadata = serializeMetadata(record.metadata);
	const payload = {
		relationship_id: record.relationship_id,
		kind: record.kind ?? "related-to",
		source_symbol_id: record.source_symbol_id ?? null,
		target_symbol_id: record.target_symbol_id ?? null,
	};
	const hash = computeHash(payload, ctx.hashAlgorithm);

	ctx.statements.push(
		`INSERT INTO raw_relationships (run_id, relationship_id, kind, source_symbol_id, target_symbol_id, source_path, target_path, metadata, hash, last_seen_run, created_at, updated_at)
VALUES (${ctx.runValue}, ${escapeSqlValue(record.relationship_id)}, ${escapeSqlValue(
			record.kind ?? "related-to",
		)}, ${escapeSqlValue(record.source_symbol_id ?? null)}, ${escapeSqlValue(
			record.target_symbol_id ?? null,
		)}, ${escapeSqlValue(record.source_path ?? null)}, ${escapeSqlValue(
			record.target_path ?? null,
		)}, ${escapeSqlValue(metadata)}, ${escapeSqlValue(hash)}, ${ctx.runValue}, ${ctx.nowValue}, ${ctx.nowValue})
ON CONFLICT(run_id, relationship_id) DO UPDATE SET kind=excluded.kind, source_symbol_id=excluded.source_symbol_id, target_symbol_id=excluded.target_symbol_id, source_path=excluded.source_path, target_path=excluded.target_path, metadata=excluded.metadata, hash=excluded.hash, last_seen_run=${ctx.runValue}, updated_at=${ctx.nowValue}`,
	);

	incrementCounter(ctx.counts, "raw_relationships");
}

function handleResultEntity(record: ResultEntityRecord, ctx: HandlerContext): void {
	const metadata = serializeMetadata(record.metadata);
	const payload = {
		entity_id: record.entity_id,
		entity_type: record.entity_type,
		name: record.name,
		stable_key: record.stable_key ?? null,
		path: record.path ?? null,
	};
	const hash = computeHash(payload, ctx.hashAlgorithm);

	ctx.statements.push(
		`INSERT INTO result_entities (run_id, entity_id, entity_type, name, stable_key, coverage_status, confidence, path, metadata, hash, created_at, updated_at)
VALUES (${ctx.runValue}, ${escapeSqlValue(record.entity_id)}, ${escapeSqlValue(
			record.entity_type,
		)}, ${escapeSqlValue(record.name)}, ${escapeSqlValue(record.stable_key ?? null)}, ${escapeSqlValue(
			record.coverage_status ?? null,
		)}, ${
			record.confidence != null && Number.isFinite(record.confidence)
				? String(record.confidence)
				: "NULL"
		}, ${escapeSqlValue(record.path ?? null)}, ${escapeSqlValue(metadata)}, ${escapeSqlValue(
			hash,
		)}, ${ctx.nowValue}, ${ctx.nowValue})
ON CONFLICT(run_id, entity_id) DO UPDATE SET entity_type=excluded.entity_type, name=excluded.name, stable_key=excluded.stable_key, coverage_status=excluded.coverage_status, confidence=excluded.confidence, path=excluded.path, metadata=excluded.metadata, hash=excluded.hash, updated_at=${ctx.nowValue}`,
	);

	incrementCounter(ctx.counts, "result_entities");
}

function handleResultRelationship(record: ResultRelationshipRecord, ctx: HandlerContext): void {
	const metadata = serializeMetadata(record.metadata);
	const payload = {
		relationship_id: record.relationship_id,
		kind: record.kind,
		source_id: record.source_id,
		target_id: record.target_id,
	};
	const hash = computeHash(payload, ctx.hashAlgorithm);

	ctx.statements.push(
		`INSERT INTO result_relationships (run_id, relationship_id, kind, source_id, target_id, metadata, hash, created_at, updated_at)
VALUES (${ctx.runValue}, ${escapeSqlValue(record.relationship_id)}, ${escapeSqlValue(
			record.kind,
		)}, ${escapeSqlValue(record.source_id)}, ${escapeSqlValue(record.target_id)}, ${escapeSqlValue(
			metadata,
		)}, ${escapeSqlValue(hash)}, ${ctx.nowValue}, ${ctx.nowValue})
ON CONFLICT(run_id, relationship_id) DO UPDATE SET kind=excluded.kind, source_id=excluded.source_id, target_id=excluded.target_id, metadata=excluded.metadata, hash=excluded.hash, updated_at=${ctx.nowValue}`,
	);

	incrementCounter(ctx.counts, "result_relationships");
}

function handleDocMatch(record: DocMatchRecord, ctx: HandlerContext): void {
	if (!record.doc_key || !record.code_key) {
		throw new Error("doc_match requires doc_key and code_key");
	}
	const metadata = serializeMetadata(record.metadata);
	const payload = {
		doc_key: record.doc_key,
		code_key: record.code_key,
		match_kind: record.match_kind ?? "linked",
		confidence: record.confidence ?? null,
	};
	const hash = computeHash(payload, ctx.hashAlgorithm);

	ctx.statements.push(
		`INSERT INTO doc_matches (run_id, doc_key, code_key, match_kind, confidence, metadata, hash, created_at, updated_at)
VALUES (${ctx.runValue}, ${escapeSqlValue(record.doc_key)}, ${escapeSqlValue(
			record.code_key,
		)}, ${escapeSqlValue(record.match_kind ?? "linked")}, ${
			record.confidence != null && Number.isFinite(record.confidence)
				? String(record.confidence)
				: "NULL"
		}, ${escapeSqlValue(metadata)}, ${escapeSqlValue(hash)}, ${ctx.nowValue}, ${ctx.nowValue})
ON CONFLICT(run_id, doc_key, code_key) DO UPDATE SET match_kind=excluded.match_kind, confidence=excluded.confidence, metadata=excluded.metadata, hash=excluded.hash, updated_at=${ctx.nowValue}`,
	);

	incrementCounter(ctx.counts, "doc_matches");
}

function handleLegacyRecord(
	record: IngestRecord & { type: LegacyRecordType },
	ctx: HandlerContext,
): void {
	const runValue = ctx.runValue;
	const nowIso = ctx.nowIso;
	const metadata = serializeMetadata(record.metadata);

	switch (record.type) {
		case "entity": {
			const entityId =
				typeof record.id === "string" && record.id.length > 0 ? String(record.id) : randomUUID();
			ctx.statements.push(
				`INSERT INTO entities (run_id, entity_id, type, name, fqn, path, metadata) VALUES (${runValue}, ${escapeSqlValue(
					entityId,
				)}, ${escapeSqlValue(record.entityType ?? "unknown")}, ${escapeSqlValue(
					record.name ?? entityId,
				)}, ${escapeSqlValue(record.fqn ?? null)}, ${escapeSqlValue(
					record.path ?? null,
				)}, ${escapeSqlValue(metadata)})`,
			);
			ctx.statements.push(
				`INSERT INTO result_entities (run_id, entity_id, entity_type, name, stable_key, coverage_status, confidence, path, metadata, hash, created_at, updated_at) VALUES (${runValue}, ${escapeSqlValue(
					entityId,
				)}, ${escapeSqlValue(record.entityType ?? "unknown")}, ${escapeSqlValue(
					record.name ?? entityId,
				)}, ${escapeSqlValue(record.fqn ?? entityId)}, NULL, NULL, ${escapeSqlValue(
					record.path ?? null,
				)}, ${escapeSqlValue(metadata)}, ${escapeSqlValue(
					computeHash(
						{
							entity_id: entityId,
							entity_type: record.entityType ?? "unknown",
							name: record.name ?? entityId,
						},
						ctx.hashAlgorithm,
					),
				)}, ${escapeSqlValue(nowIso)}, ${escapeSqlValue(nowIso)})`,
			);
			incrementCounter(ctx.counts, "entities");
			break;
		}
		case "relationship": {
			const relId =
				typeof record.id === "string" && record.id.length > 0 ? String(record.id) : randomUUID();
			ctx.statements.push(
				`INSERT INTO relationships (run_id, relationship_id, type, source_id, target_id, metadata) VALUES (${runValue}, ${escapeSqlValue(
					relId,
				)}, ${escapeSqlValue(record.relType ?? "related-to")}, ${escapeSqlValue(
					record.sourceId ?? "unknown",
				)}, ${escapeSqlValue(record.targetId ?? "unknown")}, ${escapeSqlValue(metadata)})`,
			);
			ctx.statements.push(
				`INSERT INTO result_relationships (run_id, relationship_id, kind, source_id, target_id, metadata, hash, created_at, updated_at) VALUES (${runValue}, ${escapeSqlValue(
					relId,
				)}, ${escapeSqlValue(record.relType ?? "related-to")}, ${escapeSqlValue(
					record.sourceId ?? "unknown",
				)}, ${escapeSqlValue(record.targetId ?? "unknown")}, ${escapeSqlValue(metadata)}, ${escapeSqlValue(
					computeHash(
						{
							relationship_id: relId,
							kind: record.relType ?? "related-to",
							source_id: record.sourceId ?? "unknown",
							target_id: record.targetId ?? "unknown",
						},
						ctx.hashAlgorithm,
					),
				)}, ${escapeSqlValue(nowIso)}, ${escapeSqlValue(nowIso)})`,
			);
			incrementCounter(ctx.counts, "relationships");
			break;
		}
		case "layer": {
			const layerId =
				typeof record.id === "string" && record.id.length > 0 ? String(record.id) : randomUUID();
			ctx.statements.push(
				`INSERT INTO layers (run_id, layer_id, name, description, metadata) VALUES (${runValue}, ${escapeSqlValue(
					layerId,
				)}, ${escapeSqlValue(record.name ?? layerId)}, ${escapeSqlValue(
					record.description ?? null,
				)}, ${escapeSqlValue(metadata)})`,
			);
			incrementCounter(ctx.counts, "layers");
		 break;
		}
		case "slice": {
			const sliceId =
				typeof record.id === "string" && record.id.length > 0 ? String(record.id) : randomUUID();
			ctx.statements.push(
				`INSERT INTO slices (run_id, slice_id, name, description, metadata) VALUES (${runValue}, ${escapeSqlValue(
					sliceId,
				)}, ${escapeSqlValue(record.name ?? sliceId)}, ${escapeSqlValue(
					record.description ?? null,
				)}, ${escapeSqlValue(metadata)})`,
			);
			incrementCounter(ctx.counts, "slices");
			break;
		}
		case "evidence": {
			ctx.statements.push(
				`INSERT INTO evidence (run_id, entity_id, relationship_id, payload, created_at) VALUES (${runValue}, ${escapeSqlValue(
					(record as Record<string, unknown>).entityId ?? null,
				)}, ${escapeSqlValue(
					(record as Record<string, unknown>).relationshipId ?? null,
				)}, ${escapeSqlValue(
					serializeMetadata(record.payload) ?? JSON.stringify(record),
				)}, ${escapeSqlValue(nowIso)})`,
			);
			incrementCounter(ctx.counts, "evidence");
			break;
		}
	}
}

function prepareCleanupStatements(runValue: string): string[] {
	return [
		`DELETE FROM entities WHERE run_id=${runValue}`,
		`DELETE FROM relationships WHERE run_id=${runValue}`,
		`DELETE FROM layers WHERE run_id=${runValue}`,
		`DELETE FROM slices WHERE run_id=${runValue}`,
		`DELETE FROM evidence WHERE run_id=${runValue}`,
		`DELETE FROM raw_code_entities WHERE run_id=${runValue}`,
		`DELETE FROM raw_doc_entities WHERE run_id=${runValue}`,
		`DELETE FROM raw_doc_blocks WHERE run_id=${runValue}`,
		`DELETE FROM raw_relationships WHERE run_id=${runValue}`,
		`DELETE FROM result_entities WHERE run_id=${runValue}`,
		`DELETE FROM result_relationships WHERE run_id=${runValue}`,
		`DELETE FROM doc_matches WHERE run_id=${runValue}`,
	];
}

function cleanupStaleFilesStatements(runValue: string, cleanupBatchSize: number): string[] {
	if (cleanupBatchSize <= 0) {
		return [];
	}
	return [
		`DELETE FROM files WHERE rowid IN (
	SELECT rowid FROM files
	WHERE last_seen_run IS NOT NULL
	  AND last_seen_run <> ${runValue}
	ORDER BY updated_at ASC
	LIMIT ${cleanupBatchSize}
)`,
	];
}

export function writeToDb(options: WriteToDbOptions): WriteToDbResult {
	const dbPath = path.resolve(options.dbPath);
	const ingestPath = path.resolve(options.ingestPath);
	const source = options.source ?? path.basename(ingestPath);
	const lines = readJsonLines(ingestPath);
	const nowIso = new Date().toISOString();
	const nowValue = escapeSqlValue(nowIso);
	const runValue = escapeSqlValue(options.taskId);
	const sourceValue = escapeSqlValue(source);

	const runtimeConfig = loadRuntimeConfig(dbPath);
	runSql(dbPath, ["PRAGMA busy_timeout=5000"]);
	const hashAlgorithm = resolveHashAlgorithm(runtimeConfig);
	const cleanupBatchSize = resolveCleanupBatchSize(runtimeConfig);

	ensureIngestLog(dbPath, runValue, sourceValue, nowValue);

	const statements: string[] = [
		"BEGIN",
		...prepareCleanupStatements(runValue),
	];
	const counts: Record<string, number> = {};
	const ctx: HandlerContext = {
		nowIso,
		nowValue,
		runValue,
		taskId: options.taskId,
		hashAlgorithm,
		counts,
		statements,
	};

	for (const rawRecord of lines) {
		if (!rawRecord || typeof rawRecord !== "object") {
			throw new Error("ingest record must be an object");
		}
		const record = rawRecord as IngestRecord;
		if (typeof record.type !== "string") {
			throw new Error("ingest record missing type field");
		}

		switch (record.type) {
			case "file":
				handleFileRecord(record as FileRecord, ctx);
				break;
			case "raw_code_entity":
				handleRawCodeEntity(record as RawCodeEntityRecord, ctx);
				break;
			case "raw_doc_entity":
				handleRawDocEntity(record as RawDocEntityRecord, ctx);
				break;
			case "raw_doc_block":
				handleRawDocBlock(record as RawDocBlockRecord, ctx);
				break;
			case "raw_relationship":
				handleRawRelationship(record as RawRelationshipRecord, ctx);
				break;
			case "result_entity":
				handleResultEntity(record as ResultEntityRecord, ctx);
				break;
			case "result_relationship":
				handleResultRelationship(record as ResultRelationshipRecord, ctx);
				break;
			case "doc_match":
				handleDocMatch(record as DocMatchRecord, ctx);
				break;
			default:
				if (LEGACY_TYPES.includes(record.type as LegacyRecordType)) {
					handleLegacyRecord(record as IngestRecord & { type: LegacyRecordType }, ctx);
				} else {
					throw new Error(`Unsupported ingest record type: ${record.type}`);
				}
		}
	}

	statements.push(
		...cleanupStaleFilesStatements(runValue, cleanupBatchSize),
		"COMMIT",
	);

	try {
		runSql(dbPath, statements);
		updateIngestLogStatus(dbPath, runValue, sourceValue, "completed", {
			total_records: lines.length,
			hash_algorithm: hashAlgorithm,
			counts,
		});
	} catch (error) {
		updateIngestLogStatus(dbPath, runValue, sourceValue, "failed", {
			error: (error as Error).message ?? String(error),
		});
		throw error;
	}

	return {
		taskId: options.taskId,
		source,
		totalRecords: lines.length,
		counts,
	};
}

async function runCli(commandName = "write-to-db"): Promise<void> {
	const argv = await yargs(hideBin(process.argv))
		.scriptName(commandName)
		.option("db_path", {
			type: "string",
			demandOption: true,
			describe: "Путь к SQLite базе данных",
		})
		.option("task_id", {
			type: "string",
			demandOption: true,
			describe: "Идентификатор задачи (run_id)",
		})
		.option("ingest_path", {
			type: "string",
			demandOption: true,
			describe: "Путь до JSONL файла с сырыми данными",
		})
		.option("source", {
			type: "string",
			describe: "Имя источника для ingest_log (по умолчанию — имя файла)",
		})
		.option("log_file", {
			type: "string",
			describe: "Путь для записи stdout/stderr (append)",
		})
		.help()
		.parseAsync();

	const restoreLog = setupLogWriter(argv.log_file);
	try {
		const result = writeToDb({
			dbPath: argv.db_path,
			taskId: argv.task_id,
			ingestPath: argv.ingest_path,
			source: argv.source,
		});

		console.log(
			JSON.stringify(
				{
					message: "Ingest applied",
					taskId: result.taskId,
					source: result.source,
					totalRecords: result.totalRecords,
					counts: result.counts,
				},
				null,
				2,
			),
		);
	} catch (error) {
		console.error("write-to-db failed:", error);
		process.exitCode = 1;
	} finally {
		restoreLog();
	}
}

if (isMainModule(import.meta.url)) {
	void runCli();
}

export { runCli as runWriteToDbCli };
