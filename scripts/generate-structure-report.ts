import fs from "node:fs";
import path from "node:path";

import { ensureDirSync } from "fs-extra";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { setupLogWriter } from "./utils/logging.js";
import { isMainModule } from "./utils/module.js";
import { escapeSqlValue, queryJson } from "./utils/sqlite.js";

interface GenerateReportOptions {
	dbPath: string;
	taskId: string;
	outputsDir: string;
}

interface GenerateReportResult {
	taskId: string;
	reportPath: string;
}

interface CoverageRow {
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

interface RemarkSummaryRow {
	text: string;
	path: string;
	scope: string;
	applies: number;
}

interface RemarkedFileRow {
	file_path: string;
	total: number;
}

function resolveReportsDir(outputsDir: string): string {
	const resolved = path.resolve(outputsDir);
	if (resolved.endsWith(path.sep + "reports") || resolved.endsWith(`${path.sep}reports${path.sep}`)) {
		return resolved;
	}
	return path.join(resolved, "reports");
}

function percent(part: number, total: number): string {
	if (!total) return "0%";
	return `${((part / total) * 100).toFixed(1)}%`;
}

function listSection(title: string, entries: string[]): string {
	if (entries.length === 0) {
		return `### ${title}\n\nНет данных.\n`;
	}
	return `### ${title}\n\n${entries.map((entry) => `- ${entry}`).join("\n")}\n`;
}

export function generateStructureReport(options: GenerateReportOptions): GenerateReportResult {
	const dbPath = path.resolve(options.dbPath);
	const taskIdEscaped = escapeSqlValue(options.taskId);
	const reportsDir = resolveReportsDir(options.outputsDir);
	ensureDirSync(reportsDir);

	const coverageRow =
		queryJson<CoverageRow>(
			dbPath,
		`SELECT files_total, files_with_entities, files_with_remarks, remarks_total, remark_applications_total, entities_total, relationships_total, evidence_total, layers_total, slices_total, updated_at FROM coverage_summary WHERE run_id=${taskIdEscaped}`,
		)[0] ??
		({
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
	const metrics: Record<string, unknown> = {};
	for (const row of metricsRows) {
		try {
			metrics[row.key] = JSON.parse(row.value);
		} catch {
			metrics[row.key] = row.value;
		}
	}

	const remarks = queryJson<RemarkSummaryRow>(
		dbPath,
		`SELECT r.text, r.path, r.scope, COUNT(a.file_path) AS applies
FROM remarks r
LEFT JOIN remark_applies a ON a.remark_id = r.id
WHERE r.run_id=${taskIdEscaped}
GROUP BY r.id
ORDER BY applies DESC, r.created_at DESC
LIMIT 5`,
	);

	const remarkedFiles = queryJson<RemarkedFileRow>(
		dbPath,
		`SELECT file_path, COUNT(*) AS total FROM remark_applies WHERE run_id=${taskIdEscaped} GROUP BY file_path ORDER BY total DESC, file_path LIMIT 5`,
	);

	const coveragePercentages = (metrics.coverage_percentages ??
		JSON.parse(
			JSON.stringify({
				files_with_entities: 0,
				files_with_remarks: 0,
				entities_with_relationships: 0,
			}),
		)) as Record<string, number>;

	const externalSystems = Array.isArray(metrics.external_systems)
		? (metrics.external_systems as Array<Record<string, unknown>>)
		: [];
	const serviceEndpoints = Array.isArray(metrics.service_endpoints)
		? (metrics.service_endpoints as Array<Record<string, unknown>>)
		: [];
	const messageQueues = Array.isArray(metrics.message_queues)
		? (metrics.message_queues as Array<Record<string, unknown>>)
		: [];

	const lines: string[] = [];

	lines.push(`# Structure Report (Task ${options.taskId})`);
	lines.push("");
	lines.push(`_Updated at: ${coverageRow.updated_at}_`);
	lines.push("");

	lines.push("## Overview");
	lines.push("");
	lines.push(
		[
			"| Metric | Count | Notes |",
			"| --- | --- | --- |",
			`| Entities | ${coverageRow.entities_total} | Layered: ${coverageRow.layers_total}, Slices: ${coverageRow.slices_total} |`,
			`| Relationships | ${coverageRow.relationships_total} | Evidence: ${coverageRow.evidence_total} |`,
			`| Indexed files | ${coverageRow.files_total} | Entities in ${coverageRow.files_with_entities} files (${percent(coverageRow.files_with_entities, coverageRow.files_total)}) |`,
			`| Remarks | ${coverageRow.remarks_total} | Applications: ${coverageRow.remark_applications_total} |`,
		].join("\n"),
	);
	lines.push("");

	lines.push("## Coverage");
	lines.push("");
	lines.push(
		[
			"| Signal | Value | Percent |",
			"| --- | --- | --- |",
			`| Files with entities | ${coverageRow.files_with_entities} | ${percent(coverageRow.files_with_entities, coverageRow.files_total)} |`,
			`| Files with remarks | ${coverageRow.files_with_remarks} | ${percent(coverageRow.files_with_remarks, coverageRow.files_total)} |`,
			`| Entities with relationships | ${coveragePercentages.entities_with_relationships ?? 0} | ${((coveragePercentages.entities_with_relationships ?? 0) * 100).toFixed(1)}% |`,
		].join("\n"),
	);
	lines.push("");

	lines.push(
		listSection(
			"External Systems",
			externalSystems.map((system) => {
				const name = typeof system?.target === "string" ? system.target : system?.name;
				const type = typeof system?.type === "string" ? system.type : "external";
				return `${name ?? "Unnamed"} (${type})`;
			}),
		),
	);

	lines.push(
		listSection(
			"Service Endpoints",
			serviceEndpoints.map((endpoint) => {
				const point = typeof endpoint?.endpoint === "string" ? endpoint.endpoint : "n/a";
				const owner = typeof endpoint?.entity === "string" ? endpoint.entity : endpoint?.source;
				return `${point} — ${owner ?? "unknown owner"}`;
			}),
		),
	);

	lines.push(
		listSection(
			"Message Queues",
			messageQueues.map((queue) => {
				const name = typeof queue?.queue === "string" ? queue.queue : queue?.name;
				const owner = typeof queue?.entity === "string" ? queue.entity : queue?.source;
				return `${name ?? "unnamed queue"} — ${owner ?? "unknown owner"}`;
			}),
		),
	);

	lines.push("### Top Remarks");
	lines.push("");
	if (remarks.length === 0) {
		lines.push("Нет ремарок.\n");
	} else {
		for (const remark of remarks) {
			lines.push(
				`- **${remark.text}** — ${remark.applies} применений (${remark.scope} → ${remark.path})`,
			);
		}
		lines.push("");
	}

	lines.push("### Most Remarked Files");
	lines.push("");
	if (remarkedFiles.length === 0) {
		lines.push("Нет файлов с ремарками.\n");
	} else {
		for (const file of remarkedFiles) {
			lines.push(`- ${file.file_path} — ${file.total} ремарок`);
		}
		lines.push("");
	}

	const reportPath = path.join(reportsDir, "structure.md");
	fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");

	return {
		taskId: options.taskId,
		reportPath,
	};
}

async function runCli(): Promise<void> {
	const argv = await yargs(hideBin(process.argv))
		.scriptName("generate-structure-report")
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
			describe: "Корневая папка для отчётов (analysis или analysis/reports)",
		})
		.option("log_file", {
			type: "string",
			describe: "Путь для записи stdout/stderr (append)",
		})
		.help()
		.parseAsync();

	const restoreLog = setupLogWriter(argv.log_file);
	try {
		const result = generateStructureReport({
			dbPath: argv.db_path,
			taskId: argv.task_id,
			outputsDir: argv.outputs_dir,
		});

		console.log(
			JSON.stringify(
				{
					message: "Structure report generated",
					taskId: result.taskId,
					reportPath: result.reportPath,
				},
				null,
				2,
			),
		);
	} catch (error) {
		console.error("generate-structure-report failed:", error);
		process.exitCode = 1;
	} finally {
		restoreLog();
	}
}

if (isMainModule(import.meta.url)) {
	void runCli();
}
