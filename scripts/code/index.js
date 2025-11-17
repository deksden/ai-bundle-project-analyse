const SUPPORTED_CODE_LANGUAGES = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go"];

const DEFAULT_OPTIONS = {
	languages: ["ts", "tsx", "js", "jsx", "py", "go"],
	includeJsdoc: true,
	hashAlgorithm: "xxh64",
	maxParallelFiles: 4,
};

function normalizeLanguages(languages) {
	if (!Array.isArray(languages)) return DEFAULT_OPTIONS.languages;
	const unique = new Set();
	for (const language of languages) {
		const normalized = typeof language === "string" ? language.toLowerCase() : "";
		if (SUPPORTED_CODE_LANGUAGES.includes(normalized)) {
			unique.add(normalized);
		}
	}
	return unique.size > 0 ? Array.from(unique) : DEFAULT_OPTIONS.languages;
}

export function createCodeExtractionOptions(overrides = {}) {
	return {
		languages: normalizeLanguages(overrides.languages ?? overrides.language_whitelist),
		includeJsdoc:
			overrides.includeJsdoc ?? overrides.include_jsdoc ?? DEFAULT_OPTIONS.includeJsdoc,
		hashAlgorithm:
			typeof overrides.hash_algorithm === "string"
				? overrides.hash_algorithm.toLowerCase()
				: DEFAULT_OPTIONS.hashAlgorithm,
		maxParallelFiles:
			typeof overrides.max_parallel_files === "number"
				? overrides.max_parallel_files
				: DEFAULT_OPTIONS.maxParallelFiles,
	};
}

export function describeCodeTargets(files = []) {
	const languageBreakdown = {};
	for (const file of files) {
		const language =
			typeof file.language === "string" && file.language.length > 0
				? file.language
				: "unknown";
		languageBreakdown[language] = (languageBreakdown[language] ?? 0) + 1;
	}
	return {
		totalFiles: files.length,
		files,
		breakdown: languageBreakdown,
	};
}

export { SUPPORTED_CODE_LANGUAGES };
