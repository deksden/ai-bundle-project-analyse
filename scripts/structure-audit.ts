import path from "node:path";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { setupLogWriter } from "./utils/logging.js";
import { isMainModule } from "./utils/module.js";
import { queryJson } from "./utils/sqlite.js";

interface CoverageSummaryRow {
	run_id: string;
	files_total: number;
	files_with_entities: number;
	files_with_remarks: number;
	remarks_total: number;
	remark_applications_total: number;
	entities_total: number;
	relationships_total: number;
	evidence_total: number;
	layers_total: number;
	slices_total: number;
	updated_at: string;
}

interface MetricRow {
	key: string;
	value: string;
	created_at: string;
}

interface EntityRow {
	entity_id: string;
	name: string;
	type: string;
	path: string | null;
	metadata?: string | null;
}

interface RelationshipRow {
	relationship_id: string;
	type: string;
	source_id: string;
	target_id: string;
	metadata?: string | null;
}

interface RemarkRow {
	path: string;
	scope: string;
	recursive: number;
	text: string;
}

interface RemarkFileRow {
	file_path: string;
	total: number;
}

interface EvidenceRow {
	id: number;
	entity_id: string | null;
	relationship_id: string | null;
	payload: string;
}

interface FileIndexRow {
	kind: string;
	total: number;
}

interface Expectations {
	coverage: {
		filesTotal: number;
		filesWithEntities: number;
		filesWithRemarks: number;
		remarksTotal: number;
		remarkApplications: number;
		entitiesTotal: number;
		relationshipsTotal: number;
		layersTotal: number;
		slicesTotal: number;
		evidenceTotal: number;
	};
	coveragePercentages: {
		files_with_entities: number;
		files_with_remarks: number;
		entities_with_relationships: number;
	};
	entityTypeCounts: Record<string, number>;
	relationshipTypeCounts: Record<string, number>;
	serviceEndpoints: number;
	messageQueues: number;
	externalSystems: number;
	fileIndex: {
		total: number;
		doc: number;
		code: number;
		config: number;
	};
	entities: Array<{
		id: string;
		name: string;
		type: string;
		path: string | null;
		layer?: string | null;
		inbound: number;
		outbound: number;
		remarkFiles: number;
		evidence: number;
	}>;
	relationships: Array<{
		id: string;
		type: string;
		source: string;
		target: string;
		expectations: Record<string, string | number | null>;
		evidence: number;
	}>;
	layers: string[];
	slices: string[];
	evidence: Array<{
		entityId?: string;
		relationshipId?: string;
		source: string;
	}>;
	remarks: {
		total: number;
		applies: number;
		definitions: Array<{ path: string; scope: string; recursive: boolean; textIncludes: string }>;
		topFiles: Array<{ file: string; total: number }>;
	};
}

interface NormalizedEntity {
	id: string;
	name: string;
	type: string;
	path: string | null;
	layer: string | null;
	inbound: number;
	outbound: number;
	remarkFiles: number;
	evidence: number;
}

interface NormalizedRelationship {
	id: string;
	type: string;
	source: string;
	target: string;
	metadata: Record<string, unknown>;
	evidence: number;
}

interface NormalizedEvidence {
	entityId?: string;
	relationshipId?: string;
	source?: string;
	payload: Record<string, unknown>;
}

interface AuditData {
	taskId: string;
	coverage: CoverageSummaryRow | null;
	coveragePercentages: Record<string, number>;
	entityTypeCounts: Record<string, number>;
	relationshipTypeCounts: Record<string, number>;
	serviceEndpoints: unknown[];
	messageQueues: unknown[];
	externalSystems: unknown[];
	entities: NormalizedEntity[];
	relationships: NormalizedRelationship[];
	layers: string[];
	slices: string[];
	evidence: NormalizedEvidence[];
	remarks: {
		total: number;
		applies: number;
		definitions: RemarkRow[];
		topFiles: RemarkFileRow[];
		uniqueFiles: string[];
	};
	fileIndex: {
		total: number;
		doc: number;
		code: number;
		config: number;
	};
}

interface Mismatch {
	key: string;
	expected: unknown;
	actual: unknown;
	details?: string;
}

interface AuditResult {
	data: AuditData;
	mismatches: Mismatch[];
	expectations: Expectations;
}

const EXPECTED: Expectations = {
	coverage: {
		filesTotal: 10,
		filesWithEntities: 2,
		filesWithRemarks: 3,
		remarksTotal: 3,
		remarkApplications: 4,
		entitiesTotal: 3,
		relationshipsTotal: 2,
		layersTotal: 1,
		slicesTotal: 1,
		evidenceTotal: 2,
	},
	coveragePercentages: {
		files_with_entities: 0.2,
		files_with_remarks: 0.3,
		entities_with_relationships: 1,
	},
	entityTypeCounts: {
		service: 2,
		database: 1,
	},
	relationshipTypeCounts: {
		"uses-database": 1,
		"publishes-events": 1,
	},
	serviceEndpoints: 1,
	messageQueues: 1,
	externalSystems: 0,
	fileIndex: {
		total: 10,
		doc: 3,
		code: 4,
		config: 3,
	},
	entities: [
		{
			id: "entity-api",
			name: "API Gateway",
			type: "service",
			path: "apps/api/src/index.ts",
			layer: "core",
			inbound: 1,
			outbound: 1,
			remarkFiles: 1,
			evidence: 1,
		},
		{
			id: "entity-worker",
			name: "Events Worker",
			type: "service",
			path: "apps/worker/src/index.ts",
			layer: "core",
			inbound: 0,
			outbound: 1,
			remarkFiles: 0,
			evidence: 0,
		},
		{
			id: "entity-db",
			name: "Research Analytics DB",
			type: "database",
			path: null,
			layer: null,
			inbound: 1,
			outbound: 0,
			remarkFiles: 0,
			evidence: 0,
		},
	],
	relationships: [
		{
			id: "rel-api-db",
			type: "uses-database",
			source: "entity-api",
			target: "entity-db",
			expectations: {
				endpoint: "postgresql://research-structure",
				owner: "data-platform",
			},
			evidence: 0,
		},
		{
			id: "rel-worker-api",
			type: "publishes-events",
			source: "entity-worker",
			target: "entity-api",
			expectations: {
				queue: "events.high",
				channel: "internal",
			},
			evidence: 1,
		},
	],
	layers: ["layer-core"],
	slices: ["slice-ingest"],
	evidence: [
		{
			entityId: "entity-api",
			source: "docs/ADR-001-current.md",
		},
		{
			relationshipId: "rel-worker-api",
			source: "configs/queue.yaml",
		},
	],
	remarks: {
		total: 3,
		applies: 4,
		definitions: [
			{
				path: "docs/ADR-999-legacy.md",
				scope: "file",
				recursive: false,
				textIncludes: "Legacy document",
			},
			{
				path: "apps/reporting",
				scope: "dir",
				recursive: true,
				textIncludes: "reporting aggregator",
			},
			{
				path: "apps/**/*.ts",
				scope: "glob",
				recursive: false,
				textIncludes: "Проверьте владельцев",
			},
		],
		topFiles: [
			{ file: "apps/reporting/src/aggregator.ts", total: 2 },
			{ file: "apps/api/src/index.ts", total: 1 },
			{ file: "docs/ADR-999-legacy.md", total: 1 },
		],
	},
};

function parseJson(value: string | null | undefined): Record<string, unknown> {
	if (!value) return {};
	try {
		const parsed = JSON.parse(value) as Record<string, unknown>;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

function parsePayload(value: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(value) as Record<string, unknown>;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

function collectAuditData(dbPath: string, taskId: string): AuditData {
	const escapedTaskId = `'${taskId.replace(/'/g, "''")}'`;

	const coverage = queryJson<CoverageSummaryRow>(
		dbPath,
		`SELECT * FROM coverage_summary WHERE run_id=${escapedTaskId}`,
	)[0] ?? null;

	const metricRows = queryJson<MetricRow>(
		dbPath,
		`SELECT key, value, created_at FROM run_metrics WHERE run_id=${escapedTaskId}`,
	);

	const metrics = new Map<string, unknown>();
	for (const row of metricRows) {
		try {
			metrics.set(row.key, JSON.parse(row.value));
		} catch {
			metrics.set(row.key, row.value);
		}
	}

	const entityRows = queryJson<EntityRow>(
		dbPath,
		`SELECT entity_id, name, type, path, metadata FROM entities WHERE run_id=${escapedTaskId} ORDER BY entity_id`,
	);
	const relationshipRows = queryJson<RelationshipRow>(
		dbPath,
		`SELECT relationship_id, type, source_id, target_id, metadata FROM relationships WHERE run_id=${escapedTaskId} ORDER BY relationship_id`,
	);
	const layerRows = queryJson<{ layer_id: string }>(
		dbPath,
		`SELECT layer_id FROM layers WHERE run_id=${escapedTaskId} ORDER BY layer_id`,
	);
	const sliceRows = queryJson<{ slice_id: string }>(
		dbPath,
		`SELECT slice_id FROM slices WHERE run_id=${escapedTaskId} ORDER BY slice_id`,
	);
	const evidenceRows = queryJson<EvidenceRow>(
		dbPath,
		`SELECT id, entity_id, relationship_id, payload FROM evidence WHERE run_id=${escapedTaskId} ORDER BY id`,
	);
	const remarkRows = queryJson<RemarkRow>(
		dbPath,
		`SELECT path, scope, recursive, text FROM remarks WHERE run_id=${escapedTaskId} ORDER BY id`,
	);
	const remarkApplies = queryJson<{ file_path: string }>(
		dbPath,
		`SELECT file_path FROM remark_applies WHERE run_id=${escapedTaskId}`,
	);
	const remarkFileRows = queryJson<RemarkFileRow>(
		dbPath,
		`SELECT file_path, COUNT(*) AS total FROM remark_applies WHERE run_id=${escapedTaskId} GROUP BY file_path ORDER BY total DESC, file_path LIMIT 10`,
	);
	const fileIndexRows = queryJson<FileIndexRow>(
		dbPath,
		`SELECT kind, COUNT(*) AS total FROM file_index WHERE run_id=${escapedTaskId} GROUP BY kind`,
	);
	const fileIndexTotal = fileIndexRows.reduce((acc, row) => acc + Number(row.total ?? 0), 0);

	const remarkCountsByFile = new Map<string, number>();
	for (const item of remarkFileRows) {
		remarkCountsByFile.set(item.file_path, Number(item.total ?? 0));
	}

	const evidenceByEntity = new Map<string, number>();
	const evidenceByRelationship = new Map<string, number>();
	const normalizedEvidence: NormalizedEvidence[] = [];
	for (const evidence of evidenceRows) {
		const payload = parsePayload(evidence.payload);
		if (evidence.entity_id) {
			evidenceByEntity.set(evidence.entity_id, (evidenceByEntity.get(evidence.entity_id) ?? 0) + 1);
		}
		if (evidence.relationship_id) {
			evidenceByRelationship.set(
				evidence.relationship_id,
				(evidenceByRelationship.get(evidence.relationship_id) ?? 0) + 1,
			);
		}
		normalizedEvidence.push({
			entityId: evidence.entity_id ?? undefined,
			relationshipId: evidence.relationship_id ?? undefined,
			source: typeof payload.source === "string" ? payload.source : undefined,
			payload,
		});
	}

	const inboundCounts = new Map<string, number>();
	const outboundCounts = new Map<string, number>();
	for (const relationship of relationshipRows) {
		outboundCounts.set(
			relationship.source_id,
			(outboundCounts.get(relationship.source_id) ?? 0) + 1,
		);
		inboundCounts.set(
			relationship.target_id,
			(inboundCounts.get(relationship.target_id) ?? 0) + 1,
		);
	}

	const normalizedEntities: NormalizedEntity[] = entityRows.map((entity) => {
		const metadata = parseJson(entity.metadata ?? null);
		const remarkFiles =
			entity.path && remarkCountsByFile.has(entity.path)
				? 1
				: 0;

		return {
			id: entity.entity_id,
			name: entity.name,
			type: entity.type,
			path: entity.path,
			layer: typeof metadata.layer === "string" ? metadata.layer : null,
			inbound: inboundCounts.get(entity.entity_id) ?? 0,
			outbound: outboundCounts.get(entity.entity_id) ?? 0,
			remarkFiles,
			evidence: evidenceByEntity.get(entity.entity_id) ?? 0,
		};
	});

	const normalizedRelationships: NormalizedRelationship[] = relationshipRows.map((relationship) => ({
		id: relationship.relationship_id,
		type: relationship.type,
		source: relationship.source_id,
		target: relationship.target_id,
		metadata: parseJson(relationship.metadata ?? null),
		evidence: evidenceByRelationship.get(relationship.relationship_id) ?? 0,
	}));

	const uniqueRemarkFiles = Array.from(new Set(remarkApplies.map((row) => row.file_path))).sort();

	return {
		taskId,
		coverage,
		coveragePercentages: (metrics.get("coverage_percentages") as Record<string, number> | undefined) ?? {},
		entityTypeCounts: (metrics.get("entity_type_counts") as Record<string, number> | undefined) ?? {},
		relationshipTypeCounts:
			(metrics.get("relationship_type_counts") as Record<string, number> | undefined) ?? {},
		serviceEndpoints: (metrics.get("service_endpoints") as unknown[]) ?? [],
		messageQueues: (metrics.get("message_queues") as unknown[]) ?? [],
		externalSystems: (metrics.get("external_systems") as unknown[]) ?? [],
		entities: normalizedEntities,
		relationships: normalizedRelationships,
		layers: layerRows.map((row) => row.layer_id),
		slices: sliceRows.map((row) => row.slice_id),
		evidence: normalizedEvidence,
		remarks: {
			total: remarkRows.length,
			applies: remarkApplies.length,
			definitions: remarkRows,
			topFiles: remarkFileRows,
			uniqueFiles: uniqueRemarkFiles,
		},
		fileIndex: {
			total: fileIndexTotal,
			doc: fileIndexRows.find((row) => row.kind === "doc")?.total ?? 0,
			code: fileIndexRows.find((row) => row.kind === "code")?.total ?? 0,
			config: fileIndexRows.find((row) => row.kind === "config")?.total ?? 0,
		},
	};
}

function evaluateExpectations(data: AuditData, expectations: Expectations): Mismatch[] {
	const mismatches: Mismatch[] = [];

	const isPlainObject = (value: unknown): value is Record<string, unknown> =>
		Boolean(value) && typeof value === "object" && !Array.isArray(value);

	const deepEqual = (a: unknown, b: unknown): boolean => {
		if (Array.isArray(a) && Array.isArray(b)) {
			if (a.length !== b.length) return false;
			for (let index = 0; index < a.length; index += 1) {
				if (!deepEqual(a[index], b[index])) return false;
			}
			return true;
		}

		if (isPlainObject(a) && isPlainObject(b)) {
			const keysA = Object.keys(a).sort();
			const keysB = Object.keys(b).sort();
			if (keysA.length !== keysB.length) return false;
			for (let index = 0; index < keysA.length; index += 1) {
				if (keysA[index] !== keysB[index]) return false;
				const key = keysA[index]!;
				if (!deepEqual(a[key], b[key])) return false;
			}
			return true;
		}

		return a === b;
	};

	function expectEqual<T>(key: string, expected: T, actual: T): void {
		if (!deepEqual(expected, actual)) {
			mismatches.push({ key, expected, actual });
		}
	}

	function expectNumberWithTolerance(
		key: string,
		expected: number,
		actual: number | undefined,
		tolerance = 1e-6,
	): void {
		if (typeof actual !== "number" || Math.abs(actual - expected) > tolerance) {
			mismatches.push({ key, expected, actual });
		}
	}

	function expectArrayEquality(key: string, expected: string[], actual: string[]): void {
		const expectedSet = new Set(expected);
		const actualSet = new Set(actual);
		const missing = expected.filter((item) => !actualSet.has(item));
		const extra = actual.filter((item) => !expectedSet.has(item));
		if (missing.length > 0 || extra.length > 0) {
			mismatches.push({
				key,
				expected,
				actual,
				details: `missing=${missing.join(", ") || "∅"}, extra=${extra.join(", ") || "∅"}`,
			});
		}
	}

	// Coverage totals
	const coverage = data.coverage;
	if (!coverage) {
		mismatches.push({ key: "coverage_summary", expected: "row present", actual: "missing" });
	} else {
		expectEqual("coverage.files_total", expectations.coverage.filesTotal, coverage.files_total);
		expectEqual(
			"coverage.files_with_entities",
			expectations.coverage.filesWithEntities,
			coverage.files_with_entities,
		);
		expectEqual(
			"coverage.files_with_remarks",
			expectations.coverage.filesWithRemarks,
			coverage.files_with_remarks,
		);
		expectEqual("coverage.remarks_total", expectations.coverage.remarksTotal, coverage.remarks_total);
		expectEqual(
			"coverage.remark_applications_total",
			expectations.coverage.remarkApplications,
			coverage.remark_applications_total,
		);
		expectEqual("coverage.entities_total", expectations.coverage.entitiesTotal, coverage.entities_total);
		expectEqual(
			"coverage.relationships_total",
			expectations.coverage.relationshipsTotal,
			coverage.relationships_total,
		);
		expectEqual(
			"coverage.layers_total",
			expectations.coverage.layersTotal,
			coverage.layers_total,
		);
		expectEqual(
			"coverage.slices_total",
			expectations.coverage.slicesTotal,
			coverage.slices_total,
		);
		expectEqual(
			"coverage.evidence_total",
			expectations.coverage.evidenceTotal,
			coverage.evidence_total,
		);
	}

	expectNumberWithTolerance(
		"coverage_percentages.files_with_entities",
		expectations.coveragePercentages.files_with_entities,
		data.coveragePercentages.files_with_entities,
	);
	expectNumberWithTolerance(
		"coverage_percentages.files_with_remarks",
		expectations.coveragePercentages.files_with_remarks,
		data.coveragePercentages.files_with_remarks,
	);
	expectNumberWithTolerance(
		"coverage_percentages.entities_with_relationships",
		expectations.coveragePercentages.entities_with_relationships,
		data.coveragePercentages.entities_with_relationships,
	);

	expectEqual("entity_type_counts", expectations.entityTypeCounts, data.entityTypeCounts);
	expectEqual(
		"relationship_type_counts",
		expectations.relationshipTypeCounts,
		data.relationshipTypeCounts,
	);

	expectEqual(
		"service_endpoints.total",
		expectations.serviceEndpoints,
		data.serviceEndpoints.length,
	);
	expectEqual("message_queues.total", expectations.messageQueues, data.messageQueues.length);
	expectEqual("external_systems.total", expectations.externalSystems, data.externalSystems.length);

	expectEqual("file_index.total", expectations.fileIndex.total, data.fileIndex.total);
	expectEqual("file_index.doc", expectations.fileIndex.doc, data.fileIndex.doc);
	expectEqual("file_index.code", expectations.fileIndex.code, data.fileIndex.code);
	expectEqual("file_index.config", expectations.fileIndex.config, data.fileIndex.config);

	// Entities
	const actualEntityMap = new Map(data.entities.map((entity) => [entity.id, entity]));
	expectEqual("entities.total", expectations.entities.length, data.entities.length);
	for (const expectedEntity of expectations.entities) {
		const actual = actualEntityMap.get(expectedEntity.id);
		if (!actual) {
			mismatches.push({
				key: `entities.${expectedEntity.id}`,
				expected: expectedEntity,
				actual: null,
			});
			continue;
		}
		expectEqual(
			`entities.${expectedEntity.id}.name`,
			expectedEntity.name,
			actual.name,
		);
		expectEqual(
			`entities.${expectedEntity.id}.type`,
			expectedEntity.type,
			actual.type,
		);
		expectEqual(
			`entities.${expectedEntity.id}.path`,
			expectedEntity.path,
			actual.path,
		);
		expectEqual(
			`entities.${expectedEntity.id}.layer`,
			expectedEntity.layer ?? null,
			actual.layer,
		);
		expectEqual(
			`entities.${expectedEntity.id}.inbound`,
			expectedEntity.inbound,
			actual.inbound,
		);
		expectEqual(
			`entities.${expectedEntity.id}.outbound`,
			expectedEntity.outbound,
			actual.outbound,
		);
		expectEqual(
			`entities.${expectedEntity.id}.remarkFiles`,
			expectedEntity.remarkFiles,
			actual.remarkFiles,
		);
		expectEqual(
			`entities.${expectedEntity.id}.evidence`,
			expectedEntity.evidence,
			actual.evidence,
		);
	}

	// Relationships
	const actualRelationshipMap = new Map(data.relationships.map((rel) => [rel.id, rel]));
	expectEqual(
		"relationships.total",
		expectations.relationships.length,
		data.relationships.length,
	);
	for (const expectedRel of expectations.relationships) {
		const actual = actualRelationshipMap.get(expectedRel.id);
		if (!actual) {
			mismatches.push({
				key: `relationships.${expectedRel.id}`,
				expected: expectedRel,
				actual: null,
			});
			continue;
		}
		expectEqual(
			`relationships.${expectedRel.id}.type`,
			expectedRel.type,
			actual.type,
		);
		expectEqual(
			`relationships.${expectedRel.id}.source`,
			expectedRel.source,
			actual.source,
		);
		expectEqual(
			`relationships.${expectedRel.id}.target`,
			expectedRel.target,
			actual.target,
		);
		expectEqual(
			`relationships.${expectedRel.id}.evidence`,
			expectedRel.evidence,
			actual.evidence,
		);
		for (const [metaKey, metaValue] of Object.entries(expectedRel.expectations)) {
			const actualValue = actual.metadata?.[metaKey];
			if (actualValue !== metaValue) {
				mismatches.push({
					key: `relationships.${expectedRel.id}.metadata.${metaKey}`,
					expected: metaValue,
					actual: actualValue,
				});
			}
		}
	}

	// Layers / slices
	expectArrayEquality("layers", expectations.layers, data.layers);
	expectArrayEquality("slices", expectations.slices, data.slices);

	// Evidence
	const expectedEvidence = expectations.evidence;
	const evidenceItems = data.evidence.map((item) => ({
		entityId: item.entityId ?? undefined,
		relationshipId: item.relationshipId ?? undefined,
		source: typeof item.source === "string" ? item.source : undefined,
	}));
	expectEqual("evidence.total", expectedEvidence.length, evidenceItems.length);
	for (const expected of expectedEvidence) {
		const found = evidenceItems.find((actual) => {
			if (expected.entityId && actual.entityId !== expected.entityId) return false;
			if (expected.relationshipId && actual.relationshipId !== expected.relationshipId) return false;
			return actual.source === expected.source;
		});
		if (!found) {
			mismatches.push({
				key: `evidence.${expected.entityId ?? expected.relationshipId}`,
				expected,
				actual: "missing",
			});
		}
	}

	// Remarks
	expectEqual("remarks.total", expectations.remarks.total, data.remarks.total);
	expectEqual("remarks.applies", expectations.remarks.applies, data.remarks.applies);
	expectEqual(
		"remarks.unique_files",
		expectations.remarks.topFiles.length,
		data.remarks.uniqueFiles.length,
	);
	for (const def of expectations.remarks.definitions) {
		const match = data.remarks.definitions.find(
			(actual) =>
				actual.path === def.path &&
				actual.scope === def.scope &&
				Boolean(actual.recursive) === def.recursive &&
				actual.text.includes(def.textIncludes),
		);
		if (!match) {
			mismatches.push({
				key: `remarks.definition.${def.path}`,
				expected: def,
				actual: "missing",
			});
		}
	}
	for (const top of expectations.remarks.topFiles) {
		const actual = data.remarks.topFiles.find((item) => item.file_path === top.file);
		if (!actual) {
			mismatches.push({
				key: `remarks.top_files.${top.file}`,
				expected: top.total,
				actual: "missing",
			});
		} else if (Number(actual.total) !== top.total) {
			mismatches.push({
				key: `remarks.top_files.${top.file}`,
				expected: top.total,
				actual: Number(actual.total),
			});
		}
	}

	return mismatches;
}

function formatNumber(value: number): string {
	return Number.isFinite(value) ? value.toString() : "NaN";
}

function renderTextReport(result: AuditResult): string {
	const { data, mismatches, expectations } = result;
	const lines: string[] = [];

	lines.push(`Research Structure Audit (task: ${data.taskId})`);
	lines.push("=======================================");
	lines.push("");

	lines.push("Coverage Summary:");
	if (!data.coverage) {
		lines.push("  ✖ coverage_summary row отсутствует");
	} else {
		lines.push(
			`  Files: ${data.coverage.files_total} (expected ${expectations.coverage.filesTotal})`,
		);
		lines.push(
			`  Entities: ${data.coverage.entities_total} (expected ${expectations.coverage.entitiesTotal})`,
		);
		lines.push(
			`  Relationships: ${data.coverage.relationships_total} (expected ${expectations.coverage.relationshipsTotal})`,
		);
		lines.push(
			`  Layers/Slices: ${data.coverage.layers_total}/${data.coverage.slices_total} (expected ${expectations.coverage.layersTotal}/${expectations.coverage.slicesTotal})`,
		);
		lines.push(
			`  Remarks: ${data.coverage.remarks_total} (${data.coverage.remark_applications_total} applications, expected ${expectations.coverage.remarksTotal}/${expectations.coverage.remarkApplications})`,
		);
		lines.push(
			`  Files with entities/remarks: ${data.coverage.files_with_entities}/${data.coverage.files_with_remarks} (expected ${expectations.coverage.filesWithEntities}/${expectations.coverage.filesWithRemarks})`,
		);
	}
	lines.push("");

	lines.push("Entity Summary:");
	for (const entity of data.entities) {
		lines.push(
			`  - ${entity.id}: ${entity.name} [${entity.type}] path=${entity.path ?? "n/a"} layer=${entity.layer ?? "n/a"} inbound=${entity.inbound} outbound=${entity.outbound} remarks=${entity.remarkFiles} evidence=${entity.evidence}`,
		);
	}
	lines.push("");

	lines.push("Relationship Summary:");
	for (const rel of data.relationships) {
		lines.push(
			`  - ${rel.id}: ${rel.type} (${rel.source} -> ${rel.target}) evidence=${rel.evidence}`,
		);
		const metadataEntries = Object.entries(rel.metadata ?? {});
		for (const [key, value] of metadataEntries) {
			lines.push(`      ${key}: ${JSON.stringify(value)}`);
		}
	}
	lines.push("");

	lines.push("Layers: " + (data.layers.length ? data.layers.join(", ") : "∅"));
	lines.push("Slices: " + (data.slices.length ? data.slices.join(", ") : "∅"));
	lines.push("");

	lines.push("Evidence:");
	for (const item of data.evidence) {
		lines.push(
			`  - entity=${item.entityId ?? "n/a"}, relationship=${item.relationshipId ?? "n/a"}, source=${item.source ?? "n/a"}`,
		);
	}
	lines.push("");

	lines.push("Remarks:");
	lines.push(`  Total: ${data.remarks.total}, applications: ${data.remarks.applies}`);
	lines.push("  Definitions:");
	for (const remark of data.remarks.definitions) {
		lines.push(
			`    - ${remark.path} [scope=${remark.scope}${remark.recursive ? ", recursive" : ""}] text="${remark.text}"`,
		);
	}
	lines.push("  Top files:");
	for (const item of data.remarks.topFiles) {
		lines.push(`    - ${item.file_path}: ${item.total}`);
	}
	lines.push("");

	lines.push("File Index:");
	lines.push(
		`  Total=${data.fileIndex.total} (doc=${data.fileIndex.doc}, code=${data.fileIndex.code}, config=${data.fileIndex.config})`,
	);
	lines.push("");

	lines.push("Coverage percentages:");
	lines.push(
		`  files_with_entities=${formatNumber(data.coveragePercentages.files_with_entities ?? NaN)} (expected ${expectations.coveragePercentages.files_with_entities})`,
	);
	lines.push(
		`  files_with_remarks=${formatNumber(data.coveragePercentages.files_with_remarks ?? NaN)} (expected ${expectations.coveragePercentages.files_with_remarks})`,
	);
	lines.push(
		`  entities_with_relationships=${formatNumber(
			data.coveragePercentages.entities_with_relationships ?? NaN,
		)} (expected ${expectations.coveragePercentages.entities_with_relationships})`,
	);
	lines.push("");

	if (mismatches.length === 0) {
		lines.push("✅ Все ожидания выполнены");
	} else {
		lines.push(`⚠️ Найдено несоответствий: ${mismatches.length}`);
		for (const mismatch of mismatches) {
			lines.push(
				`  - ${mismatch.key}: expected=${JSON.stringify(mismatch.expected)}, actual=${JSON.stringify(
					mismatch.actual,
				)}${mismatch.details ? ` (${mismatch.details})` : ""}`,
			);
		}
	}

	return lines.join("\n");
}

function runAudit(options: {
	dbPath: string;
	taskId: string;
	format: "text" | "json";
	strict: boolean;
	logFile?: string;
}): void {
	const resolvedDbPath = path.resolve(options.dbPath);
	const data = collectAuditData(resolvedDbPath, options.taskId);
	const mismatches = evaluateExpectations(data, EXPECTED);

	const result: AuditResult = {
		data,
		mismatches,
		expectations: EXPECTED,
	};

	if (options.format === "json") {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.log(renderTextReport(result));
	}

	if (options.strict && mismatches.length > 0) {
		process.exitCode = 1;
	}
}

async function main(): Promise<void> {
	const argv = await yargs(hideBin(process.argv))
		.scriptName("structure-audit")
		.option("db_path", {
			type: "string",
			demandOption: true,
			describe: "Путь к SQLite базе данных (global/shared/.../analysis.db)",
		})
		.option("task_id", {
			type: "string",
			demandOption: true,
			describe: "Идентификатор задачи (TASK_ID)",
		})
		.option("format", {
			type: "string",
			choices: ["text", "json"] as const,
			default: "text",
			describe: "Формат вывода",
		})
		.option("strict", {
			type: "boolean",
			default: true,
			describe: "Возвращать ненулевой код завершения при обнаружении несоответствий",
		})
		.option("log_file", {
			type: "string",
			describe: "Путь для записи stdout/stderr (append)",
		})
		.help()
		.parseAsync();

	const restoreLog = setupLogWriter(argv.log_file);
	try {
		runAudit({
			dbPath: argv.db_path,
			taskId: argv.task_id,
			format: (argv.format ?? "text") as "text" | "json",
			strict: argv.strict !== false,
			logFile: argv.log_file,
		});
	} catch (error) {
		console.error("structure-audit failed:", error);
		process.exitCode = 1;
	} finally {
		restoreLog();
	}
}

if (isMainModule(import.meta.url)) {
	void main();
}
