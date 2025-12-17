import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

function escapeSqlValue(value) {
	if (value === null || value === undefined) {
		return "NULL";
	}
	return `'${String(value).replace(/'/g, "''")}'`;
}

function runSqlite(dbPath, statements) {
	if (!dbPath) return;
	const payload = (Array.isArray(statements) ? statements : [statements]).join(";\n");
	const result = spawnSync("sqlite3", [dbPath], { input: `${payload};`, encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(result.stderr || "sqlite3 command failed");
	}
}

function querySqlite(dbPath, sql) {
	if (!dbPath) return [];
	const result = spawnSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(result.stderr || "sqlite3 query failed");
	}
	const output = result.stdout?.trim();
	return output ? JSON.parse(output) : [];
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSearchPatterns(name) {
	const base = name?.trim();
	if (!base) return [];
	const variants = new Set([base]);
	if (!base.includes("(")) {
		variants.add(`${base}(`);
	}
	if (!base.startsWith("`")) {
		variants.add(`\`${base}\``);
	}
	if (/[A-Z]/.test(base)) {
		variants.add(base.toLowerCase());
	}
	return Array.from(variants);
}

function resolveDocPath(record) {
	const candidate =
		record?.file?.absolute_path ??
		record?.file?.path ??
		(record?.file?.relative_path ? path.resolve(record.file.relative_path) : null);
	return candidate && fs.existsSync(candidate) ? candidate : null;
}

function readDocRecords(analysisDir) {
	const docsPath = path.join(analysisDir, "docs-process.json");
	if (!fs.existsSync(docsPath)) {
		return [];
	}
	try {
		const parsed = JSON.parse(fs.readFileSync(docsPath, "utf8"));
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function loadExportedSymbols(dbPath, taskId) {
	if (!dbPath || !taskId) return [];
	const rows = querySqlite(
		dbPath,
		`SELECT symbol_id, name, file_path, metadata FROM raw_code_entities WHERE run_id=${escapeSqlValue(taskId)}`,
	);
	return rows
		.map((row) => {
			let metadata = {};
			if (row.metadata) {
				try {
					metadata = JSON.parse(row.metadata);
				} catch {
					metadata = {};
				}
			}
			const exported =
				metadata.export_status && metadata.export_status !== "none"
					? metadata.export_status
					: metadata.exported
						? "exported"
						: "none";
			return {
				symbol_id: row.symbol_id,
				name: row.name,
				file_path: row.file_path,
				export_status: exported,
			};
		})
		.filter((row) => row.export_status && row.export_status !== "none" && row.name);
}

function computeLine(content, index) {
	if (index <= 0) return 1;
	let line = 1;
	for (let i = 0; i < index; i += 1) {
		if (content.charCodeAt(i) === 10) {
			line += 1;
		}
	}
	return line;
}

function findMatchInDocument(doc, patterns) {
	for (const pattern of patterns) {
		const escaped = escapeRegExp(pattern);
		const regex = /\w/.test(pattern) ? new RegExp(`\\b${escaped}\\b`) : new RegExp(escaped);
		const match = regex.exec(doc.content);
		if (match) {
			const line = computeLine(doc.content, match.index);
			const snippet = doc.lines[line - 1]?.trim() ?? "";
			return {
				line,
				snippet,
				pattern,
			};
		}
		// fallback case-insensitive
		const regexInsensitive = /\w/.test(pattern)
			? new RegExp(`\\b${escaped}\\b`, "i")
			: new RegExp(escaped, "i");
		const matchInsensitive = regexInsensitive.exec(doc.content);
		if (matchInsensitive) {
			const line = computeLine(doc.content, matchInsensitive.index);
			const snippet = doc.lines[line - 1]?.trim() ?? "";
			return {
				line,
				snippet,
				pattern,
			};
		}
	}
	return null;
}

function loadDocumentContents(docRecords) {
	const docs = [];
	for (const record of docRecords) {
		const absolutePath = resolveDocPath(record);
		if (!absolutePath) {
			continue;
		}
		try {
			const content = fs.readFileSync(absolutePath, "utf8");
			docs.push({
				record,
				absolutePath,
				relativePath:
					record?.file?.relative_path ??
					record?.file?.display_path ??
					path.basename(absolutePath),
				content,
				lines: content.split(/\r?\n/),
			});
		} catch {
			// skip unreadable files
		}
	}
	return docs;
}

function hashMatch(docKey, codeKey, status, snippet) {
	return createHash("sha256")
		.update([docKey ?? "missing", codeKey ?? "unknown", status, snippet ?? ""].join("|"))
		.digest("hex");
}

function buildDocKey(relativePath, line, status, codeKey) {
	if (status === "missing") {
		return `missing:${codeKey}`;
	}
	return `${relativePath ?? "doc"}#L${line ?? 0}`;
}

function recordMatch(symbol, doc, match) {
	const docKey = buildDocKey(doc.relativePath, match.line, "found", symbol.symbol_id);
	const metadata = {
		status: "found",
		doc_path: doc.relativePath,
		absolute_path: doc.absolutePath,
		match_line: match.line,
		snippet: match.snippet,
		pattern: match.pattern,
		code_name: symbol.name,
	};
	return {
		code_key: symbol.symbol_id,
		code_name: symbol.name,
		doc_key: docKey,
		doc_path: doc.relativePath,
		match_line: match.line,
		snippet: match.snippet,
		status: "found",
		hash: hashMatch(docKey, symbol.symbol_id, "found", match.snippet),
		metadata,
	};
}

function recordMissing(symbol) {
	const docKey = buildDocKey(null, null, "missing", symbol.symbol_id);
	const metadata = {
		status: "missing",
		code_name: symbol.name,
		file_path: symbol.file_path,
	};
	return {
		code_key: symbol.symbol_id,
		code_name: symbol.name,
		doc_key: docKey,
		doc_path: null,
		match_line: null,
		snippet: null,
		status: "missing",
		hash: hashMatch(docKey, symbol.symbol_id, "missing", null),
		metadata,
	};
}

function generateDocMatches(symbols, documents) {
	const matches = [];
	for (const symbol of symbols) {
		const patterns = buildSearchPatterns(symbol.name);
		let found = null;
		for (const doc of documents) {
			const match = findMatchInDocument(doc, patterns);
			if (match) {
				found = recordMatch(symbol, doc, match);
				break;
			}
		}
		if (found) {
			console.log(
				JSON.stringify({
					event: "structure_doc_match_reported",
					symbol_id: symbol.symbol_id,
					status: "found",
					doc: found.doc_path,
					line: found.match_line,
				}),
			);
			matches.push(found);
		} else {
			console.log(
				JSON.stringify({
					event: "structure_doc_match_reported",
					symbol_id: symbol.symbol_id,
					status: "missing",
				}),
			);
			matches.push(recordMissing(symbol));
		}
	}
	return matches;
}

function writeDocMatches(dbPath, taskId, matches) {
	if (!dbPath || !taskId || matches.length === 0) {
		return;
	}
	const now = new Date().toISOString();
	const statements = [
		"BEGIN",
		`DELETE FROM doc_matches WHERE run_id=${escapeSqlValue(taskId)}`,
	];
	for (const match of matches) {
		statements.push(
			`INSERT INTO doc_matches (run_id, doc_key, code_key, match_kind, confidence, metadata, hash, created_at, updated_at)
VALUES (${escapeSqlValue(taskId)}, ${escapeSqlValue(match.doc_key)}, ${escapeSqlValue(match.code_key)}, 'doc-search', ${
				match.status === "found" ? 1 : 0
			}, ${escapeSqlValue(JSON.stringify(match.metadata))}, ${escapeSqlValue(match.hash)}, ${escapeSqlValue(now)}, ${escapeSqlValue(now)})`,
		);
	}
	statements.push("COMMIT");
	runSqlite(dbPath, statements);
}

function buildDocMatchesReport(matches, reportsDir) {
	const totals = {
		exports_total: matches.length,
		export_documented: matches.filter((item) => item.status === "found").length,
		export_undocumented: matches.filter((item) => item.status === "missing").length,
	};
	const generatedAt = new Date().toISOString();
	const report = {
		generated_at: generatedAt,
		metrics: totals,
		matches: matches.map((match) => ({
			code_key: match.code_key,
			code_name: match.code_name,
			doc_key: match.doc_key,
			doc_path: match.doc_path,
			status: match.status,
			line: match.match_line,
			snippet: match.snippet,
		})),
	};
	const jsonPath = path.join(reportsDir, "doc-matches.json");
	const mdPath = path.join(reportsDir, "doc-matches.md");
	fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
	const lines = [
		"# Documentation Coverage",
		"",
		`Generated: ${generatedAt}`,
		"",
		"## Totals",
		"",
		`- Exported entities: ${totals.exports_total}`,
		`- Documented exports: ${totals.export_documented}`,
		`- Undocumented exports: ${totals.export_undocumented}`,
		"",
		"## Missing exports",
		"",
		"| Symbol | Source file |",
		"|--------|-------------|",
	];
	const missing = report.matches.filter((match) => match.status === "missing");
	if (missing.length === 0) {
		lines.push("| (none) | - |");
	} else {
		for (const entry of missing) {
			lines.push(`| ${entry.code_name} | ${entry.doc_path ?? "(not documented)"} |`);
		}
	}
	fs.writeFileSync(mdPath, `${lines.join("\n")}\n`);
	return {
		metrics: totals,
		jsonPath,
		mdPath,
	};
}

export function synchronizeDocMatches({ dbPath, taskId, analysisDir, reportsDir }) {
	const docRecords = readDocRecords(analysisDir);
	const symbols = loadExportedSymbols(dbPath, taskId);
	if (!docRecords.length || !symbols.length) {
		const reportInfo = buildDocMatchesReport([], reportsDir);
		return {
			matches: [],
			metrics: reportInfo?.metrics ?? {
				exports_total: symbols.length,
				export_documented: 0,
				export_undocumented: symbols.length,
			},
			report: reportInfo,
		};
	}
	const documents = loadDocumentContents(docRecords);
	const matches = generateDocMatches(symbols, documents);
	writeDocMatches(dbPath, taskId, matches);
	const reportInfo = buildDocMatchesReport(matches, reportsDir);
	return {
		matches,
		metrics: reportInfo?.metrics ?? {
			exports_total: matches.length,
			export_documented: matches.filter((item) => item.status === "found").length,
			export_undocumented: matches.filter((item) => item.status === "missing").length,
		},
		report: reportInfo,
	};
}
