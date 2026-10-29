import { afterEach, describe, expect, it } from "vitest";
import { collectBackgroundWorkSources } from "../src/collect";
import type { DescribeContext } from "../src/display";
import { BACKGROUND_WORK_REGISTRY_KEY, registerBackgroundWorkProvider } from "../src/registry";

const SLOT = Symbol.for(BACKGROUND_WORK_REGISTRY_KEY);

afterEach(() => {
	Reflect.deleteProperty(globalThis, SLOT);
});

function item(id: string, sessionId = "session-a"): { id: string; sessionId: string } {
	return { id, sessionId };
}

describe("collectBackgroundWorkSources", () => {
	it("passes one v1-shaped context, with nowMs, to reconcile and listActiveWork", () => {
		const contexts: (DescribeContext | undefined)[] = [];
		registerBackgroundWorkProvider({
			name: "patty",
			reconcile: (context) => {
				contexts.push(context);
			},
			listActiveWork: (context) => {
				contexts.push(context);
				return [];
			},
		});

		expect(collectBackgroundWorkSources(["session-a", "/sessions/a.jsonl", "session-a"], 42)).toEqual([
			{ name: "patty", items: [] },
		]);
		const expected = { sessionId: "session-a", sessionIds: ["session-a", "/sessions/a.jsonl"], nowMs: 42 };
		expect(contexts).toEqual([expected, expected]);
	});

	it("reconciles before listing on every tick, and a throwing reconcile drops only that provider", () => {
		const order: string[] = [];
		registerBackgroundWorkProvider({
			name: "patty",
			reconcile: () => void order.push("patty:reconcile"),
			listActiveWork: () => {
				order.push("patty:list");
				return [item("job")];
			},
		});
		registerBackgroundWorkProvider({
			name: "demo",
			reconcile: () => {
				order.push("demo:reconcile");
				throw new Error("boom");
			},
			listActiveWork: () => {
				order.push("demo:list");
				return [item("job")];
			},
		});

		const first = collectBackgroundWorkSources(["session-a"], 1);
		expect(first).toEqual([
			{ name: "patty", items: [item("job")] },
			{ name: "demo", failed: true },
		]);
		expect(collectBackgroundWorkSources(["session-a"], 2)).toEqual(first);
		expect(order).toEqual([
			"patty:reconcile",
			"patty:list",
			"demo:reconcile",
			"patty:reconcile",
			"patty:list",
			"demo:reconcile",
		]);
	});

	it("keeps only items owned by one of this session's identity forms", () => {
		registerBackgroundWorkProvider({
			name: "patty",
			listActiveWork: () => [item("mine"), item("by-path", "/sessions/a.jsonl"), item("theirs", "session-b")],
		});

		expect(collectBackgroundWorkSources(["session-a", "/sessions/a.jsonl"], 1)).toEqual([
			{ name: "patty", items: [item("mine"), item("by-path", "/sessions/a.jsonl")] },
		]);
	});

	it("fails one provider for an invalid item, a duplicate or too many items, leaving the others intact", () => {
		registerBackgroundWorkProvider({ name: "healthy", listActiveWork: () => [item("job")] });
		registerBackgroundWorkProvider({
			name: "invalid",
			listActiveWork: () => [{ id: "job" } as unknown as { id: string; sessionId: string }],
		});
		registerBackgroundWorkProvider({ name: "duplicate", listActiveWork: () => [item("job"), item("job")] });
		registerBackgroundWorkProvider({
			name: "crowded",
			listActiveWork: () => Array.from({ length: 10_001 }, (_, index) => item(`job-${index}`)),
		});

		expect(collectBackgroundWorkSources(["session-a"], 1)).toEqual([
			{ name: "healthy", items: [item("job")] },
			{ name: "invalid", failed: true },
			{ name: "duplicate", failed: true },
			{ name: "crowded", failed: true },
		]);
	});

	it("survives a throwing provider and an unreadable provider registry", () => {
		registerBackgroundWorkProvider({
			name: "throwing",
			listActiveWork: () => {
				throw new Error("boom");
			},
		});
		registerBackgroundWorkProvider({ name: "healthy", listActiveWork: () => [item("job")] });

		expect(collectBackgroundWorkSources(["session-a"], 1)).toEqual([
			{ name: "throwing", failed: true },
			{ name: "healthy", items: [item("job")] },
		]);
		expect(collectBackgroundWorkSources([], 1)).toEqual([]);

		Reflect.set(globalThis, SLOT, { version: 2, providers: new Map() });
		expect(collectBackgroundWorkSources(["session-a"], 1)).toEqual([]);
	});

	it("accepts exactly 10,000 items and fails 10,001", () => {
		const many = (count: number) =>
			Array.from({ length: count }, (_, index) => ({ id: "job-" + index, sessionId: "session-a" }));
		registerBackgroundWorkProvider({ name: "big", listActiveWork: () => many(10_000) });
		expect(collectBackgroundWorkSources(["session-a"], 1)).toEqual([{ name: "big", items: many(10_000) }]);

		Reflect.deleteProperty(globalThis, Symbol.for(BACKGROUND_WORK_REGISTRY_KEY));
		registerBackgroundWorkProvider({ name: "big", listActiveWork: () => many(10_001) });
		expect(collectBackgroundWorkSources(["session-a"], 1)).toEqual([{ name: "big", failed: true }]);
	});

	it("gives each provider its own context, so a mutating reconcile cannot filter the next one", () => {
		registerBackgroundWorkProvider({
			name: "mutator",
			reconcile: (context) => {
				(context?.sessionIds as string[]).push("/elsewhere");
				(context as { nowMs: number } | undefined)!.nowMs = 999;
			},
			listActiveWork: () => [
				{ id: "own", sessionId: "session-a" },
				{ id: "foreign", sessionId: "/elsewhere" },
			],
		});
		let seenNowMs: number | undefined;
		registerBackgroundWorkProvider({
			name: "observer",
			listActiveWork: (context) => {
				seenNowMs = context?.nowMs;
				return [{ id: "kept", sessionId: "session-a" }];
			},
		});

		const sources = collectBackgroundWorkSources(["session-a"], 42);
		expect(sources[0]).toEqual({ name: "mutator", items: [{ id: "own", sessionId: "session-a" }] });
		expect(sources[1]).toEqual({ name: "observer", items: [{ id: "kept", sessionId: "session-a" }] });
		expect(seenNowMs).toBe(42);
	});
});
