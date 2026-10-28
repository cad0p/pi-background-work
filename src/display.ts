/*
 * Display registry: what a provider wants shown for its pending work. It lives
 * outside the v1 provider object, whose exact field set rejects unknown keys.
 */

import type { BackgroundWorkItem } from "./registry";

export const BACKGROUND_WORK_DISPLAY_KEY = "pi-background-work.display.v1";
const DISPLAY_PROTOCOL_VERSION = 1;
const DISPLAY_SLOT = Symbol.for(BACKGROUND_WORK_DISPLAY_KEY);
const MAX_DISPLAY_NAME_LENGTH = 128;
const MAX_DISPLAY_PROVIDERS = 100;
const DISPLAY_PROVIDER_FIELDS: readonly string[] = ["name", "describe"];

/** The context a display provider receives, in v1's shape. */
export interface DescribeContext {
	sessionId: string;
	sessionIds: readonly string[];
	nowMs: number;
}

export interface BackgroundWorkDisplayProvider {
	/** Matches the v1 provider `name` whose items this describes. */
	name: string;
	describe(items: readonly BackgroundWorkItem[], context: DescribeContext): string | null | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The process-wide display map. Every copy of this protocol in the process shares it. */
function registry(): Map<unknown, unknown> {
	const existing: unknown = Reflect.get(globalThis, DISPLAY_SLOT);
	if (existing === undefined) {
		const created = { version: DISPLAY_PROTOCOL_VERSION, providers: new Map<unknown, unknown>() };
		Reflect.set(globalThis, DISPLAY_SLOT, created);
		return created.providers;
	}
	if (!isRecord(existing)) {
		throw new Error(`Malformed background-work display registry at Symbol.for("${BACKGROUND_WORK_DISPLAY_KEY}").`);
	}
	if (existing.version !== DISPLAY_PROTOCOL_VERSION || !(existing.providers instanceof Map)) {
		throw new Error(`Unsupported background-work display registry at Symbol.for("${BACKGROUND_WORK_DISPLAY_KEY}").`);
	}
	return existing.providers;
}

function validateString(value: unknown, field: string, maxLength: number): string {
	if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
		throw new Error(`${field} must be a non-empty string without leading or trailing whitespace.`);
	}
	if (value.length > maxLength) throw new Error(`${field} must be at most ${maxLength} characters.`);
	if (value.includes("\0")) throw new Error(`${field} must not contain NUL characters.`);
	return value;
}

function validateDisplayProvider(value: unknown): asserts value is BackgroundWorkDisplayProvider {
	if (!isRecord(value)) throw new Error("Background-work display provider must be an object.");
	const unknownFields = Object.keys(value).filter((key) => !DISPLAY_PROVIDER_FIELDS.includes(key));
	if (unknownFields.length > 0) {
		throw new Error(`Background-work display provider has unknown fields: ${unknownFields.join(", ")}.`);
	}
	const name = validateString(value.name, "Background-work display provider name", MAX_DISPLAY_NAME_LENGTH);
	if (typeof value.describe !== "function") {
		throw new Error(`Background-work display provider '${name}' must expose describe().`);
	}
}

/**
 * Register or replace one process-local display provider. The returned disposer
 * only removes this exact registration; there is no by-name unregister.
 */
export function registerBackgroundWorkDisplayProvider(provider: BackgroundWorkDisplayProvider): () => void {
	validateDisplayProvider(provider);
	const providers = registry();
	if (!providers.has(provider.name) && providers.size >= MAX_DISPLAY_PROVIDERS) {
		throw new Error(`Background-work display registry supports at most ${MAX_DISPLAY_PROVIDERS} providers.`);
	}
	providers.set(provider.name, provider);
	return () => {
		if (providers.get(provider.name) === provider) providers.delete(provider.name);
	};
}

export function listBackgroundWorkDisplayProviders(): readonly BackgroundWorkDisplayProvider[] {
	const providers = registry();
	if (providers.size > MAX_DISPLAY_PROVIDERS) {
		throw new Error(`Background-work display registry contains more than ${MAX_DISPLAY_PROVIDERS} providers.`);
	}
	const listed: BackgroundWorkDisplayProvider[] = [];
	for (const [key, value] of providers) {
		validateDisplayProvider(value);
		if (key !== value.name) {
			throw new Error(`Background-work display registry key '${String(key)}' does not match provider name '${value.name}'.`);
		}
		listed.push(value);
	}
	return listed;
}
