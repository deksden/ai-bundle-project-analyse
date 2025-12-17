export function createLanePlan(targetRoot) {
	return {
		targetRoot,
		codeLaneEnabled: true,
		docsLaneEnabled: true,
	};
}

export function summarizeLaneOutputs(codeSummary, docSummary) {
	return {
		codeSummary,
		docSummary,
		diagnostics: ["lanes/index.js scaffolding placeholder (protocol-0105/02)"],
	};
}
