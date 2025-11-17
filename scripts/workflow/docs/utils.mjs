import path from "node:path";

import { xxhash64 } from "../../utils/hash.js";

function sanitizePathSegment(value) {
	if (!value) {
		return "unknown";
	}
	return value
		.toString()
		.trim()
		.toLowerCase()
		.replace(/[^\w\d\-./]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export function detectDocFormat(extension) {
	const ext = typeof extension === "string" ? extension.toLowerCase() : "";
	const formatMap = {
		".md": "markdown",
		".mdx": "markdown",
		".rst": "restructuredtext",
		".txt": "plain_text",
		".adoc": "asciidoc",
		".asciidoc": "asciidoc",
		".org": "org",
		".html": "html",
	};
	return formatMap[ext] ?? "plain_text";
}

export function detectDocLanguage(content, fallback = "en") {
	if (typeof content !== "string" || content.length === 0) {
		return fallback;
	}
	const sample = content.slice(0, 4000).toLowerCase();
	if (/[а-яё]/.test(sample)) {
		return "ru";
	}
	if (/[äöüß]/.test(sample)) {
		return "de";
	}
	if (/[áéíóúñ]/.test(sample)) {
		return "es";
	}
	if (/[éèêàçùôâî]/.test(sample)) {
		return "fr";
	}
	if (/[\u4e00-\u9fff]/.test(sample)) {
		return "zh";
	}
	return fallback;
}

export function slugifyHeading(input, fallback = "section") {
	if (typeof input !== "string" || input.trim().length === 0) {
		return fallback;
	}
	return input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		|| fallback;
}

export function ensureDocId({ documentPath, relativePath, heading, anchor, index = 0 }) {
	const base = sanitizePathSegment(relativePath ?? documentPath);
	const slug = sanitizePathSegment(anchor ?? slugifyHeading(heading, `section-${index + 1}`));
	return `${base}#${slug}`;
}

export function computeContentHashFromText(text) {
	const buffer = typeof text === "string" ? Buffer.from(text) : Buffer.from([]);
	return xxhash64(buffer);
}

export function normalizeMentions(rawMentions) {
	if (!Array.isArray(rawMentions)) {
		return [];
	}
	return rawMentions
		.map((entry) => {
			if (!entry || typeof entry !== "object") return null;
			const type = typeof entry.type === "string" ? entry.type : "note";
			const value =
				typeof entry.value === "string"
					? entry.value
					: typeof entry.command === "string"
						? entry.command
						: null;
			const description =
				typeof entry.description === "string"
					? entry.description
					: typeof entry.text === "string"
						? entry.text
						: null;
			if (!value && !description) {
				return null;
			}
			return {
				type,
				value,
				description,
				source: entry.source ?? entry.origin ?? null,
			};
		})
		.filter(Boolean);
}

export function buildRelationshipId(baseId, suffix) {
	const safeSuffix = sanitizePathSegment(suffix ?? "");
	const normalizedSuffix = safeSuffix.length > 0 ? safeSuffix : "rel";
	return `${baseId}:${normalizedSuffix}`;
}

export function deriveDocumentSummary(docItem, docEntities) {
	const firstHeading =
		(docEntities?.length ?? 0) > 0 ? docEntities[0].heading : path.basename(docItem?.display_path ?? "document");
	return {
		title: docItem?.display_path ?? firstHeading ?? "Document",
		summary: docEntities?.map((entity) => entity.summary).filter(Boolean).slice(0, 2).join(" ") || null,
	};
}
