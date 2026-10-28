/*
 * Per-provider collection for the footer. v1's rules, applied to each provider
 * on its own: one provider's violation loses its own segment, not its
 * neighbours', and never stops the tick.
 */

import type { DescribeContext } from "./display";
import type { BackgroundWorkSource } from "./footer";
import { type BackgroundWorkItem, type BackgroundWorkProvider, listBackgroundWorkProviders } from "./registry";

const MAX_ITEM_ID_LENGTH = 256;
/** A session can be identified by its file path, which routinely exceeds a short budget. */
const MAX_SESSION_ID_LENGTH = 4_096;
const MAX_ITEMS_PER_PROVIDER = 10_000;
const ITEM_FIELDS: readonly string[] = ["id", "sessionId"];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateString(value: unknown, field: string, maxLength: number): string {
	if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
		throw new Error(`${field} must be a non-empty string without leading or trailing whitespace.`);
	}
	if (value.length > maxLength) throw new Error(`${field} must be at most ${maxLength} characters.`);
	if (value.includes("\0")) throw new Error(`${field} must not contain NUL characters.`);
	return value;
}

/** v1's item rules, copied: an item is an object with exactly `id` and `sessionId`. */
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
		sessionId: validateString(
			value.sessionId,
			`Background-work provider '${provider}' item ${index} sessionId`,
			MAX_SESSION_ID_LENGTH,
		),
	};
}

function validateItems(provider: string, active: readonly unknown[], sessionIds: readonly string[]): BackgroundWorkItem[] {
	const items: BackgroundWorkItem[] = [];
	const identities = new Set<string>();
	active.forEach((value: unknown, index: number) => {
		const item = validateItem(provider, value, index);
		const identity = `${provider}\0${item.sessionId}\0${item.id}`;
		if (identities.has(identity)) {
			throw new Error(`Background-work provider '${provider}' returned duplicate item '${item.id}' for session '${item.sessionId}'.`);
		}
		identities.add(identity);
		if (sessionIds.includes(item.sessionId)) items.push(item);
	});
	return items;
}

/** v1's reconcile-then-list sequence for one provider, or `undefined` when it failed. */
function collectItems(provider: BackgroundWorkProvider, context: DescribeContext): BackgroundWorkItem[] | undefined {
	try {
		provider.reconcile?.(context);
	} catch {
		return undefined;
	}
	let active: unknown;
	try {
		active = provider.listActiveWork(context);
	} catch {
		return undefined;
	}
	if (!Array.isArray(active) || active.length > MAX_ITEMS_PER_PROVIDER) return undefined;
	try {
		return validateItems(provider.name, active, context.sessionIds);
	} catch {
		return undefined;
	}
}

/**
 * One source per provider, in v1's provider order. A provider that throws, or
 * that violates v1's item rules, yields `{ failed: true }` instead of throwing.
 */
export function collectBackgroundWorkSources(sessionIds: readonly string[], nowMs: number): BackgroundWorkSource[] {
	const forms = [...new Set(sessionIds)];
	const sessionId = forms[0];
	if (sessionId === undefined) return [];
	const context: DescribeContext = { sessionId, sessionIds: forms, nowMs };
	let providers: readonly BackgroundWorkProvider[];
	try {
		providers = listBackgroundWorkProviders();
	} catch {
		return [];
	}
	return providers.map((provider) => {
		const items = collectItems(provider, context);
		return items === undefined ? { name: provider.name, failed: true } : { name: provider.name, items };
	});
}
