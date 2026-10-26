/*
 * Ported from pi-subagents 0.83.0 (6c1b3c7) src/api/background-work.js and
 * background-work.d.ts. Protocol and original code: Copyright (c) 2026 Nico
 * Bailon, MIT. Behaviour must stay identical to upstream; test/compat.test.ts
 * checks it against the published package.
 */

export const BACKGROUND_WORK_PROTOCOL_VERSION = 1;
export const BACKGROUND_WORK_REGISTRY_KEY = "pi-subagents.background-work.v1";
const REGISTRY_SLOT = Symbol.for(BACKGROUND_WORK_REGISTRY_KEY);
const MAX_PROVIDER_NAME_LENGTH = 128;
const MAX_PROVIDERS = 100;
const MAX_ITEM_ID_LENGTH = 256;
/**
 * A session can be identified by its file path, which routinely exceeds a short
 * identity budget in nested worktrees, so it is bounded like the other paths.
 */
const MAX_SESSION_ID_LENGTH = 4_096;
const MAX_WAKE_CHANNEL_LENGTH = 256;
const MAX_ITEMS_PER_PROVIDER = 10_000;
const PROVIDER_FIELDS: readonly string[] = ["name", "listActiveWork", "wakeChannels", "reconcile"];
const ITEM_FIELDS: readonly string[] = ["id", "sessionId"];

export interface BackgroundWorkItem {
	id: string;
	sessionId: string;
}

export interface BackgroundWorkListContext {
	sessionId: string;
	/** Every form the current session is known by: its file path when it has one, and `getSessionId()`. Includes `sessionId`. */
	sessionIds: readonly string[];
	nowMs: number;
}

export type BackgroundWorkReconcileContext = BackgroundWorkListContext;

export interface BackgroundWorkProvider {
	name: string;
	listActiveWork(context?: BackgroundWorkListContext): readonly BackgroundWorkItem[];
	wakeChannels?: readonly string[];
	reconcile?(context: BackgroundWorkReconcileContext): void;
}

export interface RegisteredBackgroundWorkItem extends BackgroundWorkItem {
	provider: string;
}

export interface BackgroundWorkSnapshot {
	providers: readonly string[];
	items: readonly RegisteredBackgroundWorkItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** The process-wide provider map. Every copy of this protocol in the process shares it. */
function registry(): Map<unknown, unknown> {
	const existing: unknown = Reflect.get(globalThis, REGISTRY_SLOT);
	if (existing === undefined) {
		const created = { version: BACKGROUND_WORK_PROTOCOL_VERSION, providers: new Map<unknown, unknown>() };
		Reflect.set(globalThis, REGISTRY_SLOT, created);
		return created.providers;
	}
	if (!isRecord(existing)) {
		throw new Error(`Malformed background-work registry at Symbol.for("${BACKGROUND_WORK_REGISTRY_KEY}").`);
	}
	if (existing.version !== BACKGROUND_WORK_PROTOCOL_VERSION || !(existing.providers instanceof Map)) {
		throw new Error(`Unsupported background-work registry at Symbol.for("${BACKGROUND_WORK_REGISTRY_KEY}").`);
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

function validateProvider(value: unknown): asserts value is BackgroundWorkProvider {
	if (!isRecord(value)) throw new Error("Background-work provider must be an object.");
	const unknownFields = Object.keys(value).filter((key) => !PROVIDER_FIELDS.includes(key));
	if (unknownFields.length > 0) {
		throw new Error(`Background-work provider has unknown fields: ${unknownFields.join(", ")}.`);
	}
	const name = validateString(value.name, "Background-work provider name", MAX_PROVIDER_NAME_LENGTH);
	if (typeof value.listActiveWork !== "function") {
		throw new Error(`Background-work provider '${name}' must expose listActiveWork().`);
	}
	if (value.reconcile !== undefined && typeof value.reconcile !== "function") {
		throw new Error(`Background-work provider '${name}' reconcile must be a function when provided.`);
	}
	const { wakeChannels } = value;
	if (wakeChannels !== undefined) {
		if (!Array.isArray(wakeChannels)) {
			throw new Error(`Background-work provider '${name}' wakeChannels must be an array when provided.`);
		}
		const channels = wakeChannels.map((channel: unknown, index: number) =>
			validateString(channel, `Background-work provider '${name}' wakeChannels[${index}]`, MAX_WAKE_CHANNEL_LENGTH),
		);
		if (new Set(channels).size !== channels.length) {
			throw new Error(`Background-work provider '${name}' wakeChannels must not contain duplicates.`);
		}
	}
}

function validateItem(provider: string, value: unknown, index: number): BackgroundWorkItem {
	if (!isRecord(value)) {
		throw new Error(`Background-work provider '${provider}' item ${index} must be an object.`);
	}
	const unknownFields = Object.keys(value).filter((key) => !ITEM_FIELDS.includes(key));
	if (unknownFields.length > 0) {
		throw new Error(`Background-work provider '${provider}' item ${index} has unknown fields: ${unknownFields.join(", ")}.`);
	}
	return {
		id: validateString(value.id, `Background-work provider '${provider}' item ${index} id`, MAX_ITEM_ID_LENGTH),
		sessionId: validateString(value.sessionId, `Background-work provider '${provider}' item ${index} sessionId`, MAX_SESSION_ID_LENGTH),
	};
}

/**
 * Register or replace one process-local background-work provider. The returned
 * disposer only removes this exact registration, so an old extension reload
 * cannot unregister its replacement.
 */
export function registerBackgroundWorkProvider(provider: BackgroundWorkProvider): () => void {
	validateProvider(provider);
	const providers = registry();
	if (!providers.has(provider.name) && providers.size >= MAX_PROVIDERS) {
		throw new Error(`Background-work registry supports at most ${MAX_PROVIDERS} providers.`);
	}
	providers.set(provider.name, provider);
	return () => {
		if (providers.get(provider.name) === provider) providers.delete(provider.name);
	};
}

export function listBackgroundWorkProviders(): readonly BackgroundWorkProvider[] {
	const providers = registry();
	if (providers.size > MAX_PROVIDERS) {
		throw new Error(`Background-work registry contains more than ${MAX_PROVIDERS} providers.`);
	}
	const listed: BackgroundWorkProvider[] = [];
	for (const [key, value] of providers) {
		validateProvider(value);
		if (key !== value.name) {
			throw new Error(`Background-work registry key '${String(key)}' does not match provider name '${value.name}'.`);
		}
		listed.push(value);
	}
	return listed;
}

/** Read validated provider wake channels without reconciling or listing work. */
export function listBackgroundWorkWakeChannels(): readonly string[] {
	const channels = new Set<string>();
	for (const provider of listBackgroundWorkProviders()) {
		for (const channel of provider.wakeChannels ?? []) channels.add(channel);
	}
	return [...channels];
}

/**
 * Reconcile and snapshot active provider work owned by one exact Pi session.
 * `sessionIds` lists that session's identity forms; the first is passed to
 * providers as `sessionId`, and items keyed by any of them are kept.
 */
export function snapshotBackgroundWork(sessionIds: readonly string[], nowMs = Date.now()): BackgroundWorkSnapshot {
	const accepted = [...new Set(sessionIds.map((value) => validateString(value, "Background-work snapshot sessionId", MAX_SESSION_ID_LENGTH)))];
	const sessionId = accepted[0];
	if (sessionId === undefined) throw new Error("Background-work snapshot needs at least one session id.");
	const providers = listBackgroundWorkProviders();
	const items: RegisteredBackgroundWorkItem[] = [];
	const identities = new Set<string>();
	for (const provider of providers) {
		try {
			provider.reconcile?.({ sessionId, sessionIds: [...accepted], nowMs });
		} catch (error) {
			throw new Error(`Background-work provider '${provider.name}' reconcile failed: ${errorMessage(error)}`, { cause: error });
		}
		let active: unknown;
		try {
			active = provider.listActiveWork({ sessionId, sessionIds: [...accepted], nowMs });
		} catch (error) {
			throw new Error(`Background-work provider '${provider.name}' listActiveWork failed: ${errorMessage(error)}`, { cause: error });
		}
		if (!Array.isArray(active)) {
			throw new Error(`Background-work provider '${provider.name}' listActiveWork() must return an array.`);
		}
		if (active.length > MAX_ITEMS_PER_PROVIDER) {
			throw new Error(`Background-work provider '${provider.name}' returned ${active.length} items; maximum is ${MAX_ITEMS_PER_PROVIDER}.`);
		}
		active.forEach((value: unknown, index: number) => {
			const item = validateItem(provider.name, value, index);
			const identity = `${provider.name}\0${item.sessionId}\0${item.id}`;
			if (identities.has(identity)) {
				throw new Error(`Background-work provider '${provider.name}' returned duplicate item '${item.id}' for session '${item.sessionId}'.`);
			}
			identities.add(identity);
			if (accepted.includes(item.sessionId)) items.push({ provider: provider.name, ...item });
		});
	}
	return {
		providers: providers.map((provider) => provider.name),
		items,
	};
}
