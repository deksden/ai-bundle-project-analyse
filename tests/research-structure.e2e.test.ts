import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	cleanupWorkspaces,
	createWorkspace,
	seedPipelineContext,
	type PipelineContext,
} from "./utils.ts";

import { clearAndWriteToDb } from "../../bundle/scripts/clear-and-write-to-db.ts";
import { compactDb } from "../../bundle/scripts/compact-db.ts";
import { enrichLinks } from "../../bundle/scripts/enrich-links.ts";
import { exportSnapshot } from "../../bundle/scripts/export-snapshot.ts";
import { generateStructureReport } from "../../bundle/scripts/generate-structure-report.ts";
import { finalizeRun } from "../../bundle/scripts/finalize-run.ts";

const docMatcherModulePromise = import(
	pathToFileURL(
		path.resolve("bundle/scripts/workflow/lanes/utils/doc-matcher.mjs"),
	).href,
) as Promise<
	typeof import("../../bundle/scripts/workflow/lanes/utils/doc-matcher.mjs")
>;

const EXPECTED_DIR = path.resolve("bundle/tests/fixtures/expected");
const INGEST_FIXTURE = path.resolve("bundle/tests/fixtures/ingest.jsonl");

const PLACEHOLDER_TASK_ID = "<<TASK_ID>>";
const PLACEHOLDER_ISO = "<<ISO>>";

function loadExpected(fileName: string) {
	const payload = fs.readFileSync(path.join(EXPECTED_DIR, fileName), "utf8");
	return JSON.parse(payload) as unknown;
}

function sanitizeEntities(actual: any) {
	return {
		taskId: PLACEHOLDER_TASK_ID,
		entities: [...actual.entities]
			.map((entity: any) => ({
				...entity,
				metadata: entity.metadata
					? {
							...entity.metadata,
							analysis: entity.metadata.analysis
								? {
										...entity.metadata.analysis,
										taskId: PLACEHOLDER_TASK_ID,
									}
								: undefined,
						}
					: undefined,
			}))
			.sort((a: any, b: any) => a.id.localeCompare(b.id)),
	};
}

function sanitizeRelationships(actual: any) {
	return {
		taskId: PLACEHOLDER_TASK_ID,
		relationships: [...actual.relationships]
			.map((rel: any) => ({
				...rel,
				metadata: {
					...rel.metadata,
					analysis: rel.metadata.analysis
						? {
								...rel.metadata.analysis,
								taskId: PLACEHOLDER_TASK_ID,
							}
						: undefined,
				},
			}))
			.sort((a: any, b: any) => a.id.localeCompare(b.id)),
	};
}

function sanitizeCoverage(actual: any) {
	expect(typeof actual.coverage.updatedAt).toBe("string");
	expect(new Date(actual.coverage.updatedAt).toString()).not.toBe("Invalid Date");
	return {
		taskId: PLACEHOLDER_TASK_ID,
		coverage: {
			...actual.coverage,
			updatedAt: PLACEHOLDER_ISO,
		},
	};
}

function sanitizeMetrics(actual: any) {
	return {
		taskId: PLACEHOLDER_TASK_ID,
		metrics: actual.metrics,
	};
}

function sanitizeListContainer(actual: any, key: string) {
	const sorted = [...actual[key]].sort((a: any, b: any) =>
		JSON.stringify(a).localeCompare(JSON.stringify(b)),
	);
	return {
		taskId: PLACEHOLDER_TASK_ID,
		[key]: sorted,
	};
}

function queryDb<T = unknown>(dbPath: string, sql: string): T[] {
	const result = spawnSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(result.stderr || "sqlite3 query failed");
	}
	const trimmed = result.stdout.trim();
	return trimmed.length ? (JSON.parse(trimmed) as T[]) : [];
}

function writeDocsProcessFixture(projectRoot: string, analysisDir: string): void {
	const docPath = path.join(projectRoot, "docs/ADR-000.md");
	const records = [
		{
			file: {
				absolute_path: docPath,
				relative_path: "docs/ADR-000.md",
				display_path: "docs/ADR-000.md",
			},
			doc_summary: {
				title: "ADR-000 Sample Doc",
				summary: "Navigation bridge documentation",
			},
			mentions: [
				{
					type: "cli",
					value:
						'pnpm analysis-cli doc insert --workspace "$STEP_ROOT" --input "$STEP_ROOT/docs-process.json"',
				},
			],
		},
	];
	fs.mkdirSync(analysisDir, { recursive: true });
	fs.writeFileSync(
		path.join(analysisDir, "docs-process.json"),
		JSON.stringify(records, null, 2),
	);
}

describe("research-structure pipeline e2e", () => {
	let context: PipelineContext;

	beforeEach(() => {
		context = createWorkspace(`task-e2e-${Date.now()}`);
	});

	afterEach(() => {
		cleanupWorkspaces();
	});

	it("produces expected exports and summary artefacts", async () => {
		const { taskId, dbPath, projectRoot, baseDir } = context;
		const outputsDir = path.join(baseDir, "analysis");
		fs.mkdirSync(outputsDir, { recursive: true });

		await seedPipelineContext(context);
		writeDocsProcessFixture(projectRoot, outputsDir);
		const { synchronizeDocMatches } = await docMatcherModulePromise;

		clearAndWriteToDb({
			dbPath,
			taskId,
			ingestPath: INGEST_FIXTURE,
			source: "fixture",
		});

		const compactResult = compactDb({ dbPath, taskId });
		expect(compactResult.removedProcessingLogs).toBeGreaterThanOrEqual(0);

		const enrichResult = enrichLinks({ dbPath, taskId });
		expect(enrichResult.entitiesTotal).toBe(3);
		expect(enrichResult.relationshipsTotal).toBe(2);

		const exportResult = exportSnapshot({ dbPath, taskId, outputsDir });
		const reportResult = generateStructureReport({ dbPath, taskId, outputsDir });
		const finalizeResult = finalizeRun({ dbPath, taskId, outputsDir });

		const reportsDir = path.join(outputsDir, "reports");
		fs.mkdirSync(reportsDir, { recursive: true });
		const docMatchesResult = synchronizeDocMatches({
			dbPath,
			taskId,
			analysisDir: outputsDir,
			reportsDir,
		});

		const exportsDir = exportResult.exportsDir;

		const entitiesActual = JSON.parse(
			fs.readFileSync(path.join(exportsDir, "entities.json"), "utf8"),
		);
		const relationshipsActual = JSON.parse(
			fs.readFileSync(path.join(exportsDir, "relationships.json"), "utf8"),
		);
		const coverageActual = JSON.parse(
			fs.readFileSync(path.join(exportsDir, "coverage.json"), "utf8"),
		);
		const metricsActual = JSON.parse(
			fs.readFileSync(path.join(exportsDir, "metrics.json"), "utf8"),
		);
		const externalActual = JSON.parse(
			fs.readFileSync(path.join(exportsDir, "external-systems.json"), "utf8"),
		);
		const endpointsActual = JSON.parse(
			fs.readFileSync(path.join(exportsDir, "endpoints.json"), "utf8"),
		);
		const queuesActual = JSON.parse(
			fs.readFileSync(path.join(exportsDir, "queues.json"), "utf8"),
		);

	expect(sanitizeEntities(entitiesActual)).toEqual(
		loadExpected("entities.json"),
	);
	expect(sanitizeRelationships(relationshipsActual)).toEqual(
		loadExpected("relationships.json"),
	);
		expect(sanitizeCoverage(coverageActual)).toEqual(
			loadExpected("coverage.json"),
		);
		expect(sanitizeMetrics(metricsActual)).toEqual(loadExpected("metrics.json"));
		expect(sanitizeListContainer(externalActual, "externalSystems")).toEqual(
			loadExpected("external-systems.json"),
		);
		expect(sanitizeListContainer(endpointsActual, "endpoints")).toEqual(
			loadExpected("endpoints.json"),
		);
		expect(sanitizeListContainer(queuesActual, "queues")).toEqual(
			loadExpected("queues.json"),
		);

	const report = fs.readFileSync(reportResult.reportPath, "utf8");
	expect(report).toContain(`# Structure Report (Task ${taskId})`);
		expect(report).toContain("| Entities | 3 |");
		expect(report).toContain("API entry requires docs");
		expect(report).toContain("Research DB");

	const summary = JSON.parse(fs.readFileSync(finalizeResult.summaryPath, "utf8"));
	expect(summary.taskId).toBe(taskId);
		expect(summary.coverage.files.total).toBe(6);
		expect(summary.coverage.entities.total).toBe(3);
		expect(summary.metrics.entityTypes.service).toBe(2);
		expect(summary.externalSystems).toHaveLength(1);
	expect(summary.serviceEndpoints).toHaveLength(2);

		expect(docMatchesResult.metrics.export_documented).toBeGreaterThanOrEqual(1);
		expect(docMatchesResult.metrics.export_undocumented).toBeGreaterThanOrEqual(1);

		const docMatchesReport = JSON.parse(
			fs.readFileSync(path.join(reportsDir, "doc-matches.json"), "utf8"),
		);
		expect(docMatchesReport.metrics.export_documented).toBe(1);
		expect(docMatchesReport.metrics.export_undocumented).toBe(1);
		const registerMatch = docMatchesReport.matches.find(
			(match: any) =>
				match.code_name === "registerNavigationBridge" && match.status === "found",
		);
		const missingMatch = docMatchesReport.matches.find(
			(match: any) =>
				match.code_name === "syncTelemetrySnapshot" && match.status === "missing",
		);
		expect(registerMatch).toBeDefined();
		expect(missingMatch).toBeDefined();

		const storedMatches = queryDb<{ code_key: string; doc_key: string }>(
			dbPath,
			`SELECT code_key, doc_key FROM doc_matches WHERE run_id='${taskId}' ORDER BY code_key`,
		);
		expect(storedMatches).toHaveLength(2);

		expect(fs.existsSync(path.join(exportsDir, "entities.json"))).toBe(true);
		expect(fs.existsSync(reportResult.reportPath)).toBe(true);
		expect(fs.existsSync(finalizeResult.summaryPath)).toBe(true);
		expect(fs.existsSync(path.join(reportsDir, "doc-matches.md"))).toBe(true);
	});
});
