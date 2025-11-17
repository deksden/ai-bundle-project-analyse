import fs from "node:fs";
import path from "node:path";

function readJsonFile(filePath) {
	const content = fs.readFileSync(filePath, "utf8");
	return JSON.parse(content);
}

function ensureRecord(value) {
	return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function setNested(target, segments, value) {
	let cursor = target;
	for (let index = 0; index < segments.length; index++) {
		const segment = segments[index];
		if (index === segments.length - 1) {
			cursor[segment] = value;
			return;
		}
		if (!cursor[segment] || typeof cursor[segment] !== "object") {
			cursor[segment] = {};
		}
		cursor = cursor[segment];
	}
}

export function loadStageContext(stepRoot = process.cwd()) {
	const contextPath = path.join(stepRoot, "_context.json");
	if (!fs.existsSync(contextPath)) {
		throw new Error(`Stage context file not found: ${contextPath}`);
	}
	return readJsonFile(contextPath);
}

export function loadStageEnv(stepRoot = process.cwd()) {
	const envPath = path.join(stepRoot, "_env.json");
	if (!fs.existsSync(envPath)) {
		return {};
	}
	return readJsonFile(envPath);
}

export function getInputValue(context, key) {
	const data = ensureRecord(context?.inputs?.data);
	const tree = ensureRecord(context?.inputs?.tree);
	const candidates = [
		key,
		`input.${key}`,
		`inputs.${key}`,
		`context.${key}`,
		`context.start.${key}`,
	];
	for (const candidate of candidates) {
		if (Object.prototype.hasOwnProperty.call(data, candidate)) {
			return data[candidate];
		}
		const fromTree = resolveFromTree(tree, candidate);
		if (fromTree !== undefined) {
			return fromTree;
		}
	}
	return undefined;
}

export function getInputObject(context, key) {
	const data = ensureRecord(context?.inputs?.data);
	const tree = ensureRecord(context?.inputs?.tree);
	const direct = getInputValue(context, key);
	if (direct && typeof direct === "object") {
		return direct;
	}

	const prefixes = [key, `input.${key}`, `inputs.${key}`];
	const result = {};
	for (const [dataKey, value] of Object.entries(data)) {
		for (const prefix of prefixes) {
			const prefixWithDot = `${prefix}.`;
			if (dataKey.startsWith(prefixWithDot)) {
				const pathSegments = dataKey.slice(prefixWithDot.length).split(".");
				setNested(result, pathSegments, value);
				break;
			}
		}
	}
	for (const prefix of prefixes) {
		const fromTree = resolveFromTree(tree, prefix);
		if (fromTree && typeof fromTree === "object") {
			return fromTree;
		}
	}
	return Object.keys(result).length > 0 ? result : undefined;
}

export function requireEnvVariable(name, envData = {}) {
	const value = process.env[name] ?? envData[name];
	if (typeof value === "string" && value.length > 0) {
		return value;
	}
	throw new Error(`Environment variable ${name} is required for this stage`);
}

export function resolvePathRelativeToProject(projectRoot, candidatePath) {
	const absolute = path.resolve(candidatePath);
	const normalizedProject = path.resolve(projectRoot);
	if (!absolute.startsWith(`${normalizedProject}${path.sep}`) && absolute !== normalizedProject) {
		return {
			ok: false,
			absolute,
			reason: "outside_project",
		};
	}
	const relative = path.relative(normalizedProject, absolute).replace(/\\/g, "/");
	return {
		ok: true,
		absolute,
		relative: relative || ".",
	};
}

export function findInputBySuffix(context, suffixes) {
	const data = ensureRecord(context?.inputs?.data);
	const tree = ensureRecord(context?.inputs?.tree);
	const suffixList = Array.isArray(suffixes) ? suffixes : [suffixes];
	for (const [key, value] of Object.entries(data)) {
		for (const suffix of suffixList) {
			if (typeof suffix === "string" && key.endsWith(suffix)) {
				return value;
			}
		}
	}
	for (const suffix of suffixList) {
		const resolved = findInTreeBySuffix(tree, suffix);
		if (resolved !== undefined) {
			return resolved;
		}
	}
	return undefined;
}

export function resolveBundleRoot(stepRoot = process.cwd(), envData = {}, namespace = "research-structure") {
	const explicit = process.env.BUNDLE_ROOT ?? envData.BUNDLE_ROOT;
	if (typeof explicit === "string" && explicit.length > 0) {
		return explicit;
	}
	const globalDir = path.resolve(stepRoot, "global");
	return path.join(globalDir, "bundle", namespace);
}

function resolveFromTree(tree, candidate) {
	if (!tree || typeof tree !== "object") {
		return undefined;
	}
	const normalized = normalizeTreePath(candidate);
	if (!normalized) {
		return undefined;
	}
	const segments = normalized.split(".").filter(Boolean);
	let cursor = tree;
	for (const segment of segments) {
		if (!cursor || typeof cursor !== "object") {
			return undefined;
		}
		if (!(segment in cursor)) {
			return undefined;
		}
		cursor = cursor[segment];
	}
	return cursor;
}

function normalizeTreePath(raw) {
	if (typeof raw !== "string" || raw.length === 0) {
		return "";
	}
	return raw.replace(/^(input|inputs|context)\./, "");
}

function findInTreeBySuffix(tree, suffix) {
	if (!tree || typeof tree !== "object" || typeof suffix !== "string" || suffix.length === 0) {
		return undefined;
	}
	const stack = [{ path: "", node: tree }];
	while (stack.length > 0) {
		const { path: currentPath, node } = stack.pop();
		if (!node || typeof node !== "object") {
			continue;
		}
		for (const [key, value] of Object.entries(node)) {
			const nextPath = currentPath ? `${currentPath}.${key}` : key;
			if (nextPath.endsWith(suffix)) {
				return value;
			}
			if (value && typeof value === "object") {
				stack.push({ path: nextPath, node: value });
			}
		}
	}
	return undefined;
}
