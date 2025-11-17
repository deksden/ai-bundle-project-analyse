export function createDocExtractionOptions(overrides = {}) {
	return {
		mode: "agent",
		maxSectionsPerFile: 8,
		includeMentions: true,
		...overrides,
	};
}

export function describeDocTargets(files = []) {
	return {
		totalFiles: files.length,
		files,
		diagnostics: ["docs/index.js scaffolding placeholder (protocol-0105/02)"],
	};
}
