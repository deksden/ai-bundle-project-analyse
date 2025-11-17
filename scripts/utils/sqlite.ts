import { spawnSync } from "node:child_process";

export function escapeSqlValue(value: unknown): string {
	if (value == null) return "NULL";
	if (typeof value === "number") {
		return Number.isFinite(value) ? String(value) : "NULL";
	}
	if (typeof value === "boolean") {
		return value ? "1" : "0";
	}
	return `'${String(value).replace(/'/g, "''")}'`;
}

export function runSql(dbPath: string, statements: string[]): void {
	const payload =
		statements
			.filter(Boolean)
			.map((stmt) => stmt.trim())
			.join(";\n") + ";\n";

	const result = spawnSync("sqlite3", [dbPath], { input: payload, encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(result.stderr || "sqlite3 command failed");
	}
}

export function queryJson<T = unknown>(dbPath: string, sql: string): T[] {
	const result = spawnSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(result.stderr || "sqlite3 query failed");
	}
	const trimmed = result.stdout.trim();
	return trimmed.length ? (JSON.parse(trimmed) as T[]) : [];
}
