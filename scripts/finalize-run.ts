import fs from "node:fs";
import path from "node:path";

import { ensureDirSync } from "fs-extra";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { setupLogWriter } from "./utils/logging.js";
import { isMainModule } from "./utils/module.js";
import { escapeSqlValue, queryJson, runSql } from "./utils/sqlite.js";

interface FinalizeRunOptions {
	dbPath: string;
	taskId: string;
	outputsDir: string;
}

interface FinalizeRunResult {
	taskId: string;
	summaryPath: string;
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
}

interface RunRow {
	metadata?: string | null;
	git_sha?: string | null;
}

function resolveGlobalSnapshotPath(outputsDir: string): string {
	const resolved = path.resolve(outputsDir);
	const globalDir = resolved.endsWith(path.sep + "global")
		? resolved
		: path.join(resolved, "global");
	const structureDir = path.join(globalDir, "structure");
	ensureDirSync(structureDir);
	return path.join(structureDir, "snapshot.json");
}

export function finalizeRun(options: FinalizeRunOptions): FinalizeRunResult {
	const dbPath = path.resolve(options.dbPath);
	const taskIdEscaped = escapeSqlValue(options.taskId);

	const coverage =
		queryJson<CoverageRow>(
			dbPath,
			`SELECT * FROM coverage_summary WHERE run_id=${taskIdEscaped}`,
		)[0] ??
		({
			run_id: options.taskId,
			files_total: 0,
			files_with_entities: 0,
			files_with_remarks: 0,
			remarks_total: 0,
			remark_applications_total: 0,
			entities_total: 0,
			relationships_total: 0,
			evidence_total: 0,
			layers_total: 0,
			slices_total: 0,
			updated_at: new Date().toISOString(),
		} satisfies CoverageRow);

	const metricsRows = queryJson<MetricRow>(
		dbPath,
		`SELECT key, value FROM run_metrics WHERE run_id=${taskIdEscaped}`,
	);

	const entityCountRow = queryJson<{ count: number }>(
		dbPath,
		`SELECT COUNT(*) as count FROM entities WHERE run_id=${taskIdEscaped}`,
	)[0];
	const relationshipCountRow = queryJson<{ count: number }>(
		dbPath,
		`SELECT COUNT(*) as count FROM relationships WHERE run_id=${taskIdEscaped}`,
	)[0];
	const fileIndexCountRow = queryJson<{ count: number }>(
		dbPath,
		`SELECT COUNT(*) as count FROM file_index WHERE run_id=${taskIdEscaped}`,
	)[0];

	const validation = {
		entities: {
			expected: coverage.entities_total,
			actual: entityCountRow?.count ?? 0,
		},
		relationships: {
			expected: coverage.relationships_total,
			actual: relationshipCountRow?.count ?? 0,
		},
		filesIndexed: {
			expected: coverage.files_total,
			actual: fileIndexCountRow?.count ?? 0,
		},
	};
	const mismatches: string[] = [];
	for (const [key, value] of Object.entries(validation)) {
		if (value.actual !== value.expected) {
			mismatches.push(`${key}: expected ${value.expected}, actual ${value.actual}`);
		}
	}
	if (mismatches.length > 0) {
		throw new Error(`Database validation failed: ${mismatches.join("; ")}`);
	}

	const metrics: Record<string, unknown> = {};
	for (const row of metricsRows) {
		try {
			metrics[row.key] = JSON.parse(row.value);
		} catch {
			metrics[row.key] = row.value;
		}
	}

	const runRow =
		queryJson<RunRow>(dbPath, `SELECT metadata, git_sha FROM runs WHERE id=${taskIdEscaped}`)[0] ??
		({} satisfies RunRow);

	let runMetadata: Record<string, unknown> =
		runRow.metadata && runRow.metadata.length
			? (() => {
					try {
						const parsed = JSON.parse(runRow.metadata as string) as Record<string, unknown>;
						return parsed && typeof parsed === "object" ? parsed : {};
					} catch {
						return {};
					}
				})()
			: {};

	const externalSystems = Array.isArray(metrics.external_systems)
		? (metrics.external_systems as unknown[])
		: [];
	const serviceEndpoints = Array.isArray(metrics.service_endpoints)
		? (metrics.service_endpoints as unknown[])
		: [];
	const messageQueues = Array.isArray(metrics.message_queues)
		? (metrics.message_queues as unknown[])
		: [];

	const summary = {
		taskId: options.taskId,
		generatedAt: new Date().toISOString(),
		gitSha: runRow.git_sha ?? null,
		coverage: {
			files: {
				total: coverage.files_total,
				withEntities: coverage.files_with_entities,
				withRemarks: coverage.files_with_remarks,
			},
			remarks: {
				total: coverage.remarks_total,
				applications: coverage.remark_applications_total,
			},
			entities: {
				total: coverage.entities_total,
				layers: coverage.layers_total,
				slices: coverage.slices_total,
			},
			relationships: {
				total: coverage.relationships_total,
				evidence: coverage.evidence_total,
			},
		},
		metrics: {
			entityTypes: metrics.entity_type_counts ?? {},
			relationshipTypes: metrics.relationship_type_counts ?? {},
			coveragePercentages: metrics.coverage_percentages ?? {},
		},
		externalSystems,
		serviceEndpoints,
		messageQueues,
		validation,
	};

	runMetadata = {
		...runMetadata,
		structure_summary: summary,
	};

	runSql(dbPath, [
		"BEGIN",
		`UPDATE runs SET metadata=${escapeSqlValue(JSON.stringify(runMetadata))} WHERE id=${taskIdEscaped}`,
		"COMMIT",
	]);

	const summaryPath = resolveGlobalSnapshotPath(options.outputsDir);
	fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

	return {
		taskId: options.taskId,
		summaryPath,
	};
}

async function runCli(): Promise<void> {
	const argv = await yargs(hideBin(process.argv))
		.scriptName("finalize-run")
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
			describe: "Корневая папка для глобальных артефактов (analysis или analysis/global)",
		})
		.option("log_file", {
			type: "string",
			describe: "Путь для записи stdout/stderr (append)",
		})
		.help()
		.parseAsync();

const restoreLog = setupLogWriter(argv.log_file);
	try {
		const result = finalizeRun({
			dbPath: argv.db_path,
			taskId: argv.task_id,
			outputsDir: argv.outputs_dir,
		});

		console.log(
			JSON.stringify(
				{
					message: "Run finalized",
					taskId: result.taskId,
					summaryPath: result.summaryPath,
				},
				null,
				2,
			),
		);
	} catch (error) {
		console.error("finalize-run failed:", error);
		process.exitCode = 1;
	} finally {
		restoreLog();
	}
}

if (isMainModule(import.meta.url)) {
	void runCli();
}
