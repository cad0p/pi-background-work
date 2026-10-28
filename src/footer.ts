/*
 * Composition of the footer line: one source per v1 provider, one segment per
 * source, ` · ` between them. Pure; the extension calls it once per tick.
 */

import type { BackgroundWorkDisplayProvider, DescribeContext } from "./display";
import type { BackgroundWorkItem } from "./registry";

export const BACKGROUND_WORK_STATUS_KEY = "bg-work";
export const BACKGROUND_WORK_FOOTER_PREFIX = "⏳ ";
const SEGMENT_SEPARATOR = " · ";
const FAILED_SUFFIX = " ?";
/** Longest segment, in graphemes, the ellipsis included. */
const MAX_SEGMENT = 48;
/** A cut may not shorten a segment below this many graphemes. */
const MIN_CUT = 32;

/** One entry per v1 provider, in v1's provider order. */
export type BackgroundWorkSource = { name: string; items: readonly BackgroundWorkItem[] } | { name: string; failed: true };

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function graphemesOf(text: string): string[] {
	return [...segmenter.segment(text)].map((entry) => entry.segment);
}

/**
 * Cap the length in graphemes: cut at the last space or comma in
 * [MIN_CUT, MAX_SEGMENT - 1), else at MAX_SEGMENT - 1, and add one ellipsis.
 * Graphemes are not columns, so this bounds length, not display width.
 */
function capSegment(text: string): string {
	const graphemes = graphemesOf(text);
	if (graphemes.length <= MAX_SEGMENT) return text;
	for (let index = MAX_SEGMENT - 1; index >= MIN_CUT; index--) {
		const grapheme = graphemes[index];
		if (grapheme === " " || grapheme === ",") return `${graphemes.slice(0, index).join("").trimEnd()}…`;
	}
	return `${graphemes.slice(0, MAX_SEGMENT - 1).join("")}…`;
}

function describeSource(
	source: { name: string; items: readonly BackgroundWorkItem[] },
	displays: readonly BackgroundWorkDisplayProvider[],
	context: DescribeContext,
): string {
	const display = displays.find((candidate) => candidate.name === source.name);
	if (display !== undefined) {
		try {
			const text = display.describe(source.items, context);
			if (typeof text === "string" && text.trim() !== "") return capSegment(text);
		} catch {}
	}
	return capSegment(`${source.items.length} ${source.name}`);
}

/** Build the status text, or `undefined` when no provider has pending work. */
export function composeFooterText(
	sources: readonly BackgroundWorkSource[],
	displays: readonly BackgroundWorkDisplayProvider[],
	context: DescribeContext,
): string | undefined {
	const segments: string[] = [];
	for (const source of sources) {
		if ("failed" in source) {
			segments.push(capSegment(`${source.name}${FAILED_SUFFIX}`));
			continue;
		}
		if (source.items.length === 0) continue;
		segments.push(describeSource(source, displays, context));
	}
	if (segments.length === 0) return undefined;
	return `${BACKGROUND_WORK_FOOTER_PREFIX}${segments.join(SEGMENT_SEPARATOR)}`;
}
