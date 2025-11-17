import fs from "node:fs";
import path from "node:path";

import { parseJsdocBlock } from "./jsdoc-parser.js";

const SUPPORTED_LANGUAGES = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go"];
const LANGUAGE_BY_EXTENSION = new Map([
	[".ts", "ts"],
	[".tsx", "tsx"],
	[".js", "js"],
	[".jsx", "jsx"],
	[".mjs", "mjs"],
	[".cjs", "cjs"],
	[".py", "py"],
	[".go", "go"],
]);

function normalizeLanguage(candidate) {
	if (typeof candidate !== "string") {
		return undefined;
	}
	const normalized = candidate.toLowerCase();
	if (SUPPORTED_LANGUAGES.includes(normalized)) {
		return normalized;
	}
	return undefined;
}

export function detectLanguage(filePath, explicitLanguage) {
	const normalizedExplicit = normalizeLanguage(explicitLanguage);
	if (normalizedExplicit) {
		return normalizedExplicit;
	}
	const ext = path.extname(filePath).toLowerCase();
	return LANGUAGE_BY_EXTENSION.get(ext);
}

function createLineLookup(text) {
	const offsets = [0];
	for (let index = 0; index < text.length; index++) {
		if (text[index] === "\n") {
			offsets.push(index + 1);
		}
	}
	return (position) => {
		const clamped = Math.max(0, Math.min(position, text.length));
		let low = 0;
		let high = offsets.length - 1;
		while (low <= high) {
			const mid = Math.floor((low + high) / 2);
			const start = offsets[mid];
			const end = mid + 1 < offsets.length ? offsets[mid + 1] : text.length + 1;
			if (clamped >= start && clamped < end) {
				return { line: mid, column: clamped - start };
			}
			if (clamped < start) {
				high = mid - 1;
			} else {
				low = mid + 1;
			}
		}
		return { line: offsets.length - 1, column: 0 };
	};
}

function extractLeadingBlockComment(text, startOffset) {
	const prefix = text.slice(0, startOffset);
	const commentMatch = /\/\*\*[\s\S]*?\*\/\s*$/m.exec(prefix);
	return commentMatch ? commentMatch[0] : null;
}

function findMatchingBrace(text, openIndex) {
	let depth = 0;
	let inString = null;
	let escaped = false;
	let inSingleLineComment = false;
	let inMultiLineComment = false;
	for (let index = openIndex; index < text.length; index++) {
		const char = text[index];
		const next = text[index + 1];

		if (inSingleLineComment) {
			if (char === "\n") {
				inSingleLineComment = false;
			}
			continue;
		}
		if (inMultiLineComment) {
			if (char === "*" && next === "/") {
				inMultiLineComment = false;
				index += 1;
			}
			continue;
		}
		if (inString) {
			if (escaped) {
				escaped = false;
				continue;
			}
			if (char === "\\") {
				escaped = true;
				continue;
			}
			if (char === inString) {
				inString = null;
			}
			continue;
		}

		if (char === "/" && next === "/") {
			inSingleLineComment = true;
			index += 1;
			continue;
		}

		if (char === "/" && next === "*") {
			inMultiLineComment = true;
			index += 1;
			continue;
		}

		if (char === "'" || char === '"' || char === "`") {
			inString = char;
			continue;
		}

		if (char === "{") {
			depth += 1;
			continue;
		}

		if (char === "}") {
			depth -= 1;
			if (depth === 0) {
				return index;
			}
			continue;
		}
	}
	return -1;
}

function buildLocation(lineLookup, startOffset, endOffset) {
	const start = lineLookup(startOffset);
	const end = lineLookup(endOffset);
	return {
		start: { offset: startOffset, line: start.line, column: start.column },
		end: { offset: endOffset, line: end.line, column: end.column },
	};
}

function deriveSignature(text, startOffset, endOffset) {
	const headerEnd = text.indexOf("{", startOffset);
	if (headerEnd !== -1 && headerEnd < endOffset) {
		return text.slice(startOffset, headerEnd).trim();
	}
	const newlineIndex = text.indexOf("\n", startOffset);
	if (newlineIndex !== -1 && newlineIndex < endOffset) {
		return text.slice(startOffset, newlineIndex).trim();
	}
	return text.slice(startOffset, Math.min(startOffset + 140, endOffset)).trim();
}

function findStructureEnd(text, bodyStart) {
	if (bodyStart < 0 || bodyStart >= text.length) {
		return text.length;
	}
	const braceIndex = text.indexOf("{", bodyStart);
	if (braceIndex === -1) {
		const semicolon = text.indexOf(";", bodyStart);
		const newline = text.indexOf("\n", bodyStart);
		const candidates = [semicolon, newline].filter((value) => value !== -1);
		return candidates.length > 0 ? Math.min(...candidates) : text.length;
	}
	const closing = findMatchingBrace(text, braceIndex);
	return closing === -1 ? text.length : closing + 1;
}

function pushJsEntity({
	entities,
	name,
	kind,
	category,
	exported,
	isAsync,
	startOffset,
	endOffset,
	lineLookup,
	signature,
	snippet,
	docBlock,
	languageId,
}) {
	entities.push({
		name: name ?? "(anonymous)",
		kind,
		category,
		exported,
		async: Boolean(isAsync),
		language: languageId,
		location: buildLocation(lineLookup, startOffset, endOffset),
		signature,
		snippet,
		doc: docBlock ? parseJsdocBlock(docBlock) : null,
	});
}

function parseJsLikeSource(filePath, languageId, sourceText, includeJsdoc = true) {
	const entities = [];
	const diagnostics = [];
	const imports = [];
	const lineLookup = createLineLookup(sourceText);

	const classRegex = /(?:^|[^\w$])(export\s+)?(default\s+)?(abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm;
	for (const match of sourceText.matchAll(classRegex)) {
		const matchText = match[0];
		const keywordIndex = matchText.lastIndexOf("class");
		const startOffset = match.index + keywordIndex;
		const braceIndex = sourceText.indexOf("{", startOffset);
		let endOffset = braceIndex !== -1 ? findStructureEnd(sourceText, braceIndex) : startOffset + matchText.length;
		if (endOffset === -1) {
			endOffset = startOffset + matchText.length;
		}
		const signature = deriveSignature(sourceText, startOffset, endOffset);
		const docBlock = includeJsdoc ? extractLeadingBlockComment(sourceText, startOffset) : null;
		const snippet = sourceText.slice(startOffset, endOffset);
		pushJsEntity({
			entities,
			name: match[4],
			kind: "class",
			category: "language_class",
			exported: Boolean(match[1]),
			isAsync: false,
			startOffset,
			endOffset,
			lineLookup,
			signature,
			snippet,
			docBlock,
			languageId,
		});
	}

	const funcRegex = /(?:^|[^\w$])(export\s+)?(async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
	for (const match of sourceText.matchAll(funcRegex)) {
		const keywordIndex = match[0].lastIndexOf("function");
		const startOffset = match.index + keywordIndex;
		const bodyStart = sourceText.indexOf("{", startOffset);
		let endOffset = bodyStart !== -1 ? findStructureEnd(sourceText, bodyStart) : startOffset + match[0].length;
		if (endOffset === -1) {
			endOffset = startOffset + match[0].length;
		}
		const signature = deriveSignature(sourceText, startOffset, endOffset);
		const docBlock = includeJsdoc ? extractLeadingBlockComment(sourceText, startOffset) : null;
		const snippet = sourceText.slice(startOffset, endOffset);
		pushJsEntity({
			entities,
			name: match[3],
			kind: "function",
			category: "language_function",
			exported: Boolean(match[1]),
			isAsync: Boolean(match[2]),
			startOffset,
			endOffset,
			lineLookup,
			signature,
			snippet,
			docBlock,
			languageId,
		});
	}

	const arrowRegex = /(?:^|[^\w$])(export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(async\s+)?(?:function\s*)?\(/gm;
	for (const match of sourceText.matchAll(arrowRegex)) {
		const keywordIndex = match[0].lastIndexOf("const");
		const startOffset = match.index + keywordIndex;
		const braceIndex = sourceText.indexOf("{", startOffset);
		let endOffset = braceIndex !== -1 ? findStructureEnd(sourceText, braceIndex) : findStructureEnd(sourceText, startOffset);
		if (endOffset === -1) {
			endOffset = startOffset + match[0].length;
		}
		const docBlock = includeJsdoc ? extractLeadingBlockComment(sourceText, startOffset) : null;
		const signature = deriveSignature(sourceText, startOffset, endOffset);
		const snippet = sourceText.slice(startOffset, endOffset);
		pushJsEntity({
			entities,
			name: match[2],
			kind: "arrow_function",
			category: "language_function",
			exported: Boolean(match[1]),
			isAsync: Boolean(match[3]),
			startOffset,
			endOffset,
			lineLookup,
			signature,
			snippet,
			docBlock,
			languageId,
		});
	}

	const interfaceRegex = /(?:^|[^\w$])(export\s+)?interface\s+([A-Za-z_$][\w$]*)/gm;
	for (const match of sourceText.matchAll(interfaceRegex)) {
		const keywordIndex = match[0].lastIndexOf("interface");
		const startOffset = match.index + keywordIndex;
		const braceIndex = sourceText.indexOf("{", startOffset);
		const endOffset = braceIndex !== -1 ? findStructureEnd(sourceText, braceIndex) : startOffset + match[0].length;
		const docBlock = includeJsdoc ? extractLeadingBlockComment(sourceText, startOffset) : null;
		const signature = deriveSignature(sourceText, startOffset, endOffset);
		pushJsEntity({
			entities,
			name: match[2],
			kind: "interface",
			category: "language_interface",
			exported: Boolean(match[1]),
			isAsync: false,
			startOffset,
			endOffset,
			lineLookup,
			signature,
			snippet: sourceText.slice(startOffset, endOffset),
			docBlock,
			languageId,
		});
	}

	const typeRegex = /(?:^|[^\w$])(export\s+)?type\s+([A-Za-z_$][\w$]*)/gm;
	for (const match of sourceText.matchAll(typeRegex)) {
		const keywordIndex = match[0].lastIndexOf("type");
		const startOffset = match.index + keywordIndex;
		const newline = sourceText.indexOf("\n", startOffset);
		const endOffset = newline !== -1 ? newline : startOffset + match[0].length;
		const docBlock = includeJsdoc ? extractLeadingBlockComment(sourceText, startOffset) : null;
		pushJsEntity({
			entities,
			name: match[2],
			kind: "type",
			category: "language_interface",
			exported: Boolean(match[1]),
			isAsync: false,
			startOffset,
			endOffset,
			lineLookup,
			signature: sourceText.slice(startOffset, endOffset).trim(),
			snippet: sourceText.slice(startOffset, endOffset),
			docBlock,
			languageId,
		});
	}

	const importRegex = /import\s+([\s\S]+?)\s+from\s+["'`]([^"'`]+)["'`]/gm;
	for (const match of sourceText.matchAll(importRegex)) {
		const specifiers = match[1]
			.replace(/\bas\b/g, "as")
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);
		imports.push({
			module: match[2],
			specifiers,
			kind: "import",
		});
	}

	const requireRegex = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(["'`]([^"'`]+)["'`]\)/gm;
	for (const match of sourceText.matchAll(requireRegex)) {
		imports.push({
			module: match[2],
			specifiers: [match[1]],
			kind: "require",
		});
	}

	if (entities.length === 0) {
		diagnostics.push({
			message: "No symbols detected in file",
			file: filePath,
		});
	}

	return { entities, diagnostics, imports };
}

function extractPythonDocstring(blockText) {
	const docMatch = /^\s*(?:(?:"""([\s\S]*?)""")|(?:'''([\s\S]*?)'''))/.exec(blockText);
	if (!docMatch) {
		return null;
	}
	return docMatch[1] ?? docMatch[2];
}

function parsePythonSource(filePath, languageId, sourceText) {
	const entities = [];
	const imports = [];
	const diagnostics = [];
	const lineLookup = createLineLookup(sourceText);
	const definitionRegex = /^[ \t]*(class|def)\s+([A-Za-z_][\w]*)\s*(\([^)]*\))?/gm;

	for (const match of sourceText.matchAll(definitionRegex)) {
		const keywordLength = match[1].length;
		const startOffset = match.index + match[0].indexOf(match[1]);

		const headerEnd = sourceText.indexOf("\n", startOffset);
		let blockStart = headerEnd === -1 ? sourceText.length : headerEnd + 1;

		const indentMatch = /^\s*/.exec(match[0]);
		const indentLevel = indentMatch ? indentMatch[0].length : 0;
		let cursor = blockStart;
		let endOffset = sourceText.length;
		let encounteredBody = false;

		while (cursor < sourceText.length) {
			const nextNewline = sourceText.indexOf("\n", cursor);
			const lineEnd = nextNewline === -1 ? sourceText.length : nextNewline;
			const lineText = sourceText.slice(cursor, lineEnd);
			const trimmed = lineText.trim();
			if (trimmed.length === 0) {
				cursor = lineEnd + 1;
				continue;
			}
			const currentIndent = lineText.length - lineText.trimStart().length;
			if (!encounteredBody && currentIndent <= indentLevel) {
				endOffset = lineEnd;
				break;
			}
			if (encounteredBody && currentIndent <= indentLevel) {
				endOffset = cursor;
				break;
			}
			encounteredBody = true;
			cursor = lineEnd + 1;
		}

		const blockText = sourceText.slice(blockStart, endOffset);
		const docBlock = extractPythonDocstring(blockText);
		const snippet = sourceText.slice(startOffset, endOffset);
		const signature = sourceText
			.slice(startOffset, blockStart)
			.replace(/\s+/g, " ")
			.trim();

		entities.push({
			name: match[2],
			kind: match[1] === "class" ? "class" : "function",
			category: match[1] === "class" ? "language_class" : "language_function",
			exported: match[1] === "class",
			async: false,
			language: languageId,
			location: buildLocation(lineLookup, startOffset, endOffset),
			signature,
			snippet,
			doc: docBlock
				? {
						raw: docBlock,
						description: docBlock.trim(),
						summary: docBlock.split(/\n/)[0].trim(),
						tags: [],
					}
				: null,
		});
	}

	const importRegex = /^[ \t]*from\s+([A-Za-z0-9_\.]+)\s+import\s+([A-Za-z0-9_,\s\*]+)/gm;
	for (const match of sourceText.matchAll(importRegex)) {
		const specifiers = match[2]
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean);
		imports.push({
			module: match[1],
			specifiers,
			kind: "import",
		});
	}

	const simpleImportRegex = /^[ \t]*import\s+([A-Za-z0-9_,\s\.]+)/gm;
	for (const match of sourceText.matchAll(simpleImportRegex)) {
		const modules = match[1]
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean);
		for (const moduleName of modules) {
			imports.push({
				module: moduleName,
				specifiers: [],
				kind: "import",
			});
		}
	}

	if (entities.length === 0) {
		diagnostics.push({
			message: "No Python definitions detected",
			file: filePath,
		});
	}

	return { entities, imports, diagnostics };
}

function extractGoDocComment(text, startOffset) {
	const prefix = text.slice(0, startOffset);
	const match = /(\/\/[^\n]*\n)+\s*$/.exec(prefix);
	return match ? match[0] : null;
}

function parseGoSource(filePath, languageId, sourceText) {
	const entities = [];
	const imports = [];
	const diagnostics = [];
	const lineLookup = createLineLookup(sourceText);

	const funcRegex = /(?:^|[\s])func\s+(\([^)]+\)\s*)?([A-Za-z_][\w]*)\s*\(/gm;
	for (const match of sourceText.matchAll(funcRegex)) {
		const keywordIndex = match[0].lastIndexOf("func");
		const startOffset = match.index + keywordIndex;
		const bodyStart = sourceText.indexOf("{", startOffset);
		const endOffset = bodyStart !== -1 ? findStructureEnd(sourceText, bodyStart) : startOffset + match[0].length;
		const signature = deriveSignature(sourceText, startOffset, endOffset);
		const docBlock = extractGoDocComment(sourceText, startOffset);
		entities.push({
			name: match[2],
			kind: "function",
			category: "language_function",
			exported: /^[A-Z]/.test(match[2]),
			async: false,
			language: languageId,
			location: buildLocation(lineLookup, startOffset, endOffset),
			signature,
			snippet: sourceText.slice(startOffset, endOffset),
			doc: docBlock
				? {
						raw: docBlock,
						description: docBlock
							.split("\n")
							.map((line) => line.replace(/^\/\//, "").trim())
							.join("\n")
							.trim(),
						summary: docBlock
							.split("\n")[0]
							.replace(/^\/\//, "")
							.trim(),
						tags: [],
					}
				: null,
		});
	}

	const singleImportRegex = /^[ \t]*import\s+["'`]([^"'`]+)["'`]/gm;
	for (const match of sourceText.matchAll(singleImportRegex)) {
		imports.push({
			module: match[1],
			specifiers: [],
			kind: "import",
		});
	}

	const blockImportRegex = /import\s*\(([\s\S]*?)\)/gm;
	for (const match of sourceText.matchAll(blockImportRegex)) {
		const inner = match[1];
		for (const line of inner.split("\n")) {
			const trimmed = line.trim().replace(/["'`]/g, "");
			if (trimmed) {
				imports.push({
					module: trimmed,
					specifiers: [],
					kind: "import",
				});
			}
		}
	}

	if (entities.length === 0) {
		diagnostics.push({
			message: "No Go functions detected",
			file: filePath,
		});
	}

	return { entities, imports, diagnostics };
}

export async function parseWithTreeSitter(filePath, languageId, options = {}) {
	const resolvedLanguage = detectLanguage(filePath, languageId);
	if (!resolvedLanguage) {
		throw new Error(`Unsupported language for file ${filePath}`);
	}
	const sourceText = fs.readFileSync(filePath, "utf8");
	let result;
	if (["ts", "tsx", "js", "jsx", "cjs", "mjs"].includes(resolvedLanguage)) {
		result = parseJsLikeSource(filePath, resolvedLanguage, sourceText, options.includeJsdoc !== false);
	} else if (resolvedLanguage === "py") {
		result = parsePythonSource(filePath, resolvedLanguage, sourceText);
	} else if (resolvedLanguage === "go") {
		result = parseGoSource(filePath, resolvedLanguage, sourceText);
	} else {
		throw new Error(`Language ${resolvedLanguage} is not supported`);
	}

	return {
		languageId: resolvedLanguage,
		filePath,
		entities: result.entities ?? [],
		imports: result.imports ?? [],
		relationships: (result.imports ?? []).map((entry) => ({
			type: "import",
			module: entry.module,
			specifiers: entry.specifiers,
		})),
		diagnostics: result.diagnostics ?? [],
	};
}
