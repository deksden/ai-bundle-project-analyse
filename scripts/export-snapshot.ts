import fs from "node:fs";
import path from "node:path";

import { ensureDirSync } from "fs-extra";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { setupLogWriter } from "./utils/logging.js";
import { isMainModule } from "./utils/module.js";
import { escapeSqlValue, queryJson } from "./utils/sqlite.js";

interface ExportSnapshotOptions {
	dbPath: string;
	taskId: string;
	outputsDir: string;
}

interface ExportSnapshotResult {
	taskId: string;
	exportsDir: string;
	filesWritten: string[];
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

interface CoverageRow {
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

function parseMetadata(value: string | null | undefined): unknown {
	if (!value) return null;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return null;
	}
}

function resolveExportsDir(outputsDir: string): string {
	const resolved = path.resolve(outputsDir);
	if (resolved.endsWith(path.sep + "exports") || resolved.endsWith(`${path.sep}exports${path.sep}`)) {
		return resolved;
	}
	return path.join(resolved, "exports");
}

export function exportSnapshot(options: ExportSnapshotOptions): ExportSnapshotResult {
	const dbPath = path.resolve(options.dbPath);
	const taskIdEscaped = escapeSqlValue(options.taskId);
	const exportsDir = resolveExportsDir(options.outputsDir);

	ensureDirSync(exportsDir);

	const entities = queryJson<EntityRow>(
		dbPath,
		`SELECT entity_id, name, type, fqn, path, metadata FROM entities WHERE run_id=${taskIdEscaped} ORDER BY name`,
	);
	const relationships = queryJson<RelationshipRow>(
		dbPath,
		`SELECT relationship_id, type, source_id, target_id, metadata FROM relationships WHERE run_id=${taskIdEscaped} ORDER BY type, relationship_id`,
	);
	const coverageRows = queryJson<CoverageRow>(
		dbPath,
		`SELECT * FROM coverage_summary WHERE run_id=${taskIdEscaped}`,
	);
	const metricsRows = queryJson<MetricRow>(
		dbPath,
		`SELECT key, value, created_at FROM run_metrics WHERE run_id=${taskIdEscaped}`,
	);

	const normalizedEntities = entities.map((row) => ({
		id: row.entity_id,
		name: row.name,
		type: row.type,
		fqn: row.fqn ?? null,
		path: row.path ?? null,
		metadata: parseMetadata(row.metadata),
	}));

	const normalizedRelationships = relationships.map((row) => ({
		id: row.relationship_id,
		type: row.type,
		sourceId: row.source_id,
		targetId: row.target_id,
		metadata: parseMetadata(row.metadata),
	}));

	const coverage =
		coverageRows[0] ??
		({
			run_id: options.taskId,
			files_total: 0,
			files_with_entities: 0,
			files_with_remarks: 0,
			remarks_total: 0,
			remark_applications_total: 0,
			entities_total: normalizedEntities.length,
			relationships_total: normalizedRelationships.length,
			evidence_total: 0,
			layers_total: 0,
			slices_total: 0,
			updated_at: new Date().toISOString(),
		} satisfies CoverageRow);

	const metrics: Record<string, unknown> = {};
	for (const row of metricsRows) {
		try {
			metrics[row.key] = JSON.parse(row.value);
		} catch {
			metrics[row.key] = row.value;
		}
	}

	const filesWritten: string[] = [];

	const writeJson = (fileName: string, data: unknown) => {
		const target = path.join(exportsDir, fileName);
		fs.writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`, "utf8");
		filesWritten.push(target);
	};

	writeJson("entities.json", {
		taskId: options.taskId,
		entities: normalizedEntities,
	});

	writeJson("relationships.json", {
		taskId: options.taskId,
		relationships: normalizedRelationships,
	});

	writeJson("coverage.json", {
		taskId: options.taskId,
		coverage: {
			total: {
				files: coverage.files_total,
				entities: coverage.entities_total,
				relationships: coverage.relationships_total,
				remarks: coverage.remarks_total,
				remarkApplications: coverage.remark_applications_total,
				evidence: coverage.evidence_total,
				layers: coverage.layers_total,
				slices: coverage.slices_total,
			},
			filesWithEntities: coverage.files_with_entities,
			filesWithRemarks: coverage.files_with_remarks,
			updatedAt: coverage.updated_at,
		},
	});

	writeJson("metrics.json", {
		taskId: options.taskId,
		metrics,
	});

	const externalSystems = Array.isArray(metrics.external_systems)
		? (metrics.external_systems as unknown[])
		: [];
	const serviceEndpoints = Array.isArray(metrics.service_endpoints)
		? (metrics.service_endpoints as unknown[])
		: [];
	const messageQueues = Array.isArray(metrics.message_queues)
		? (metrics.message_queues as unknown[])
		: [];

	writeJson("external-systems.json", {
		taskId: options.taskId,
		externalSystems,
	});
	writeJson("endpoints.json", {
		taskId: options.taskId,
		endpoints: serviceEndpoints,
	});
	writeJson("queues.json", {
		taskId: options.taskId,
		queues: messageQueues,
	});

	return {
		taskId: options.taskId,
		exportsDir,
		filesWritten,
	};
}

async function runCli(): Promise<void> {
	const argv = await yargs(hideBin(process.argv))
		.scriptName("export-snapshot")
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
		.option("outputs_dir", {
			type: "string",
			demandOption: true,
			describe: "Корневая папка для экспортов (analysis или analysis/exports)",
		})
		.option("log_file", {
			type: "string",
			describe: "Путь для записи stdout/stderr (append)",
		})
		.help()
		.parseAsync();

const restoreLog = setupLogWriter(argv.log_file);
	try {
		const result = exportSnapshot({
			dbPath: argv.db_path,
			taskId: argv.task_id,
			outputsDir: argv.outputs_dir,
		});

		console.log(
			JSON.stringify(
				{
					message: "Snapshot exported",
					taskId: result.taskId,
					exportsDir: result.exportsDir,
					files: result.filesWritten.map((filePath) => path.basename(filePath)),
				},
				null,
				2,
			),
		);
	} catch (error) {
		console.error("export-snapshot failed:", error);
		process.exitCode = 1;
	} finally {
		restoreLog();
	}
}

if (isMainModule(import.meta.url)) {
	void runCli();
}
