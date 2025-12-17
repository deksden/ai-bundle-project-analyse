import fs from "node:fs";

function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatScalar(value) {
	if (value === null) return "null";
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return JSON.stringify(value);
}

function writeKeyValue(lines, key, value, indent) {
	const pad = "  ".repeat(indent);

	if (Array.isArray(value)) {
		if (value.length === 0) {
			lines.push(`${pad}${key}: []`);
			return;
		}

		lines.push(`${pad}${key}:`);
		for (const item of value) {
			const itemPad = "  ".repeat(indent + 1);
			if (isPlainObject(item) || Array.isArray(item)) {
				lines.push(`${itemPad}-`);
				writeValue(lines, item, indent + 2);
			} else {
				lines.push(`${itemPad}- ${formatScalar(item)}`);
			}
		}
		return;
	}

	if (isPlainObject(value)) {
		const entries = Object.entries(value);
		if (entries.length === 0) {
			lines.push(`${pad}${key}: {}`);
			return;
		}
		lines.push(`${pad}${key}:`);
		for (const [childKey, childValue] of entries) {
			writeKeyValue(lines, childKey, childValue, indent + 1);
		}
		return;
	}

	lines.push(`${pad}${key}: ${formatScalar(value)}`);
}

function writeValue(lines, value, indent) {
	const pad = "  ".repeat(indent);

	if (Array.isArray(value)) {
		if (value.length === 0) {
			lines.push(`${pad}[]`);
			return;
		}
		for (const item of value) {
			if (isPlainObject(item) || Array.isArray(item)) {
				lines.push(`${pad}-`);
				writeValue(lines, item, indent + 1);
			} else {
				lines.push(`${pad}- ${formatScalar(item)}`);
			}
		}
		return;
	}

	if (isPlainObject(value)) {
		const entries = Object.entries(value);
		if (entries.length === 0) {
			lines.push(`${pad}{}`);
			return;
		}
		for (const [childKey, childValue] of entries) {
			writeKeyValue(lines, childKey, childValue, indent);
		}
		return;
	}

	lines.push(`${pad}${formatScalar(value)}`);
}

export function toYAML(data) {
	const lines = [];
	for (const [key, value] of Object.entries(data)) {
		writeKeyValue(lines, key, value, 0);
	}
	return `${lines.join("\n")}\n`;
}

export function writeYAML(filePath, data) {
	fs.writeFileSync(filePath, toYAML(data));
}
