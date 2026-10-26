import { afterEach, describe, expect, it } from "vitest";
import {
	BACKGROUND_WORK_REGISTRY_KEY,
	type BackgroundWorkListContext,
	listBackgroundWorkProviders,
	listBackgroundWorkWakeChannels,
	registerBackgroundWorkProvider,
	snapshotBackgroundWork,
} from "../src/registry";

const SLOT = Symbol.for(BACKGROUND_WORK_REGISTRY_KEY);

function clearRegistry(): void {
	Reflect.deleteProperty(globalThis, SLOT);
}

afterEach(clearRegistry);

// Ported from pi-subagents 0.83.0 test/unit/background-work.test.ts, describe "background-work provider protocol".
describe("background-work provider protocol", () => {
	it("replaces registrations safely across reloads and scopes snapshots to one session", () => {
		let context: BackgroundWorkListContext | undefined;
		const disposeOld = registerBackgroundWorkProvider({
			name: "patty",
			listActiveWork: () => [{ id: "old", sessionId: "session-a" }],
		});
		const replacement = {
			name: "patty",
			wakeChannels: ["patty:finished"],
			reconcile: (value: BackgroundWorkListContext) => {
				context = value;
			},
			listActiveWork: () => [
				{ id: "mine", sessionId: "session-a" },
				{ id: "theirs", sessionId: "session-b" },
			],
		};
		const disposeReplacement = registerBackgroundWorkProvider(replacement);
		disposeOld();

		expect(listBackgroundWorkProviders()).toEqual([replacement]);
		expect(listBackgroundWorkWakeChannels()).toEqual(["patty:finished"]);
		expect(snapshotBackgroundWork(["session-a"], 42)).toEqual({
			providers: ["patty"],
			items: [{ provider: "patty", id: "mine", sessionId: "session-a" }],
		});
		expect(context).toEqual({ sessionId: "session-a", sessionIds: ["session-a"], nowMs: 42 });

		disposeReplacement();
		expect(listBackgroundWorkProviders()).toEqual([]);
	});

	it("keeps items keyed by any form of the current session and calls each provider once", () => {
		let reconciles = 0;
		let lists = 0;
		let listContext: BackgroundWorkListContext | undefined;
		registerBackgroundWorkProvider({
			name: "patty",
			reconcile: () => {
				reconciles++;
			},
			listActiveWork: (context) => {
				lists++;
				listContext = context;
				return [
					{ id: "by-file", sessionId: "/sessions/a.jsonl" },
					{ id: "by-id", sessionId: "session-a" },
					{ id: "other-file", sessionId: "/sessions/b.jsonl" },
					{ id: "other-id", sessionId: "session-b" },
				];
			},
		});

		expect(snapshotBackgroundWork(["/sessions/a.jsonl", "session-a"], 42).items).toEqual([
			{ provider: "patty", id: "by-file", sessionId: "/sessions/a.jsonl" },
			{ provider: "patty", id: "by-id", sessionId: "session-a" },
		]);
		expect(listContext).toEqual({
			sessionId: "/sessions/a.jsonl",
			sessionIds: ["/sessions/a.jsonl", "session-a"],
			nowMs: 42,
		});
		expect(reconciles).toBe(1);
		expect(lists).toBe(1);
	});

	it("passes an optional session context while preserving legacy providers and exact filtering", () => {
		let listContext: BackgroundWorkListContext | undefined;
		let legacyCalled = false;
		registerBackgroundWorkProvider({
			name: "legacy",
			listActiveWork: () => {
				legacyCalled = true;
				return [{ id: "legacy-job", sessionId: "session-a" }];
			},
		});
		registerBackgroundWorkProvider({
			name: "scoped",
			listActiveWork: (context) => {
				if (!context) throw new Error("expected background-work list context");
				listContext = context;
				return [
					{ id: "mine", sessionId: context.sessionId },
					{ id: "theirs", sessionId: "session-b" },
				];
			},
		});

		expect(snapshotBackgroundWork(["session-a"], 42)).toEqual({
			providers: ["legacy", "scoped"],
			items: [
				{ provider: "legacy", id: "legacy-job", sessionId: "session-a" },
				{ provider: "scoped", id: "mine", sessionId: "session-a" },
			],
		});
		expect(legacyCalled).toBe(true);
		expect(listContext).toEqual({ sessionId: "session-a", sessionIds: ["session-a"], nowMs: 42 });
	});

	it("validates provider metadata and work items strictly", () => {
		expect(() => registerBackgroundWorkProvider({ name: " patty", listActiveWork: () => [] })).toThrow(
			/leading or trailing/,
		);
		expect(() =>
			registerBackgroundWorkProvider({ name: "patty", listActiveWork: () => [], wakeChannels: ["done", "done"] }),
		).toThrow(/duplicates/);

		const extra = { id: "job", sessionId: "session-a", extra: true };
		registerBackgroundWorkProvider({ name: "patty", listActiveWork: () => [extra] });
		expect(() => snapshotBackgroundWork(["session-a"])).toThrow(/unknown fields: extra/);
		clearRegistry();

		registerBackgroundWorkProvider({
			name: "patty",
			listActiveWork: () => [
				{ id: "job", sessionId: "session-a" },
				{ id: "job", sessionId: "session-a" },
			],
		});
		expect(() => snapshotBackgroundWork(["session-a"])).toThrow(/duplicate item 'job'/);
	});

	it("validates scoped provider results before filtering them", () => {
		const extra = { id: "job", sessionId: "session-a", extra: true };
		registerBackgroundWorkProvider({ name: "scoped", listActiveWork: () => [extra] });
		expect(() => snapshotBackgroundWork(["session-a"])).toThrow(/unknown fields: extra/);

		clearRegistry();
		registerBackgroundWorkProvider({
			name: "scoped",
			listActiveWork: (context) => {
				if (!context) throw new Error("expected background-work list context");
				return [
					{ id: "job", sessionId: context.sessionId },
					{ id: "job", sessionId: context.sessionId },
				];
			},
		});
		expect(() => snapshotBackgroundWork(["session-a"])).toThrow(/duplicate item 'job'/);
	});

	it("accepts path-like session ids up to the bound and rejects longer ids", () => {
		const longSessionId = `${"/nested/".repeat(511)}xsession`;
		const overBoundSessionId = `${longSessionId}x`;
		expect(longSessionId.length).toBe(4_096);

		registerBackgroundWorkProvider({
			name: "patty",
			listActiveWork: () => [{ id: "job", sessionId: longSessionId }],
		});
		expect(snapshotBackgroundWork([longSessionId])).toEqual({
			providers: ["patty"],
			items: [{ provider: "patty", id: "job", sessionId: longSessionId }],
		});
		expect(() => snapshotBackgroundWork([overBoundSessionId])).toThrow(/at most 4096 characters/);

		clearRegistry();
		registerBackgroundWorkProvider({
			name: "patty",
			listActiveWork: () => [{ id: "job", sessionId: overBoundSessionId }],
		});
		expect(() => snapshotBackgroundWork(["session-a"])).toThrow(/at most 4096 characters/);
	});

	it("preserves list and reconcile errors with provider context", () => {
		registerBackgroundWorkProvider({
			name: "broken-reconcile",
			reconcile: () => {
				throw new Error("pid probe failed");
			},
			listActiveWork: () => [],
		});
		expect(() => snapshotBackgroundWork(["session-a"])).toThrow(/broken-reconcile.*pid probe failed/);
		clearRegistry();

		registerBackgroundWorkProvider({
			name: "broken-list",
			listActiveWork: () => {
				throw new Error("registry unavailable");
			},
		});
		expect(() => snapshotBackgroundWork(["session-a"])).toThrow(/broken-list.*registry unavailable/);
	});

	it("discovers wake channels without reconciling or listing work", () => {
		let called = false;
		registerBackgroundWorkProvider({
			name: "patty",
			wakeChannels: ["patty:finished"],
			reconcile: () => {
				called = true;
			},
			listActiveWork: () => {
				called = true;
				return [];
			},
		});
		expect(listBackgroundWorkWakeChannels()).toEqual(["patty:finished"]);
		expect(called).toBe(false);
	});
});

// Not ported: the six upstream describe("bg_wait with background-work providers") cases. They drive
// pi-subagents' waitForSubagents loop (src/runs/background/subagent-wait.ts) with async-run status
// files, pollers and an event bus, which are outside the registry protocol this package implements:
//   - waits for provider work keyed by the Pi session id in a session that has a file
//   - detects completion when another item replaces it at the same count
//   - waits for both initial async and provider identities in all mode
//   - fails closed when a provider disappears or its snapshot throws
//   - can continue through needs-attention while draining
//   - wakes on a provider channel instead of the poll interval

// Cases upstream does not cover: caps, bounds, malformed registry slots, and the snapshot session-id rules.
describe("background-work registry bounds and slot validation", () => {
	it("enforces the provider count cap", () => {
		for (let index = 0; index < 100; index++) {
			registerBackgroundWorkProvider({ name: `p${index}`, listActiveWork: () => [] });
		}
		expect(() => registerBackgroundWorkProvider({ name: "p100", listActiveWork: () => [] })).toThrow(
			"supports at most 100 providers.",
		);
		expect(listBackgroundWorkProviders()).toHaveLength(100);
	});

	it("enforces the provider name bound", () => {
		expect(() => registerBackgroundWorkProvider({ name: "x".repeat(129), listActiveWork: () => [] })).toThrow(
			"at most 128 characters",
		);
	});

	it("accepts exactly 10000 items per provider and rejects 10001", () => {
		const items = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `job-${index}`, sessionId: "session-a" }));

		registerBackgroundWorkProvider({ name: "patty", listActiveWork: () => items(10_000) });
		expect(snapshotBackgroundWork(["session-a"]).items).toHaveLength(10_000);

		clearRegistry();
		registerBackgroundWorkProvider({ name: "patty", listActiveWork: () => items(10_001) });
		expect(() => snapshotBackgroundWork(["session-a"])).toThrow("maximum is 10000");
	});

	it("enforces item id and wake channel bounds and rejects NUL characters", () => {
		registerBackgroundWorkProvider({
			name: "patty",
			listActiveWork: () => [{ id: "x".repeat(257), sessionId: "session-a" }],
		});
		expect(() => snapshotBackgroundWork(["session-a"])).toThrow("at most 256 characters");

		clearRegistry();
		registerBackgroundWorkProvider({
			name: "patty",
			listActiveWork: () => [{ id: "a\0b", sessionId: "session-a" }],
		});
		expect(() => snapshotBackgroundWork(["session-a"])).toThrow("must not contain NUL characters");

		clearRegistry();
		expect(() =>
			registerBackgroundWorkProvider({ name: "patty", listActiveWork: () => [], wakeChannels: ["c".repeat(257)] }),
		).toThrow("at most 256 characters");
	});

	it("treats a malformed or unsupported registry slot as an error", () => {
		Reflect.set(globalThis, SLOT, "nope");
		expect(() => listBackgroundWorkProviders()).toThrow("Malformed background-work registry");

		Reflect.set(globalThis, SLOT, { version: 2, providers: new Map() });
		expect(() => listBackgroundWorkProviders()).toThrow("Unsupported background-work registry");

		Reflect.set(globalThis, SLOT, { version: 1, providers: {} });
		expect(() => listBackgroundWorkProviders()).toThrow("Unsupported background-work registry");

		Reflect.set(globalThis, SLOT, []);
		expect(() => listBackgroundWorkProviders()).toThrow("Malformed background-work registry");
	});

	it("rejects a provider stored under a key that does not match its name", () => {
		Reflect.set(globalThis, SLOT, {
			version: 1,
			providers: new Map([["other", { name: "patty", listActiveWork: () => [] }]]),
		});
		expect(() => listBackgroundWorkProviders()).toThrow("does not match provider name 'patty'");
	});

	it("requires at least one session id and dedupes the ones given", () => {
		const seen: string[][] = [];
		registerBackgroundWorkProvider({
			name: "patty",
			reconcile: (context) => {
				seen.push([...context.sessionIds]);
			},
			listActiveWork: () => [],
		});
		expect(() => snapshotBackgroundWork([])).toThrow("needs at least one session id");

		snapshotBackgroundWork(["session-a", "session-a"], 1);
		expect(seen).toEqual([["session-a"]]);
	});
});
