#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { ensureDocId, buildRelationshipId } from "../workflow/docs/utils.mjs";

const DEFAULT_DB_CANDIDATES = [
	"global/shared/research-structure/shared-resources/analysis.db",
	"global/shared/research-structure/analysis.db",
	"analysis/analysis.db",
	"analysis.db",
];

function escapeSqlValue(value) {
	if (value === null || value === undefined) return "NULL";
	if (typeof value === "number" && Number.isFinite(value)) {
		return String(value);
	}
	if (typeof value === "boolean") {
		return value ? "1" : "0";
	}
	const normalized = String(value).replace(/'/g, "''");
	return `'${normalized}'`;
}

function runSqlite(dbPath, statements) {
	const payload = []
		.concat(statements)
		.filter(Boolean)
		.map((stmt) => stmt.trim())
		.join(";\n");
	if (!payload) {
		return;
	}
	const result = spawnSync("sqlite3", [dbPath], {
		input: `${payload};\n`,
		encoding: "utf8",
	});
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || "sqlite3 command failed");
	}
}

function querySqlite(dbPath, sql) {
	const result = spawnSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || "sqlite3 query failed");
	}
	const trimmed = result.stdout?.trim();
	if (!trimmed) return [];
	try {
		return JSON.parse(trimmed);
	} catch (error) {
		throw new Error(`Failed to parse sqlite3 JSON response: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function ensurePathExists(target, description) {
	if (!fs.existsSync(target)) {
		throw new Error(`${description} не найден: ${target}`);
	}
	return target;
}

function resolveWorkspace(rawWorkspace) {
	const workspace = path.resolve(rawWorkspace ?? process.cwd());
	if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) {
		throw new Error(`Workspace недоступен: ${workspace}`);
	}
	return workspace;
}

function resolveDbPath(workspace, overrideDbPath) {
	if (overrideDbPath) {
		const absolute = path.resolve(overrideDbPath);
		return ensurePathExists(absolute, "analysis.db");
	}
	for (const relative of DEFAULT_DB_CANDIDATES) {
		const candidate = path.resolve(workspace, relative);
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}
	throw new Error(
		`analysis.db не найден поблизости от ${workspace}. Укажи путь явно через --db-path.`,
	);
}

function tryReadJson(filePath) {
	if (!fs.existsSync(filePath)) return null;
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch {
		return null;
	}
}

function resolveTaskId(workspace, overrideRunId) {
	if (overrideRunId) {
		return overrideRunId;
	}
	const ctx = tryReadJson(path.join(workspace, "_context.json"));
	if (ctx?.task?.id) {
		return ctx.task.id;
	}
	if (ctx?.task_id) {
		return ctx.task_id;
	}
	const envTask = process.env.TASK_ID;
	return typeof envTask === "string" && envTask.length > 0 ? envTask : null;
}

function resolveBundleRoot(workspace, overrideBundleRoot) {
	if (overrideBundleRoot) {
		return ensurePathExists(path.resolve(overrideBundleRoot), "Bundle root");
	}
	const candidates = [
		path.join(workspace, "global/bundle/research-structure"),
		path.join(workspace, "bundle/research-structure"),
	];
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}
	throw new Error(
		`bundle/research-structure не найден. Укажи путь вручную через --bundle-root.`,
	);
}

function normalizeLimit(value, fallback = 25) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return fallback;
	}
	return Math.min(parsed, 500);
}

function toInteger(value) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? Math.floor(parsed) : null;
}

function outputResult(payload, { format = "json", pretty = true } = {}) {
	if (format === "table") {
		const summary = payload.summary ?? {};
		const rows = payload.rows ?? [];
		if (Object.keys(summary).length > 0) {
			console.log("Summary:");
			for (const [key, value] of Object.entries(summary)) {
				console.log(`- ${key}: ${value}`);
			}
		}
		if (rows.length > 0) {
			console.table(rows);
		} else {
			console.log("Rows: 0");
		}
		return;
	}
	console.log(JSON.stringify(payload, null, pretty ? 2 : 0));
}

function convertDocEntities(state, workspace) {
	const records = Array.isArray(state?.doc_entities) ? state.doc_entities : [];
	if (records.length === 0) {
		return [];
	}
	const fileInfo = state?.file ?? {};
	const documentPathRaw =
		fileInfo.absolute_path ??
		fileInfo.path ??
		(fileInfo.relative_path ? path.join(workspace, fileInfo.relative_path) : null) ??
		fileInfo.display_path ??
		"document";
	const documentPath = path.resolve(documentPathRaw);
	return records.map((entry, index) => {
		const heading =
			typeof entry.heading === "string" && entry.heading.length > 0
				? entry.heading
				: `Section ${index + 1}`;
		const docId =
			entry.doc_id ??
			ensureDocId({
				documentPath,
				relativePath: fileInfo.relative_path ?? fileInfo.display_path ?? entry.doc_id,
				heading,
				anchor: entry.anchor,
				index,
			});
		const topics = Array.isArray(entry.topics) ? entry.topics.map(String) : [];
		const tags = Array.isArray(entry.tags) ? entry.tags.map(String) : [];
		const references = Array.isArray(entry.references) ? entry.references : [];
		return {
			type: "raw_doc_entity",
			doc_id: docId,
			document_path: documentPath,
			heading,
			anchor: entry.anchor ?? null,
			block_start_line:
				toInteger(entry.block_start_line ?? entry.line_start) ?? null,
			block_end_line: toInteger(entry.block_end_line ?? entry.line_end) ?? null,
			content_hash: entry.content_hash ?? null,
			metadata: {
				summary: entry.summary ?? null,
				tags,
				topics,
				references,
				evidence: entry.evidence ?? null,
				doc_language: fileInfo.language ?? state?.metrics?.doc_language ?? null,
				doc_format: fileInfo.format ?? fileInfo.extension ?? state?.metrics?.doc_format ?? null,
			},
		};
	});
}

function convertDocRelationships(state, docEntities) {
	const records = Array.isArray(state?.doc_relationships) ? state.doc_relationships : [];
	if (records.length === 0) {
		return [];
	}
	const defaultSource = docEntities[0]?.doc_id ?? null;
	const documentPath =
		state?.file?.path ??
		state?.file?.absolute_path ??
		state?.file?.relative_path ??
		state?.file?.display_path ??
		null;
	return records
		.map((relationship, index) => {
			if (!relationship || typeof relationship !== "object") {
				return null;
			}
			const relationshipId =
				relationship.relationship_id ??
				buildRelationshipId(docEntities[0]?.doc_id ?? `doc-${index + 1}`, index + 1);
			return {
				type: "raw_relationship",
				relationship_id: relationshipId,
				kind: relationship.kind ?? "references-code",
				source_symbol_id: relationship.source_doc_id ?? defaultSource,
				target_symbol_id: relationship.target_symbol_id ?? relationship.target ?? null,
				source_path: documentPath,
				target_path: relationship.target_path ?? null,
				metadata: {
					description: relationship.description ?? relationship.notes ?? null,
					evidence: relationship.evidence ?? relationship.quote ?? null,
				},
			};
		})
		.filter(Boolean);
}

function buildJsonLines(records) {
	if (records.length === 0) return "";
	return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function runWriteToDb(bundleRoot, options) {
	const args = [
		"--silent",
		"exec",
		"tsx",
		path.join(bundleRoot, "scripts/write-to-db.ts"),
		"--db_path",
		options.dbPath,
		"--task_id",
		options.taskId,
		"--ingest_path",
		options.ingestPath,
		"--source",
		options.source ?? "analysis-cli",
	];
	if (options.logFile) {
		args.push("--log_file", options.logFile);
	}
	const result = spawnSync("pnpm", args, {
		cwd: bundleRoot,
		encoding: "utf8",
		stdio: ["inherit", "pipe", "pipe"],
	});
	if (result.status !== 0) {
		throw new Error(
			`write-to-db failed: ${result.stderr || result.stdout || `exit code ${result.status}`}`,
		);
	}
	const stdout = result.stdout?.trim();
	if (!stdout) return null;
	const lines = stdout.split("\n").filter((line) => line.trim().startsWith("{"));
	if (lines.length === 0) return null;
	try {
		return JSON.parse(lines[lines.length - 1]);
	} catch {
		return null;
	}
}

function buildReadContext(argv) {
	const workspace = resolveWorkspace(argv.workspace);
	const dbPath = resolveDbPath(workspace, argv.dbPath);
	const runId = resolveTaskId(workspace, argv.runId);
	return { workspace, dbPath, runId };
}

function handleEntitiesByName(argv) {
	const ctx = buildReadContext(argv);
	const limit = normalizeLimit(argv.limit, 25);
	const conditions = [];
	if (ctx.runId) {
		conditions.push(`run_id=${escapeSqlValue(ctx.runId)}`);
	}
	if (argv.type) {
		conditions.push(`entity_type=${escapeSqlValue(argv.type)}`);
	}
	if (argv.query) {
		const like = `%${argv.query}%`;
		conditions.push(`name LIKE ${escapeSqlValue(like)}`);
	}
	const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	const sql = `SELECT run_id, entity_id, entity_type, name, stable_key, coverage_status, confidence, path, updated_at FROM result_entities ${whereClause} ORDER BY updated_at DESC LIMIT ${limit}`;
	const rows = querySqlite(ctx.dbPath, sql);
	return {
		summary: {
			run_id: ctx.runId ?? "not-set",
			rows: rows.length,
			limit,
		},
		rows,
	};
}

function handleFilesList(argv) {
	const ctx = buildReadContext(argv);
	const limit = normalizeLimit(argv.limit, 25);
	const conditions = [];
	if (argv.kind) {
		conditions.push(`kind=${escapeSqlValue(argv.kind)}`);
	}
	if (argv.contains) {
		const like = `%${argv.contains}%`;
		conditions.push(`path LIKE ${escapeSqlValue(like)}`);
	}
	if (argv.changedOnly) {
		conditions.push("last_seen_run IS NULL");
	}
	const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	const sql = `SELECT path, kind, hash, hash_algorithm, size, last_seen_run, updated_at FROM files ${whereClause} ORDER BY updated_at DESC LIMIT ${limit}`;
	const rows = querySqlite(ctx.dbPath, sql);
	return {
		summary: {
			rows: rows.length,
			limit,
			filtered_kind: argv.kind ?? "any",
		},
		rows,
	};
}

function handleDocMatches(argv) {
	const ctx = buildReadContext(argv);
	const limit = normalizeLimit(argv.limit, 50);
	const conditions = [];
	if (ctx.runId) {
		conditions.push(`run_id=${escapeSqlValue(ctx.runId)}`);
	}
	if (argv.doc) {
		const like = `%${argv.doc}%`;
		conditions.push(`doc_key LIKE ${escapeSqlValue(like)}`);
	}
	if (argv.code) {
		const like = `%${argv.code}%`;
		conditions.push(`code_key LIKE ${escapeSqlValue(like)}`);
	}
	if (argv.kind) {
		conditions.push(`match_kind=${escapeSqlValue(argv.kind)}`);
	}
	if (argv.minConfidence != null) {
		conditions.push(`confidence >= ${Number(argv.minConfidence)}`);
	}
	const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	const sql = `SELECT run_id, doc_key, code_key, match_kind, confidence, metadata, updated_at FROM doc_matches ${whereClause} ORDER BY confidence DESC NULLS LAST LIMIT ${limit}`;
	const rows = querySqlite(ctx.dbPath, sql).map((row) => {
		if (row.metadata) {
			try {
				return { ...row, metadata: JSON.parse(row.metadata) };
			} catch {
				return row;
			}
		}
		return row;
	});
	const docs = new Set(rows.map((row) => row.doc_key));
	const codes = new Set(rows.map((row) => row.code_key));
	return {
		summary: {
			run_id: ctx.runId ?? "not-set",
			rows: rows.length,
			docs: docs.size,
			code_symbols: codes.size,
		},
		rows,
	};
}

function handleRawUnresolved(argv) {
	const ctx = buildReadContext(argv);
	if (!ctx.runId) {
		throw new Error("Для команды raw unresolved требуется run_id (передай --run-id или workspace шага).");
	}
	const limit = normalizeLimit(argv.limit, 25);
	const type = argv.type === "code" ? "code" : "doc";
	let sql = "";
	if (type === "doc") {
		sql = `SELECT doc_id, document_path, heading, anchor, updated_at FROM raw_doc_entities WHERE run_id=${escapeSqlValue(
			ctx.runId,
		)} AND doc_id NOT IN (SELECT doc_key FROM doc_matches WHERE run_id=${escapeSqlValue(
			ctx.runId,
		)}) ORDER BY updated_at DESC LIMIT ${limit}`;
	} else {
		sql = `SELECT symbol_id, file_path, name, kind, updated_at FROM raw_code_entities WHERE run_id=${escapeSqlValue(
			ctx.runId,
		)} AND symbol_id NOT IN (SELECT code_key FROM doc_matches WHERE run_id=${escapeSqlValue(
			ctx.runId,
		)}) ORDER BY updated_at DESC LIMIT ${limit}`;
	}
	const rows = querySqlite(ctx.dbPath, sql);
	return {
		summary: {
			type,
			run_id: ctx.runId,
			rows: rows.length,
		},
		rows,
	};
}

function handleCleanFile(argv) {
	const ctx = buildReadContext(argv);
	const targetPath = path.resolve(argv.file);
	const escaped = escapeSqlValue(targetPath);
	runSqlite(ctx.dbPath, [
		"BEGIN",
		`DELETE FROM doc_matches WHERE doc_key IN (SELECT doc_id FROM raw_doc_entities WHERE document_path=${escaped})`,
		`DELETE FROM doc_matches WHERE code_key IN (SELECT symbol_id FROM raw_code_entities WHERE file_path=${escaped})`,
		`DELETE FROM raw_relationships WHERE relationship_id IN (
			SELECT relationship_id FROM raw_relationships
			WHERE source_symbol_id IN (SELECT symbol_id FROM raw_code_entities WHERE file_path=${escaped})
			   OR target_symbol_id IN (SELECT symbol_id FROM raw_code_entities WHERE file_path=${escaped})
		)`,
		`DELETE FROM raw_doc_blocks WHERE document_path=${escaped}`,
		`DELETE FROM raw_doc_entities WHERE document_path=${escaped}`,
		`DELETE FROM raw_code_entities WHERE file_path=${escaped}`,
		`DELETE FROM files WHERE path=${escaped}`,
		"COMMIT",
	]);
	return {
		message: "File cleaned",
		file: targetPath,
		dbPath: ctx.dbPath,
	};
}

function handleCleanRun(argv) {
	const ctx = buildReadContext(argv);
	const runId = argv.runIdOverride ?? ctx.runId;
	if (!runId) {
		throw new Error("Укажи run_id через --run-id для очистки.");
	}
	const escapedRun = escapeSqlValue(runId);
	runSqlite(ctx.dbPath, [
		"BEGIN",
		`DELETE FROM raw_code_entities WHERE run_id=${escapedRun}`,
		`DELETE FROM raw_doc_entities WHERE run_id=${escapedRun}`,
		`DELETE FROM raw_doc_blocks WHERE run_id=${escapedRun}`,
		`DELETE FROM raw_relationships WHERE run_id=${escapedRun}`,
		`DELETE FROM result_entities WHERE run_id=${escapedRun}`,
		`DELETE FROM result_relationships WHERE run_id=${escapedRun}`,
		`DELETE FROM doc_matches WHERE run_id=${escapedRun}`,
		`DELETE FROM entities WHERE run_id=${escapedRun}`,
		`DELETE FROM relationships WHERE run_id=${escapedRun}`,
		`DELETE FROM layers WHERE run_id=${escapedRun}`,
		`DELETE FROM slices WHERE run_id=${escapedRun}`,
		`DELETE FROM evidence WHERE run_id=${escapedRun}`,
		`DELETE FROM ingest_log WHERE run_id=${escapedRun}`,
		`DELETE FROM file_index WHERE run_id=${escapedRun}`,
		`DELETE FROM coverage_summary WHERE run_id=${escapedRun}`,
		`DELETE FROM run_metrics WHERE run_id=${escapedRun}`,
		`DELETE FROM runs WHERE id=${escapedRun}`,
		`UPDATE files SET last_seen_run=NULL WHERE last_seen_run=${escapedRun}`,
		"COMMIT",
	]);
	return {
		message: "Run cleaned",
		run_id: runId,
		dbPath: ctx.dbPath,
	};
}

function handleResetDb(argv) {
	if (!argv.force) {
		throw new Error("reset-db требует явного подтверждения (--force).");
	}
	const ctx = buildReadContext(argv);
	runSqlite(ctx.dbPath, [
		"BEGIN",
		"DELETE FROM raw_code_entities",
		"DELETE FROM raw_doc_entities",
		"DELETE FROM raw_doc_blocks",
		"DELETE FROM raw_relationships",
		"DELETE FROM result_entities",
		"DELETE FROM result_relationships",
		"DELETE FROM doc_matches",
		"DELETE FROM entities",
		"DELETE FROM relationships",
		"DELETE FROM layers",
		"DELETE FROM slices",
		"DELETE FROM evidence",
		"DELETE FROM files",
		"DELETE FROM file_index",
		"DELETE FROM ingest_log",
		"DELETE FROM coverage_summary",
		"DELETE FROM run_metrics",
		"DELETE FROM remarks",
		"DELETE FROM remark_applies",
		"DELETE FROM runs",
		"COMMIT",
		"VACUUM",
	]);
	return {
		message: "Database reset",
		dbPath: ctx.dbPath,
	};
}

function handleDocInsert(argv) {
	const workspace = resolveWorkspace(argv.workspace);
	const globalRoot = ensurePathExists(
		path.join(workspace, "global"),
		"global directory",
	);
	const ctxPath = path.join(workspace, "_context.json");
	const context = tryReadJson(ctxPath) ?? {};
	const runId = argv.runId ?? context?.task?.id ?? context?.task_id;
	if (!runId) {
		throw new Error("task_id не найден в _context.json — передай вручную через --run-id.");
	}
	const dbPath = resolveDbPath(workspace, argv.dbPath);
	const bundleRoot = resolveBundleRoot(workspace, argv.bundleRoot);
	const logsDir = path.join(globalRoot, "logs");
	if (!fs.existsSync(logsDir)) {
		fs.mkdirSync(logsDir, { recursive: true });
	}
	const inputPath = path.resolve(argv.input ?? path.join(workspace, "docs-process.json"));
	if (!fs.existsSync(inputPath)) {
		throw new Error(`docs-process.json не найден: ${inputPath}`);
	}
	let state;
	try {
		state = JSON.parse(fs.readFileSync(inputPath, "utf8"));
	} catch (error) {
		throw new Error(
			`Не удалось прочитать docs-process.json: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const docEntities = convertDocEntities(state, workspace);
	const relationships = convertDocRelationships(state, docEntities);
	if (docEntities.length === 0) {
		throw new Error("docs-process.json не содержит doc_entities — нечего записывать в БД.");
	}
	const ingestionRecords = [...docEntities, ...relationships];
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "analysis-cli-"));
	const ingestPath = path.join(tempDir, "doc-ingest.jsonl");
	fs.writeFileSync(ingestPath, buildJsonLines(ingestionRecords));
	const summary = runWriteToDb(bundleRoot, {
		dbPath,
		taskId: runId,
		ingestPath,
		logFile: path.join(logsDir, "analysis-cli.doc-insert.log"),
		source: "analysis-cli-doc",
	});
	fs.rmSync(tempDir, { recursive: true, force: true });
	return {
		action: "doc_insert",
		run_id: runId,
		dbPath,
		input: inputPath,
		doc_entities: docEntities.length,
		doc_relationships: relationships.length,
		write_to_db: summary,
	};
}

function withHandler(fn) {
	return (argv) => {
		try {
			const result = fn(argv);
			outputResult(result, argv);
		} catch (error) {
			console.error("analysis-cli error:", error instanceof Error ? error.message : error);
			process.exitCode = 1;
		}
	};
}

function withHandlerRaw(fn) {
	return (argv) => {
		try {
			const result = fn(argv);
			outputResult(result, argv);
		} catch (error) {
			console.error("analysis-cli error:", error instanceof Error ? error.message : error);
			process.exitCode = 1;
		}
	};
}

async function main() {
	await yargs(hideBin(process.argv))
		.scriptName("analysis-cli")
		.option("workspace", {
			type: "string",
			describe: "Корень step workspace (по умолчанию текущий каталог)",
		})
		.option("db-path", {
			type: "string",
			describe: "Прямой путь к analysis.db (если отличен от стандартного)",
		})
		.option("bundle-root", {
			type: "string",
			describe: "Путь к bundle/research-structure (для doc insert)",
		})
		.option("run-id", {
			type: "string",
			describe: "Override run_id (по умолчанию берёт из _context.json)",
		})
		.option("format", {
			choices: ["json", "table"],
			default: "json",
			describe: "Формат вывода для read-команд",
		})
		.option("pretty", {
			type: "boolean",
			default: true,
			describe: "Форматировать JSON вывод",
		})
		.command(
			["entities by-name <query>", "entities name <query>"],
			"Поиск result_entities по имени",
			(y) =>
				y
					.positional("query", {
						type: "string",
						describe: "Часть имени сущности",
					})
					.option("type", {
						type: "string",
						describe: "Фильтр по entity_type",
					})
					.option("limit", {
						type: "number",
						default: 25,
					}),
			withHandler(handleEntitiesByName),
		)
		.command(
			["files list", "files"],
			"Список файлов из таблицы files",
			(y) =>
				y
					.option("kind", {
						type: "string",
						describe: "Фильтр по files.kind",
					})
					.option("contains", {
						type: "string",
						describe: "Подстрока пути",
					})
					.option("changed-only", {
						type: "boolean",
						default: false,
						describe: "Показать записи без last_seen_run",
					})
					.option("limit", {
						type: "number",
						default: 25,
					}),
			withHandler(handleFilesList),
		)
		.command(
			["doc matches", "doc-matches"],
			"Показать doc_matches и конфликты покрытия",
			(y) =>
				y
					.option("doc", { type: "string", describe: "Фильтр по doc_key" })
					.option("code", { type: "string", describe: "Фильтр по code_key" })
					.option("kind", { type: "string", describe: "match_kind" })
					.option("min-confidence", {
						type: "number",
						describe: "Минимальная уверенность",
					})
					.option("limit", {
						type: "number",
						default: 50,
					}),
			withHandler(handleDocMatches),
		)
		.command(
			["raw unresolved", "raw missing"],
			"Показать doc/code записи без doc_matches",
			(y) =>
				y
					.option("type", {
						choices: ["doc", "code"],
						default: "doc",
						describe: "Тип записи",
					})
					.option("limit", {
						type: "number",
						default: 25,
					}),
			withHandler(handleRawUnresolved),
		)
		.command(
			["doc insert"],
			"Импортировать docs-process.json в SQLite через write-to-db",
			(y) =>
				y
					.option("input", {
						type: "string",
						default: "docs-process.json",
						describe: "Путь к docs-process.json (по умолчанию в workspace)",
					})
					.option("run-id", {
						type: "string",
						describe: "Override run_id для записи",
					}),
			withHandlerRaw(handleDocInsert),
		)
		.command(
			["clean file <file>", "clean-file <file>"],
			"Удалить данные, связанные с файлом",
			(y) =>
				y.positional("file", {
					type: "string",
					describe: "Абсолютный путь файла/документа",
				}),
			withHandlerRaw(handleCleanFile),
		)
		.command(
			["clean run", "clean-run"],
			"Удалить все записи run_id",
			(y) =>
				y.option("run-id", {
					type: "string",
					describe: "Идентификатор run (по умолчанию из контекста)",
				}),
			withHandlerRaw((argv) =>
				handleCleanRun({
					...argv,
					runIdOverride: argv.runId ?? argv["run-id"],
				}),
			),
		)
		.command(
			["reset-db"],
			"Очистить все таблицы analysis.db (подтверждение обязательно)",
			(y) =>
				y.option("force", {
					type: "boolean",
					default: false,
					describe: "Подтвердить сброс",
				}),
			withHandlerRaw(handleResetDb),
		)
		.demandCommand(1)
		.help()
		.strict()
		.parseAsync();
}

void main();
