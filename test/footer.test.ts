import { describe, expect, it, vi } from "vitest";
import type { BackgroundWorkDisplayProvider, DescribeContext } from "../src/display";
import {
	type BackgroundWorkSource,
	composeFooterText,
} from "../src/footer";
import type { BackgroundWorkItem } from "../src/registry";

const CONTEXT: DescribeContext = { sessionId: "session-a", sessionIds: ["session-a", "/sessions/a.jsonl"], nowMs: 42 };
const PREFIX = "⏳ ";
const SEPARATOR = " · ";

function itemsOf(name: string, count: number): BackgroundWorkItem[] {
	return Array.from({ length: count }, (_, index) => ({ id: `${name}-${index}`, sessionId: "session-a" }));
}

function source(name: string, count: number): BackgroundWorkSource {
	return { name, items: itemsOf(name, count) };
}

function display(name: string, describeText: BackgroundWorkDisplayProvider["describe"]): BackgroundWorkDisplayProvider {
	return { name, describe: describeText };
}

describe("composeFooterText", () => {
	it("is undefined without pending work and calls no describe for a provider with no items", () => {
		expect(composeFooterText([], [], CONTEXT)).toBeUndefined();
		const describeText = vi.fn(() => "never");
		expect(composeFooterText([{ name: "patty", items: [] }], [display("patty", describeText)], CONTEXT)).toBeUndefined();
		expect(describeText).not.toHaveBeenCalled();
	});

	it("uses describe text as is, in v1 provider order, matching by name", () => {
		const sources: BackgroundWorkSource[] = [source("patty", 1), source("demo", 2)];
		const displays = [display("demo", () => "2 demo jobs"), display("patty", () => "1 agent (waiting)")];
		expect(composeFooterText(sources, displays, CONTEXT)).toBe(`${PREFIX}1 agent (waiting)${SEPARATOR}2 demo jobs`);
	});

	it("falls back to the item count for a missing, empty, null or throwing describe, and to ? for a failed provider", () => {
		const sources: BackgroundWorkSource[] = [source("patty", 2), source("demo", 1)];
		const fallbacks = [() => null, () => undefined, () => "", () => "   ", () => { throw new Error("boom"); }];
		for (const describeText of fallbacks) {
			const displays = [display("patty", describeText), display("demo", () => "1 demo")];
			expect(composeFooterText(sources, displays, CONTEXT)).toBe(`${PREFIX}2 patty${SEPARATOR}1 demo`);
		}

		const describeFailed = vi.fn(() => "should not run");
		const failed: BackgroundWorkSource[] = [{ name: "patty", failed: true }, source("demo", 1)];
		const failedDisplays = [display("patty", describeFailed), display("demo", () => "1 demo")];
		expect(composeFooterText(failed, failedDisplays, CONTEXT)).toBe(`${PREFIX}patty ?${SEPARATOR}1 demo`);
		expect(describeFailed).not.toHaveBeenCalled();
	});

	it("passes every item of one provider to describe in a single call", () => {
		const patty = itemsOf("patty", 3);
		const describeText = vi.fn(() => "3 agents");
		expect(composeFooterText([{ name: "patty", items: patty }], [display("patty", describeText)], CONTEXT)).toBe(
			`${PREFIX}3 agents`,
		);
		expect(describeText).toHaveBeenCalledTimes(1);
		expect(describeText).toHaveBeenCalledWith(patty, CONTEXT);
	});

	it("caps a segment at 48 graphemes, cutting at the last separator in [32, 47)", () => {
		const atForty = "a".repeat(40) + " " + "b".repeat(19);
		const noSeparator = "a".repeat(60);
		const lateSeparator = "a".repeat(50) + " " + "b".repeat(9);
		for (const [text, expected] of [
			[atForty, "a".repeat(40) + "…"],
			[noSeparator, "a".repeat(47) + "…"],
			[lateSeparator, "a".repeat(47) + "…"],
		] as const) {
			const displays = [display("patty", () => text), display("demo", () => "1 demo")];
			const sources: BackgroundWorkSource[] = [source("patty", 1), source("demo", 1)];
			expect(composeFooterText(sources, displays, CONTEXT)).toBe(`${PREFIX}${expected}${SEPARATOR}1 demo`);
		}
	});

	it("never splits a ZWJ sequence, a flag or a combining mark", () => {
		const family = "\u{1f468}\u{200d}\u{1f469}\u{200d}\u{1f467}\u{200d}\u{1f466}";
		const flag = "\u{1f1ee}\u{1f1f9}";
		const combining = "e\u0301";
		for (const grapheme of [family, flag, combining]) {
			const text = "a".repeat(46) + grapheme + "b".repeat(20);
			const expected = "a".repeat(46) + grapheme + "…";
			expect(composeFooterText([source("patty", 1)], [display("patty", () => text)], CONTEXT)).toBe(`${PREFIX}${expected}`);
		}
	});

	it("returns a segment of exactly 48 graphemes unchanged and cuts a 49th", () => {
		const at48 = "a".repeat(48);
		const at49 = "a".repeat(48) + "b";
		const displays = [display("patty", () => at48), display("demo", () => at49)];
		const sources: BackgroundWorkSource[] = [source("patty", 1), source("demo", 1)];
		expect(composeFooterText(sources, displays, CONTEXT)).toBe(PREFIX + at48 + SEPARATOR + "a".repeat(47) + "…");
	});

	it("never keeps the failure marker out of a capped segment", () => {
		// A 46-grapheme name plus " ?" fits the 48 exactly and is kept whole.
		expect(composeFooterText([{ name: "n".repeat(46), failed: true }], [], CONTEXT)).toBe(PREFIX + "n".repeat(46) + " ?");
		// A longer one is capped to 45 graphemes plus the ellipsis, then the marker: 48 in total.
		expect(composeFooterText([{ name: "n".repeat(60), failed: true }], [], CONTEXT)).toBe(PREFIX + "n".repeat(45) + "… ?");
		const long = composeFooterText([{ name: "n".repeat(60), failed: true }], [], CONTEXT);
		const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(long!.slice(PREFIX.length))];
		expect(graphemes).toHaveLength(48);
	});

	it("loses only the throwing provider's segment when its display name getter throws", () => {
		const hostile = {
			get name(): string {
				throw new Error("boom");
			},
			describe: () => "never",
		} as unknown as BackgroundWorkDisplayProvider;
		const displays = [hostile, display("demo", () => "2 demo jobs")];
		expect(composeFooterText([source("patty", 1), source("demo", 2)], displays, CONTEXT)).toBe(PREFIX + "1 patty" + SEPARATOR + "2 demo jobs");
	});

	it("trims describe output", () => {
		expect(composeFooterText([source("demo", 1)], [display("demo", () => "  hi  ")], CONTEXT)).toBe(PREFIX + "hi");
	});
});
