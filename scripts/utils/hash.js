import crypto from "node:crypto";

const PRIME64_1 = 11400714785074694791n;
const PRIME64_2 = 14029467366897019727n;
const PRIME64_3 = 1609587929392839161n;
const PRIME64_4 = 9650029242287828579n;
const PRIME64_5 = 2870177450012600261n;

function rotl(value, bits) {
	const shift = BigInt(bits);
	return ((value << shift) | (value >> (64n - shift))) & 0xffffffffffffffffn;
}

function round64(acc, input) {
	acc += input * PRIME64_2;
	acc = rotl(acc, 31n);
	acc *= PRIME64_1;
	return acc & 0xffffffffffffffffn;
}

function mergeRound(hash, value) {
	let merged = hash ^ round64(0n, value);
	merged = (merged * PRIME64_1 + PRIME64_4) & 0xffffffffffffffffn;
	return merged;
}

function finalize(hash) {
	hash ^= hash >> 33n;
	hash = (hash * PRIME64_2) & 0xffffffffffffffffn;
	hash ^= hash >> 29n;
	hash = (hash * PRIME64_3) & 0xffffffffffffffffn;
	hash ^= hash >> 32n;
	return hash & 0xffffffffffffffffn;
}

export function xxhash64(input, seed = 0n) {
	const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
	const length = buffer.length;
	let offset = 0;
	let hash;
	const bigSeed = BigInt(seed) & 0xffffffffffffffffn;

	if (length >= 32) {
		let v1 = (bigSeed + PRIME64_1 + PRIME64_2) & 0xffffffffffffffffn;
		let v2 = (bigSeed + PRIME64_2) & 0xffffffffffffffffn;
		let v3 = bigSeed;
		let v4 = (bigSeed - PRIME64_1) & 0xffffffffffffffffn;

		while (offset <= length - 32) {
			v1 = round64(v1, buffer.readBigUInt64LE(offset));
			v2 = round64(v2, buffer.readBigUInt64LE(offset + 8));
			v3 = round64(v3, buffer.readBigUInt64LE(offset + 16));
			v4 = round64(v4, buffer.readBigUInt64LE(offset + 24));
			offset += 32;
		}

		hash =
			(rotl(v1, 1n) +
				rotl(v2, 7n) +
				rotl(v3, 12n) +
				rotl(v4, 18n)) &
			0xffffffffffffffffn;
		hash = mergeRound(hash, v1);
		hash = mergeRound(hash, v2);
		hash = mergeRound(hash, v3);
		hash = mergeRound(hash, v4);
	} else {
		hash = (bigSeed + PRIME64_5) & 0xffffffffffffffffn;
	}

	hash = (hash + BigInt(length)) & 0xffffffffffffffffn;

	while (offset + 8 <= length) {
		let k1 = buffer.readBigUInt64LE(offset);
		k1 = (k1 * PRIME64_2) & 0xffffffffffffffffn;
		k1 = rotl(k1, 31n);
		k1 = (k1 * PRIME64_1) & 0xffffffffffffffffn;
		hash ^= k1;
		hash = (rotl(hash, 27n) * PRIME64_1 + PRIME64_4) & 0xffffffffffffffffn;
		offset += 8;
	}

	if (offset + 4 <= length) {
		let k1 = BigInt(buffer.readUInt32LE(offset));
		k1 = (k1 * PRIME64_1) & 0xffffffffffffffffn;
		k1 = rotl(k1, 23n);
		k1 = (k1 * PRIME64_2) & 0xffffffffffffffffn;
		hash ^= k1;
		hash = (rotl(hash, 27n) * PRIME64_1 + PRIME64_4) & 0xffffffffffffffffn;
		offset += 4;
	}

	while (offset < length) {
		const value = BigInt(buffer[offset]);
		hash ^= (value * PRIME64_5) & 0xffffffffffffffffn;
		hash = (rotl(hash, 11n) * PRIME64_1) & 0xffffffffffffffffn;
		offset += 1;
	}

	const finalized = finalize(hash);
	return finalized.toString(16).padStart(16, "0");
}

export function sha256Hex(input) {
	const hash = crypto.createHash("sha256");
	hash.update(input);
	return hash.digest("hex");
}
