import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import * as upstream from "pi-subagents/background-work";
import * as ours from "../src/registry";
import { BACKGROUND_WORK_REGISTRY_KEY } from "../src/registry";

// Runs against pi-subagents@0.83.0 (pinned devDependency) loaded in the same process.
// Both sides share one global slot, so every case clears it first.
type Api = typeof ours;

const SLOT = Symbol.for(BACKGROUND_WORK_REGISTRY_KEY);
const apis: ReadonlyArray<readonly [string, Api]> = [
	["ours", ours],
	["upstream", upstream],
];

function clearRegistry(): void {
	Reflect.deleteProperty(globalThis, SLOT);
}

function failureOf(api: Api, run: (api: Api) => void): string {
	clearRegistry();
	try {
		run(api);
		return "no error";
	} catch (error) {
		return error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error);
	}
}

const failures: ReadonlyArray<readonly [string, (api: Api) => void]> = [
	[
		"malformed provider name",
		(api) => {
			// @ts-expect-error malformed on purpose
			api.registerBackgroundWorkProvider({ name: 42, listActiveWork: () => [] });
		},
	],
	[
		"unknown provider field",
		(api) => {
			// @ts-expect-error unknown field on purpose
			api.registerBackgroundWorkProvider({ name: "p", listActiveWork: () => [], extra: true });
		},
	],
	[
		"duplicate item ids",
		(api) => {
			api.registerBackgroundWorkProvider({
				name: "dup",
				listActiveWork: () => [
					{ id: "a", sessionId: "s" },
					{ id: "a", sessionId: "s" },
				],
			});
			api.snapshotBackgroundWork(["s"], 1);
		},
	],
	[
		"more than 100 providers",
		(api) => {
			for (let i = 0; i <= 100; i += 1) {
				api.registerBackgroundWorkProvider({ name: `p${i}`, listActiveWork: () => [] });
			}
		},
	],
	[
		"more than 10000 items per provider",
		(api) => {
			api.registerBackgroundWorkProvider({
				name: "many",
				listActiveWork: () => Array.from({ length: 10_001 }, (_, i) => ({ id: `i${i}`, sessionId: "s" })),
			});
			api.snapshotBackgroundWork(["s"], 1);
		},
	],
	[
		"session id longer than 4096",
		(api) => {
			api.registerBackgroundWorkProvider({ name: "long", listActiveWork: () => [{ id: "a", sessionId: "x".repeat(4_097) }] });
			api.snapshotBackgroundWork(["s"], 1);
		},
	],
	[
		"registry version 2",
		(api) => {
			Reflect.set(globalThis, SLOT, { version: 2, providers: new Map() });
			api.listBackgroundWorkProviders();
		},
	],
	[
		"unknown field and invalid name",
		(api) => {
			// @ts-expect-error malformed on purpose
			api.registerBackgroundWorkProvider({ name: 42, listActiveWork: () => [], extra: true });
		},
	],
	[
		"provider name longer than 128",
		(api) => {
			api.registerBackgroundWorkProvider({ name: "n".repeat(129), listActiveWork: () => [] });
		},
	],
	[
		"non-array wakeChannels",
		(api) => {
			// @ts-expect-error malformed on purpose
			api.registerBackgroundWorkProvider({ name: "wake", wakeChannels: "a", listActiveWork: () => [] });
		},
	],
	[
		"duplicate wakeChannels",
		(api) => {
			api.registerBackgroundWorkProvider({ name: "wake", wakeChannels: ["a", "a"], listActiveWork: () => [] });
		},
	],
	[
		"item id longer than 256",
		(api) => {
			api.registerBackgroundWorkProvider({ name: "long-id", listActiveWork: () => [{ id: "x".repeat(257), sessionId: "s" }] });
			api.snapshotBackgroundWork(["s"], 1);
		},
	],
	[
		"snapshot with no session ids",
		(api) => {
			api.snapshotBackgroundWork([], 1);
		},
	],
	[
		"non-array listActiveWork result",
		(api) => {
			// @ts-expect-error non-array on purpose
			api.registerBackgroundWorkProvider({ name: "object", listActiveWork: () => ({}) });
			api.snapshotBackgroundWork(["s"], 1);
		},
	],
	[
		"reconcile throwing",
		(api) => {
			api.registerBackgroundWorkProvider({
				name: "boom",
				reconcile: () => {
					throw new Error("boom");
				},
				listActiveWork: () => [],
			});
			api.snapshotBackgroundWork(["s"], 1);
		},
	],
	[
		"malformed registry slot",
		(api) => {
			Reflect.set(globalThis, SLOT, "nope");
			api.listBackgroundWorkProviders();
		},
	],
	[
		"array registry slot",
		(api) => {
			Reflect.set(globalThis, SLOT, []);
			api.listBackgroundWorkProviders();
		},
	],
];

afterEach(clearRegistry);

describe("compatibility with pi-subagents/background-work", () => {
	it.each<[string, Api, Api]>([
		["upstream first", upstream, ours],
		["ours first", ours, upstream],
	])("shares one registry when %s and the second side adopts it", (_label, first, second) => {
		first.registerBackgroundWorkProvider({ name: "first", listActiveWork: () => [] });
		second.registerBackgroundWorkProvider({ name: "second", listActiveWork: () => [] });
		for (const [, api] of apis) {
			expect(api.listBackgroundWorkProviders().map((provider) => provider.name)).toEqual(["first", "second"]);
		}
	});

	it("each side's snapshot sees the other's providers, items and wake channels", () => {
		upstream.registerBackgroundWorkProvider({
			name: "from-upstream",
			wakeChannels: ["upstream:done"],
			listActiveWork: () => [{ id: "u1", sessionId: "s" }],
		});
		ours.registerBackgroundWorkProvider({ name: "from-ours", listActiveWork: () => [{ id: "o1", sessionId: "s" }] });
		const expected = {
			providers: ["from-upstream", "from-ours"],
			items: [
				{ provider: "from-upstream", id: "u1", sessionId: "s" },
				{ provider: "from-ours", id: "o1", sessionId: "s" },
			],
		};
		for (const [, api] of apis) {
			expect(api.snapshotBackgroundWork(["s"], 1)).toEqual(expected);
			expect(api.listBackgroundWorkWakeChannels()).toEqual(["upstream:done"]);
		}
	});

	it.each(failures)("rejects %s with the same error on both sides", (_label, run) => {
		const expected = failureOf(ours, run);
		expect(expected).not.toBe("no error");
		expect(failureOf(upstream, run)).toBe(expected);
	});

	it("accepts exactly 10000 items per provider on both sides", () => {
		for (const [, api] of apis) {
			clearRegistry();
			api.registerBackgroundWorkProvider({
				name: "full",
				listActiveWork: () => Array.from({ length: 10_000 }, (_, index) => ({ id: `job-${index}`, sessionId: "s" })),
			});
			expect(api.snapshotBackgroundWork(["s"], 1).items).toHaveLength(10_000);
		}
	});

	it("passes the same reconcile and listing context from both sides", () => {
		const seen = apis.map(([, api]) => {
			clearRegistry();
			const calls: unknown[] = [];
			api.registerBackgroundWorkProvider({
				name: "ctx",
				reconcile: (context) => {
					calls.push(context);
				},
				listActiveWork: (context) => {
					calls.push(context);
					return [];
				},
			});
			api.snapshotBackgroundWork(["/sessions/a.jsonl", "uuid-1"], 42);
			return calls;
		});
		const context = { sessionId: "/sessions/a.jsonl", sessionIds: ["/sessions/a.jsonl", "uuid-1"], nowMs: 42 };
		expect(seen[0]).toEqual([context, context]);
		expect(seen[1]).toEqual(seen[0]);
	});

	it("keeps items keyed by any session form, as in a saved session", () => {
		for (const [, writer] of apis) {
			clearRegistry();
			writer.registerBackgroundWorkProvider({
				name: "saved",
				listActiveWork: () => [
					{ id: "by-file", sessionId: "/sessions/a.jsonl" },
					{ id: "by-uuid", sessionId: "uuid-1" },
				],
			});
			for (const [, reader] of apis) {
				expect(reader.snapshotBackgroundWork(["/sessions/a.jsonl", "uuid-1"], 1).items.map((item) => item.id)).toEqual([
					"by-file",
					"by-uuid",
				]);
			}
		}
	});

	it("reports snapshotBackgroundWork signature drift without failing (informational)", () => {
		const signature = (path: string) =>
			readFileSync(new URL(path, import.meta.url), "utf8")
				.split("\n")
				.find((line) => line.includes("function snapshotBackgroundWork"));
		console.info(`[compat] upstream d.ts: ${signature("../node_modules/pi-subagents/src/api/background-work.d.ts")}`);
		console.info(`[compat] ours: ${signature("../src/registry.ts")}`);
	});
});
