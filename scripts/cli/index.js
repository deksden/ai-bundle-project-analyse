import fs from "node:fs";
import path from "node:path";

function formatRecord(entry) {
	const name = entry?.file?.display_path ?? entry?.file?.relative_path ?? "unknown";
	const entities = entry?.metrics?.total_entities ?? 0;
	const documented = entry?.metrics?.documented_entities ?? 0;
	const language = entry?.file?.language ?? "n/a";
	return `${name} — ${entities} entities (${documented} documented) [${language}]`;
}

export function registerStructureCommands(yargsInstance) {
	return yargsInstance.command(
		"code-process [file]",
		"Inspect aggregated code-process.json records",
		(yargs) =>
			yargs
				.positional("file", {
					type: "string",
					default: "analysis/code-process.json",
					describe: "Path to aggregated code-process.json",
				})
				.option("limit", {
					type: "number",
					default: 10,
					describe: "Number of files to display",
				})
				.option("language", {
					type: "string",
					describe: "Filter by language identifier (ts, py, go, ...)",
				}),
		async (argv) => {
			const targetPath = path.resolve(argv.file);
			if (!fs.existsSync(targetPath)) {
				throw new Error(`code-process file not found: ${targetPath}`);
			}
			const raw = JSON.parse(fs.readFileSync(targetPath, "utf8"));
			if (!Array.isArray(raw)) {
				throw new Error("code-process.json must contain an array of records");
			}
			const filtered = argv.language
				? raw.filter(
						(entry) =>
							entry?.file?.language &&
							entry.file.language.toLowerCase() === argv.language.toLowerCase(),
					)
				: raw;

			const totalEntities = filtered.reduce(
				(acc, entry) => acc + Number(entry?.metrics?.total_entities ?? 0),
				0,
			);
			const documented = filtered.reduce(
				(acc, entry) => acc + Number(entry?.metrics?.documented_entities ?? 0),
				0,
			);

			console.log(`Records: ${filtered.length}`);
			console.log(`Total entities: ${totalEntities}`);
			console.log(`Documented entities: ${documented}`);

			const top = filtered
				.slice()
				.sort(
					(a, b) =>
						Number(b?.metrics?.total_entities ?? 0) -
						Number(a?.metrics?.total_entities ?? 0),
				)
				.slice(0, Math.max(1, Number(argv.limit) || 10));

			if (top.length > 0) {
				console.log("\nTop files:");
				for (const record of top) {
					console.log(`- ${formatRecord(record)}`);
				}
			}
		},
	);
}
