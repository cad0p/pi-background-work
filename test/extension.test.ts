import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKGROUND_WORK_DISPLAY_KEY, registerBackgroundWorkDisplayProvider } from "../src/display";
import backgroundWorkFooter from "../src/extension";
import { BACKGROUND_WORK_REGISTRY_KEY, registerBackgroundWorkProvider } from "../src/registry";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
type StatusCall = [key: string, text: string | undefined];

const REGISTRY_SLOT = Symbol.for(BACKGROUND_WORK_REGISTRY_KEY);
const DISPLAY_SLOT = Symbol.for(BACKGROUND_WORK_DISPLAY_KEY);

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	Reflect.deleteProperty(globalThis, REGISTRY_SLOT);
	Reflect.deleteProperty(globalThis, DISPLAY_SLOT);
});

function loadExtension(): Map<string, Handler> {
	const handlers = new Map<string, Handler>();
	const pi = {
		on: (event: string, handler: Handler) => {
			handlers.set(event, handler);
			return () => handlers.delete(event);
		},
	} as unknown as ExtensionAPI;
	backgroundWorkFooter(pi);
	return handlers;
}

function emit(handlers: Map<string, Handler>, event: string, ctx: ExtensionContext): void {
	handlers.get(event)?.({ type: event }, ctx);
}

interface ContextOptions {
	hasUI?: boolean;
	onStatus?: (key: string, text: string | undefined) => void;
}

function context(options: ContextOptions = {}): { ctx: ExtensionContext; calls: StatusCall[] } {
	const calls: StatusCall[] = [];
	const ctx = {
		hasUI: options.hasUI ?? true,
		sessionManager: { getSessionId: () => "session-a", getSessionFile: () => "/sessions/a.jsonl" },
		ui: { setStatus: options.onStatus ?? ((key: string, text: string | undefined) => calls.push([key, text])) },
	} as unknown as ExtensionContext;
	return { ctx, calls };
}

function registerDemo(count: () => number): void {
	registerBackgroundWorkProvider({
		name: "demo",
		listActiveWork: () =>
			Array.from({ length: count() }, (_, index) => ({ id: `job-${index}`, sessionId: "session-a" })),
	});
}

function footerText(count: number): string {
	return `⏳ ${count} demo`;
}

describe("background-work footer extension", () => {
	it("renders once on session_start", () => {
		const handlers = loadExtension();
		registerDemo(() => 2);
		const { ctx, calls } = context();

		emit(handlers, "session_start", ctx);
		expect(calls).toEqual([["bg-work", footerText(2)]]);
	});

	it("writes only when the text changes", () => {
		const handlers = loadExtension();
		let count = 1;
		registerDemo(() => count);
		const { ctx, calls } = context();

		emit(handlers, "session_start", ctx);
		vi.advanceTimersByTime(3_000);
		expect(calls).toEqual([["bg-work", footerText(1)]]);

		count = 3;
		vi.advanceTimersByTime(1_000);
		expect(calls).toEqual([
			["bg-work", footerText(1)],
			["bg-work", footerText(3)],
		]);
	});

	it("clears the line once when nothing is pending", () => {
		const handlers = loadExtension();
		let count = 1;
		registerDemo(() => count);
		const { ctx, calls } = context();

		emit(handlers, "session_start", ctx);
		count = 0;
		vi.advanceTimersByTime(2_000);
		expect(calls).toEqual([
			["bg-work", footerText(1)],
			["bg-work", undefined],
		]);
	});

	it("renders immediately on agent_settled", () => {
		const handlers = loadExtension();
		let count = 0;
		registerDemo(() => count);
		const { ctx, calls } = context();

		emit(handlers, "session_start", ctx);
		expect(calls).toEqual([]);

		count = 2;
		emit(handlers, "agent_settled", ctx);
		expect(calls).toEqual([["bg-work", footerText(2)]]);
	});

	it("clears and stops on session_shutdown, and renders again on the next session_start", () => {
		const handlers = loadExtension();
		registerDemo(() => 1);
		const { ctx, calls } = context();

		emit(handlers, "session_start", ctx);
		emit(handlers, "session_shutdown", ctx);
		expect(calls).toEqual([
			["bg-work", footerText(1)],
			["bg-work", undefined],
		]);

		vi.advanceTimersByTime(5_000);
		expect(calls).toHaveLength(2);

		emit(handlers, "session_start", ctx);
		expect(calls).toEqual([
			["bg-work", footerText(1)],
			["bg-work", undefined],
			["bg-work", footerText(1)],
		]);
	});

	it("writes nothing and starts no timer without a UI", () => {
		const handlers = loadExtension();
		registerDemo(() => 1);
		const { ctx, calls } = context({ hasUI: false });

		emit(handlers, "session_start", ctx);
		emit(handlers, "agent_settled", ctx);
		vi.advanceTimersByTime(5_000);
		emit(handlers, "session_shutdown", ctx);
		expect(calls).toEqual([]);
	});

	it("stops the tick when setStatus throws, without escaping, and writes through the next context", () => {
		const handlers = loadExtension();
		let count = 2;
		registerDemo(() => count);
		let attempts = 0;
		const broken = context({
			onStatus: () => {
				attempts++;
				throw new Error("dead context");
			},
		});

		expect(() => emit(handlers, "session_start", broken.ctx)).not.toThrow();
		count = 3;
		expect(() => vi.advanceTimersByTime(5_000)).not.toThrow();
		expect(attempts).toBe(1);

		const replacement = context();
		emit(handlers, "session_start", replacement.ctx);
		expect(replacement.calls).toEqual([["bg-work", footerText(3)]]);
		vi.advanceTimersByTime(1_000);
		expect(replacement.calls).toHaveLength(1);
	});

	it("uses a display provider registered after session_start on the next tick", () => {
		const handlers = loadExtension();
		registerDemo(() => 2);
		const { ctx, calls } = context();

		emit(handlers, "session_start", ctx);
		expect(calls).toEqual([["bg-work", footerText(2)]]);

		registerBackgroundWorkDisplayProvider({ name: "demo", describe: () => "2 demo jobs" });
		vi.advanceTimersByTime(1_000);
		expect(calls).toEqual([
			["bg-work", footerText(2)],
			["bg-work", "⏳ 2 demo jobs"],
		]);
	});

	it("reads one clock per tick for the listing and for describe", () => {
		const handlers = loadExtension();
		let listedAt: number | undefined;
		let describedAt: number | undefined;
		registerBackgroundWorkProvider({
			name: "demo",
			listActiveWork: (context) => {
				listedAt = context?.nowMs;
				vi.setSystemTime(Date.now() + 500);
				return [{ id: "job", sessionId: "session-a" }];
			},
		});
		registerBackgroundWorkDisplayProvider({
			name: "demo",
			describe: (_items, context) => {
				describedAt = context.nowMs;
				return "1 demo job";
			},
		});

		emit(handlers, "session_start", context().ctx);
		expect(listedAt).toBeDefined();
		expect(describedAt).toBe(listedAt);
	});

	it("keeps exactly one live timer across agent_settled, and none after shutdown", () => {
		const handlers = loadExtension();
		registerDemo(() => 1);
		const { ctx } = context();

		emit(handlers, "session_start", ctx);
		expect(vi.getTimerCount()).toBe(1);
		emit(handlers, "agent_settled", ctx);
		expect(vi.getTimerCount()).toBe(1);
		emit(handlers, "agent_settled", ctx);
		expect(vi.getTimerCount()).toBe(1);

		emit(handlers, "session_shutdown", ctx);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("stops the tick before the clear on session_shutdown, even with a dead context", () => {
		const handlers = loadExtension();
		registerDemo(() => 1);
		let attempts = 0;
		const dead = context({
			onStatus: () => {
				attempts++;
				throw new Error("dead context");
			},
		});
		const live = context();

		emit(handlers, "session_start", live.ctx);
		expect(vi.getTimerCount()).toBe(1);
		expect(() => emit(handlers, "session_shutdown", dead.ctx)).not.toThrow();
		expect(attempts).toBe(1);
		expect(vi.getTimerCount()).toBe(0);
		vi.advanceTimersByTime(5_000);
		expect(attempts).toBe(1);
	});

	it("unrefs the tick, so it never keeps the process alive", () => {
		const handlers = loadExtension();
		registerDemo(() => 1);
		const { ctx } = context();
		const unref = vi.fn();
		const realSetTimeout = globalThis.setTimeout;
		const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, ms?: number) => {
			const handle = realSetTimeout(callback, ms);
			return Object.assign(handle, { unref });
		}) as unknown as typeof setTimeout);

		emit(handlers, "session_start", ctx);
		expect(unref).toHaveBeenCalled();
		spy.mockRestore();
		emit(handlers, "session_shutdown", ctx);
	});

	it("renders through the context of the event that triggered it", () => {
		const handlers = loadExtension();
		let count = 1;
		registerDemo(() => count);
		const first = context();
		const second = context();

		emit(handlers, "session_start", first.ctx);
		count = 2;
		emit(handlers, "agent_settled", second.ctx);
		expect(second.calls).toEqual([["bg-work", footerText(2)]]);
		expect(first.calls).toEqual([["bg-work", footerText(1)]]);
	});

	it("clears the line when the session has no identity form", () => {
		const handlers = loadExtension();
		registerDemo(() => 1);
		let identity = "session-a";
		const calls: StatusCall[] = [];
		const ctx = {
			hasUI: true,
			sessionManager: { getSessionId: () => identity, getSessionFile: () => undefined },
			ui: { setStatus: (key: string, text: string | undefined) => calls.push([key, text]) },
		} as unknown as ExtensionContext;

		emit(handlers, "session_start", ctx);
		expect(calls).toEqual([["bg-work", footerText(1)]]);
		identity = "";
		vi.advanceTimersByTime(1_000);
		expect(calls).toEqual([
			["bg-work", footerText(1)],
			["bg-work", undefined],
		]);
		emit(handlers, "session_shutdown", ctx);
	});

	it("keeps the last line when the data path throws outside the collector's guards", () => {
		const handlers = loadExtension();
		registerDemo(() => 1);
		const { ctx, calls } = context();
		emit(handlers, "session_start", ctx);
		expect(calls).toEqual([["bg-work", footerText(1)]]);

		// A listing whose array length getter throws escapes the collector (v1's own shape
		// checks are not guarded), so only the extension's data-path guard keeps pip safe.
		Reflect.deleteProperty(globalThis, Symbol.for(BACKGROUND_WORK_REGISTRY_KEY));
		registerBackgroundWorkProvider({
			name: "demo",
			listActiveWork: () =>
				new Proxy([], {
					get: (_target, key) => {
						if (key === "length") throw new Error("boom");
						return undefined;
					},
				}) as never,
		});

		expect(() => vi.advanceTimersByTime(1_000)).not.toThrow();
		expect(calls).toEqual([["bg-work", footerText(1)]]);
		emit(handlers, "session_shutdown", ctx);
	});
});
