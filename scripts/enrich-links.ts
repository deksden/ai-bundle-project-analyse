import path from "node:path";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { setupLogWriter } from "./utils/logging.js";
import { isMainModule } from "./utils/module.js";
import { escapeSqlValue, queryJson, runSql } from "./utils/sqlite.js";

interface EnrichLinksOptions {
	dbPath: string;
	taskId: string;
}

interface EnrichLinksResult {
	taskId: string;
	entitiesTotal: number;
	relationshipsTotal: number;
	filesTotal: number;
	docMatchesTotal: number;
	resultEntitiesTotal: number;
	resultRelationshipsTotal: number;
	coverage: {
		filesWithEntities: number;
		filesWithRemarks: number;
		remarksTotal: number;
		remarkApplicationsTotal: number;
		evidenceTotal: number;
		layersTotal: number;
		slicesTotal: number;
	};
	externalSystems: number;
	endpoints: number;
	queues: number;
}

interface EntityRow {
	entity_id: string;
	name: string;
	type: string;
	fqn?: string | null;
	path?: string | null;
	metadata?: string | null;
}

interface RelationshipRow {
	relationship_id: string;
	type: string;
	source_id: string;
	target_id: string;
	metadata?: string | null;
}

interface RemarkCountRow {
	file_path: string;
	count: number;
}

interface EvidenceCountRow {
	entity_id?: string | null;
	relationship_id?: string | null;
	total: number;
}

interface MetricRow {
	key: string;
	value: unknown;
}

type MetadataObject = Record<string, unknown>;

function parseMetadata(input: string | null | undefined): MetadataObject {
	if (!input) return {};
	try {
		const parsed = JSON.parse(input) as MetadataObject;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

function stringifyMetadata(metadata: MetadataObject): string {
	return JSON.stringify(metadata);
}

function queryCount(dbPath: string, sql: string): number {
	const rows = queryJson<{ count: number }>(dbPath, sql);
	return rows[0]?.count ?? 0;
}

export function enrichLinks(options: EnrichLinksOptions): EnrichLinksResult {
	const dbPath = path.resolve(options.dbPath);
	const taskIdEscaped = escapeSqlValue(options.taskId);

	const entities = queryJson<EntityRow>(
		dbPath,
		`SELECT entity_id, name, type, fqn, path, metadata FROM entities WHERE run_id=${taskIdEscaped}`,
	);
	const relationships = queryJson<RelationshipRow>(
		dbPath,
		`SELECT relationship_id, type, source_id, target_id, metadata FROM relationships WHERE run_id=${taskIdEscaped}`,
	);

	const remarkCounts = queryJson<RemarkCountRow>(
		dbPath,
		`SELECT file_path, COUNT(*) AS count FROM remark_applies WHERE run_id=${taskIdEscaped} GROUP BY file_path`,
	);

	const evidenceByEntity = queryJson<EvidenceCountRow>(
		dbPath,
		`SELECT entity_id, COUNT(*) AS total FROM evidence WHERE run_id=${taskIdEscaped} AND entity_id IS NOT NULL GROUP BY entity_id`,
	);
	const evidenceByRelationship = queryJson<EvidenceCountRow>(
		dbPath,
		`SELECT relationship_id, COUNT(*) AS total FROM evidence WHERE run_id=${taskIdEscaped} AND relationship_id IS NOT NULL GROUP BY relationship_id`,
	);

	const entityTypeCounts = queryJson<{ type: string; total: number }>(
		dbPath,
		`SELECT type, COUNT(*) AS total FROM entities WHERE run_id=${taskIdEscaped} GROUP BY type ORDER BY type`,
	);
	const relationshipTypeCounts = queryJson<{ type: string; total: number }>(
		dbPath,
		`SELECT type, COUNT(*) AS total FROM relationships WHERE run_id=${taskIdEscaped} GROUP BY type ORDER BY type`,
	);

	const filesTotal = queryCount(
		dbPath,
		`SELECT COUNT(*) AS count FROM file_index WHERE run_id=${taskIdEscaped}`,
	);
	const filesWithEntities = queryCount(
		dbPath,
		`SELECT COUNT(*) AS count FROM (
			SELECT DISTINCT path FROM entities
			WHERE run_id=${taskIdEscaped} AND path IS NOT NULL AND path <> ''
		)`,
	);
	const filesWithRemarks = queryCount(
		dbPath,
		`SELECT COUNT(DISTINCT file_path) AS count FROM remark_applies WHERE run_id=${taskIdEscaped}`,
	);
	const remarksTotal = queryCount(
		dbPath,
		`SELECT COUNT(*) AS count FROM remarks WHERE run_id=${taskIdEscaped}`,
	);
	const remarkApplicationsTotal = queryCount(
		dbPath,
		`SELECT COUNT(*) AS count FROM remark_applies WHERE run_id=${taskIdEscaped}`,
	);
	const evidenceTotal = queryCount(
		dbPath,
		`SELECT COUNT(*) AS count FROM evidence WHERE run_id=${taskIdEscaped}`,
	);
	const layersTotal = queryCount(
		dbPath,
		`SELECT COUNT(*) AS count FROM layers WHERE run_id=${taskIdEscaped}`,
	);
	const slicesTotal = queryCount(
		dbPath,
		`SELECT COUNT(*) AS count FROM slices WHERE run_id=${taskIdEscaped}`,
	);
	const docMatchesTotal = queryCount(
		dbPath,
		`SELECT COUNT(*) AS count FROM doc_matches WHERE run_id=${taskIdEscaped}`,
	);
	const resultEntitiesTotal = queryCount(
		dbPath,
		`SELECT COUNT(*) AS count FROM result_entities WHERE run_id=${taskIdEscaped}`,
	);
	const resultRelationshipsTotal = queryCount(
		dbPath,
		`SELECT COUNT(*) AS count FROM result_relationships WHERE run_id=${taskIdEscaped}`,
	);

	const remarkCountByPath = new Map<string, number>();
	for (const row of remarkCounts) {
		remarkCountByPath.set(row.file_path, row.count);
	}

	const evidenceCountByEntity = new Map<string, number>();
	for (const row of evidenceByEntity) {
		if (row.entity_id) {
			evidenceCountByEntity.set(row.entity_id, row.total);
		}
	}

	const evidenceCountByRelationship = new Map<string, number>();
	for (const row of evidenceByRelationship) {
		if (row.relationship_id) {
			evidenceCountByRelationship.set(row.relationship_id, row.total);
		}
	}

	const inboundCounts = new Map<string, number>();
	const outboundCounts = new Map<string, number>();
	const entityMap = new Map<string, EntityRow>();

	for (const entity of entities) {
		entityMap.set(entity.entity_id, entity);
		inboundCounts.set(entity.entity_id, 0);
		outboundCounts.set(entity.entity_id, 0);
	}

	const externalSystems: Array<Record<string, unknown>> = [];
	const endpoints: Array<Record<string, unknown>> = [];
	const queues: Array<Record<string, unknown>> = [];

	for (const relationship of relationships) {
		outboundCounts.set(
			relationship.source_id,
			(outboundCounts.get(relationship.source_id) ?? 0) + 1,
		);
		inboundCounts.set(
			relationship.target_id,
			(inboundCounts.get(relationship.target_id) ?? 0) + 1,
		);

		const sourceEntity = entityMap.get(relationship.source_id);
		const targetEntity = entityMap.get(relationship.target_id);
		const metadata = parseMetadata(relationship.metadata);

		const isExternal =
			(typeof metadata.category === "string" &&
				metadata.category.toLowerCase() === "external_system") ||
			relationship.type.toLowerCase().includes("external");

		if (isExternal) {
			externalSystems.push({
				relationshipId: relationship.relationship_id,
				source: sourceEntity?.name ?? relationship.source_id,
				target: targetEntity?.name ?? relationship.target_id,
				type: relationship.type,
				metadata,
			});
		}

		if (metadata.queue) {
			queues.push({
				relationshipId: relationship.relationship_id,
				name: metadata.queue,
				source: sourceEntity?.name ?? relationship.source_id,
				target: targetEntity?.name ?? relationship.target_id,
			});
		}

		if (metadata.endpoint) {
			endpoints.push({
				relationshipId: relationship.relationship_id,
				endpoint: metadata.endpoint,
				source: sourceEntity?.name ?? relationship.source_id,
				target: targetEntity?.name ?? relationship.target_id,
				type: relationship.type,
			});
		}
	}

	const entityUpdateStatements: string[] = [];
	const entitiesWithRelationships = new Set<string>();

	for (const entity of entities) {
		const metadata = parseMetadata(entity.metadata);
		const inbound = inboundCounts.get(entity.entity_id) ?? 0;
		const outbound = outboundCounts.get(entity.entity_id) ?? 0;
		const remarkCount = entity.path ? remarkCountByPath.get(entity.path) ?? 0 : 0;
		const evidenceCount = evidenceCountByEntity.get(entity.entity_id) ?? 0;

		if (inbound + outbound > 0) {
			entitiesWithRelationships.add(entity.entity_id);
		}

		if (Array.isArray(metadata.endpoints)) {
			for (const entry of metadata.endpoints) {
				if (typeof entry === "string") {
					endpoints.push({
						entityId: entity.entity_id,
						entity: entity.name,
						endpoint: entry,
						source: entity.name,
					});
				}
			}
		} else if (typeof metadata.endpoint === "string") {
			endpoints.push({
				entityId: entity.entity_id,
				entity: entity.name,
				endpoint: metadata.endpoint,
				source: entity.name,
			});
		}

		if (Array.isArray(metadata.queues)) {
			for (const entry of metadata.queues) {
				if (typeof entry === "string") {
					queues.push({
						entityId: entity.entity_id,
						entity: entity.name,
						queue: entry,
					});
				}
			}
		}

		metadata.analysis = {
			taskId: options.taskId,
			inbound,
			outbound,
			remarks: remarkCount,
			hasRemarks: remarkCount > 0,
			evidence: evidenceCount,
		};

		entityUpdateStatements.push(
			`UPDATE entities SET metadata=${escapeSqlValue(
				stringifyMetadata(metadata),
			)} WHERE run_id=${taskIdEscaped} AND entity_id=${escapeSqlValue(entity.entity_id)}`,
		);
	}

	const relationshipUpdateStatements: string[] = [];

	for (const relationship of relationships) {
		const metadata = parseMetadata(relationship.metadata);
		const evidenceCount = evidenceCountByRelationship.get(relationship.relationship_id) ?? 0;
		const sourceEntity = entityMap.get(relationship.source_id);
		const targetEntity = entityMap.get(relationship.target_id);

		metadata.analysis = {
			taskId: options.taskId,
			evidence: evidenceCount,
			source: {
				id: relationship.source_id,
				name: sourceEntity?.name ?? null,
				type: sourceEntity?.type ?? null,
			},
			target: {
				id: relationship.target_id,
				name: targetEntity?.name ?? null,
				type: targetEntity?.type ?? null,
			},
		};

		relationshipUpdateStatements.push(
			`UPDATE relationships SET metadata=${escapeSqlValue(
				stringifyMetadata(metadata),
			)} WHERE run_id=${taskIdEscaped} AND relationship_id=${escapeSqlValue(
				relationship.relationship_id,
			)}`,
		);
	}

	const coverageRow = {
		run_id: options.taskId,
		files_total: filesTotal,
		files_with_entities: filesWithEntities,
		files_with_remarks: filesWithRemarks,
		remarks_total: remarksTotal,
		remark_applications_total: remarkApplicationsTotal,
		entities_total: entities.length,
		relationships_total: relationships.length,
		evidence_total: evidenceTotal,
		layers_total: layersTotal,
		slices_total: slicesTotal,
		doc_matches_total: docMatchesTotal,
		result_entities_total: resultEntitiesTotal,
		result_relationships_total: resultRelationshipsTotal,
		updated_at: new Date().toISOString(),
	};

	const percentageCoverage = {
		files_with_entities:
			filesTotal > 0 ? Number((filesWithEntities / filesTotal).toFixed(4)) : 0,
		files_with_remarks:
			filesTotal > 0 ? Number((filesWithRemarks / filesTotal).toFixed(4)) : 0,
		entities_with_relationships:
			entities.length > 0
				? Number((entitiesWithRelationships.size / entities.length).toFixed(4))
				: 0,
	};

	const metricsRows: MetricRow[] = [
		{
			key: "entity_type_counts",
			value: Object.fromEntries(entityTypeCounts.map((row) => [row.type, row.total])),
		},
		{
			key: "relationship_type_counts",
			value: Object.fromEntries(
				relationshipTypeCounts.map((row) => [row.type, row.total]),
			),
		},
		{
			key: "coverage_percentages",
			value: percentageCoverage,
		},
		{
			key: "external_systems",
			value: externalSystems,
		},
		{
			key: "service_endpoints",
			value: endpoints,
		},
		{
			key: "message_queues",
			value: queues,
		},
		{
			key: "layer_count",
			value: layersTotal,
		},
		{
			key: "slice_count",
			value: slicesTotal,
		},
		{
			key: "doc_matches_total",
			value: docMatchesTotal,
		},
		{
			key: "result_totals",
			value: {
				entities: resultEntitiesTotal,
				relationships: resultRelationshipsTotal,
			},
		},
	];

	const statements = [
		"BEGIN",
		...entityUpdateStatements,
		...relationshipUpdateStatements,
		`DELETE FROM coverage_summary WHERE run_id=${taskIdEscaped}`,
		`INSERT INTO coverage_summary (run_id, files_total, files_with_entities, files_with_remarks, remarks_total, remark_applications_total, entities_total, relationships_total, evidence_total, layers_total, slices_total, doc_matches_total, result_entities_total, result_relationships_total, updated_at)
VALUES (
	${taskIdEscaped},
	${coverageRow.files_total},
	${coverageRow.files_with_entities},
	${coverageRow.files_with_remarks},
	${coverageRow.remarks_total},
	${coverageRow.remark_applications_total},
	${coverageRow.entities_total},
	${coverageRow.relationships_total},
	${coverageRow.evidence_total},
	${coverageRow.layers_total},
	${coverageRow.slices_total},
	${coverageRow.doc_matches_total},
	${coverageRow.result_entities_total},
	${coverageRow.result_relationships_total},
	${escapeSqlValue(coverageRow.updated_at)}
)`,
		`DELETE FROM run_metrics WHERE run_id=${taskIdEscaped}`,
	];

	for (const metric of metricsRows) {
		statements.push(
			`INSERT INTO run_metrics (run_id, key, value, created_at) VALUES (${taskIdEscaped}, ${escapeSqlValue(metric.key)}, ${escapeSqlValue(
				JSON.stringify(metric.value),
			)}, ${escapeSqlValue(coverageRow.updated_at)})`,
		);
	}

	statements.push("COMMIT");

	runSql(dbPath, statements);

	return {
		taskId: options.taskId,
		entitiesTotal: entities.length,
		relationshipsTotal: relationships.length,
		filesTotal,
		docMatchesTotal,
		resultEntitiesTotal,
		resultRelationshipsTotal,
		coverage: {
			filesWithEntities,
			filesWithRemarks,
			remarksTotal,
			remarkApplicationsTotal,
			evidenceTotal,
			layersTotal,
			slicesTotal,
		},
		externalSystems: externalSystems.length,
		endpoints: endpoints.length,
		queues: queues.length,
	};
}

async function runCli(): Promise<void> {
	const argv = await yargs(hideBin(process.argv))
		.scriptName("enrich-links")
		.option("db_path", {
			type: "string",
			demandOption: true,
			describe: "Путь к SQLite базе данных",
		})
		.option("task_id", {
			type: "string",
			demandOption: true,
			describe: "Идентификатор задачи (сохраняется в базе данных)",
		})
		.option("log_file", {
			type: "string",
			describe: "Путь для записи stdout/stderr (append)",
		})
		.help()
		.parseAsync();

	const restoreLog = setupLogWriter(argv.log_file);
	try {
		const result = enrichLinks({
			dbPath: argv.db_path,
			taskId: argv.task_id,
		});

		console.log(
			JSON.stringify(
				{
					message: "Links enriched",
					taskId: result.taskId,
					entities: result.entitiesTotal,
					relationships: result.relationshipsTotal,
					files: result.filesTotal,
					coverage: result.coverage,
					aggregates: {
						externalSystems: result.externalSystems,
						endpoints: result.endpoints,
						queues: result.queues,
						docMatches: result.docMatchesTotal,
						resultEntities: result.resultEntitiesTotal,
						resultRelationships: result.resultRelationshipsTotal,
					},
				},
				null,
				2,
			),
		);
	} catch (error) {
		console.error("enrich-links failed:", error);
		process.exitCode = 1;
	} finally {
		restoreLog();
	}
}

if (isMainModule(import.meta.url)) {
	void runCli();
}
