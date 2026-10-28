import { afterEach, describe, expect, it } from "vitest";
import {
	BACKGROUND_WORK_DISPLAY_KEY,
	type BackgroundWorkDisplayProvider,
	listBackgroundWorkDisplayProviders,
	registerBackgroundWorkDisplayProvider,
} from "../src/display";

const SLOT = Symbol.for(BACKGROUND_WORK_DISPLAY_KEY);

afterEach(() => {
	Reflect.deleteProperty(globalThis, SLOT);
});

function display(name: unknown, describeText: unknown = () => "work"): BackgroundWorkDisplayProvider {
	return { name, describe: describeText } as BackgroundWorkDisplayProvider;
}

describe("background-work display registry", () => {
	it("lists registrations, replaces by name, and disposes only its own object", () => {
		const first = display("patty", () => "first");
		const disposeFirst = registerBackgroundWorkDisplayProvider(first);
		expect(listBackgroundWorkDisplayProviders()).toEqual([first]);

		const replacement = display("patty", () => "replacement");
		const disposeReplacement = registerBackgroundWorkDisplayProvider(replacement);
		disposeFirst();
		expect(listBackgroundWorkDisplayProviders()).toEqual([replacement]);

		disposeReplacement();
		expect(listBackgroundWorkDisplayProviders()).toEqual([]);
	});

	it("validates on register, naming the field", () => {
		expect(() => registerBackgroundWorkDisplayProvider(display(""))).toThrow(/provider name must be a non-empty string/);
		expect(() => registerBackgroundWorkDisplayProvider(display(" patty"))).toThrow(/provider name must be a non-empty string/);
		expect(() => registerBackgroundWorkDisplayProvider(display("pat\0ty"))).toThrow(/provider name must not contain NUL/);
		expect(() => registerBackgroundWorkDisplayProvider(display("a".repeat(129)))).toThrow(/provider name must be at most 128/);
		expect(() => registerBackgroundWorkDisplayProvider({ name: "patty" } as BackgroundWorkDisplayProvider)).toThrow(
			/must expose describe\(\)/,
		);
		expect(() =>
			registerBackgroundWorkDisplayProvider({ name: "patty", describe: () => "x", extra: true } as unknown as BackgroundWorkDisplayProvider),
		).toThrow(/unknown fields: extra/);
		for (let index = 0; index < 100; index++) registerBackgroundWorkDisplayProvider(display(`p${index}`));
		expect(() => registerBackgroundWorkDisplayProvider(display("p100"))).toThrow(/at most 100 providers/);
		expect(() => registerBackgroundWorkDisplayProvider(display("p0"))).not.toThrow();
	});

	it("validates on read, naming the field", () => {
		const providers = new Map<unknown, unknown>([
			["broken", { name: "broken" }],
			["patty", display("mismatch")],
		]);
		Reflect.set(globalThis, SLOT, { version: 1, providers });
		expect(() => listBackgroundWorkDisplayProviders()).toThrow(/must expose describe\(\)/);

		providers.set("broken", display("mismatch"));
		expect(() => listBackgroundWorkDisplayProviders()).toThrow(/key 'broken' does not match provider name 'mismatch'/);
	});

	it("leaves a foreign-version slot intact and refuses to read or write it", () => {
		const foreign = { version: 2, providers: new Map() };
		Reflect.set(globalThis, SLOT, foreign);
		expect(() => registerBackgroundWorkDisplayProvider(display("patty"))).toThrow(/Unsupported background-work display registry/);
		expect(() => listBackgroundWorkDisplayProviders()).toThrow(/Unsupported background-work display registry/);
		expect(Reflect.get(globalThis, SLOT)).toBe(foreign);
	});
});
