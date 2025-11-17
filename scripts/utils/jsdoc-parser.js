const TAG_PATTERN = /^@([\w-]+)(?:\s+([^\s]+))?\s*(.*)$/;

function sanitizeRawDoc(rawText) {
	if (typeof rawText !== "string" || rawText.length === 0) {
		return "";
	}

	return rawText
		.replace(/^\/\*\*?/, "")
		.replace(/\*\/$/, "")
		.split(/\r?\n/g)
		.map((line) => line.replace(/^\s*\*\s?/, "").trimEnd())
		.join("\n")
		.trim();
}

export function parseJsdocBlock(rawText) {
	const sanitized = sanitizeRawDoc(rawText);
	if (!sanitized) {
		return {
			description: "",
			summary: "",
			tags: [],
		};
	}

	const descriptionLines = [];
	const tags = [];
	let currentTag = null;

	for (const line of sanitized.split(/\r?\n/g)) {
		if (line.startsWith("@")) {
			if (currentTag) {
				currentTag.description = currentTag.description?.trim() ?? "";
				tags.push(currentTag);
			}

			const match = TAG_PATTERN.exec(line);
			if (match) {
				currentTag = {
					tag: match[1] ?? "",
					name: match[2] && !match[2].startsWith("{") ? match[2] : undefined,
					description: match[3] ?? "",
				};
			} else {
				currentTag = {
					tag: line.slice(1),
					description: "",
				};
			}
		} else if (currentTag) {
			currentTag.description = `${currentTag.description ?? ""}${currentTag.description ? "\n" : ""}${line}`;
		} else {
			descriptionLines.push(line);
		}
	}

	if (currentTag) {
		currentTag.description = currentTag.description?.trim() ?? "";
		tags.push(currentTag);
	}

	const description = descriptionLines.join("\n").trim();
	const summary = description.split(/\n{2,}/)[0]?.trim() ?? "";

	return {
		description,
		summary,
		tags: tags.map((tag) => ({
			tag: tag.tag,
			name: tag.name ?? null,
			description: (tag.description ?? "").trim(),
		})),
		raw: rawText ?? "",
	};
}
