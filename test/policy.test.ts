import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crashRecoveryDecision, readBackgroundWorkPolicy } from "../src/policy";

let root: string;
let cwd: string;
let agentDir: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "pi-bgwork-policy-"));
	cwd = join(root, "project");
	agentDir = join(root, "agent");
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	mkdirSync(agentDir, { recursive: true });
});

afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});

function writeUser(content: string): void {
	writeFileSync(join(agentDir, "background-work.json"), content);
}

function writeProject(content: string): void {
	writeFileSync(join(cwd, ".pi", "background-work.json"), content);
}

describe("readBackgroundWorkPolicy", () => {
	it("returns the defaults (30 minutes, 1 crash recovery) when no file exists", () => {
		expect(readBackgroundWorkPolicy({ cwd, agentDir })).toEqual({
			policy: { maxBackgroundWait: 30, maxCrashRecoveries: 1 },
			warnings: [],
		});
	});

	it("reads the user file", () => {
		writeUser(JSON.stringify({ maxBackgroundWait: 5, maxCrashRecoveries: 3 }));
		expect(readBackgroundWorkPolicy({ cwd, agentDir }).policy).toEqual({ maxBackgroundWait: 5, maxCrashRecoveries: 3 });
	});

	it("lets the project file override the user file per key", () => {
		writeUser(JSON.stringify({ maxBackgroundWait: 5, maxCrashRecoveries: 3 }));
		writeProject(JSON.stringify({ maxBackgroundWait: 10 }));
		expect(readBackgroundWorkPolicy({ cwd, agentDir }).policy).toEqual({ maxBackgroundWait: 10, maxCrashRecoveries: 3 });
	});

	it("falls back to the valid user value when the project value is invalid", () => {
		writeUser(JSON.stringify({ maxBackgroundWait: 7 }));
		writeProject(JSON.stringify({ maxBackgroundWait: "soon" }));
		const result = readBackgroundWorkPolicy({ cwd, agentDir });
		expect(result.policy.maxBackgroundWait).toBe(7);
		expect(result.warnings).toEqual([expect.stringMatching(/^Ignoring maxBackgroundWait in .*: must be a finite number greater than 0\.$/)]);
	});

	it("ignores invalid JSON with one warning and keeps the defaults", () => {
		writeUser("{not json");
		const result = readBackgroundWorkPolicy({ cwd, agentDir });
		expect(result.policy).toEqual({ maxBackgroundWait: 30, maxCrashRecoveries: 1 });
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toMatch(/^Ignoring .*background-work\.json: /);
	});

	it("ignores a file whose root is not an object", () => {
		writeUser("[1, 2]");
		const result = readBackgroundWorkPolicy({ cwd, agentDir });
		expect(result.policy.maxCrashRecoveries).toBe(1);
		expect(result.warnings).toEqual([expect.stringMatching(/expected a JSON object/)]);
	});

	it("rejects wrong types and out-of-range values per key, with one warning each", () => {
		writeUser(JSON.stringify({ maxBackgroundWait: 0, maxCrashRecoveries: 1.5 }));
		const result = readBackgroundWorkPolicy({ cwd, agentDir });
		expect(result.policy).toEqual({ maxBackgroundWait: 30, maxCrashRecoveries: 1 });
		expect(result.warnings).toEqual([
			expect.stringMatching(/maxBackgroundWait .*finite number greater than 0/),
			expect.stringMatching(/maxCrashRecoveries .*integer 0 or greater/),
		]);
	});

	it("accepts zero crash recoveries", () => {
		writeUser(JSON.stringify({ maxCrashRecoveries: 0 }));
		expect(readBackgroundWorkPolicy({ cwd, agentDir }).policy.maxCrashRecoveries).toBe(0);
	});

	it("honours PI_CODING_AGENT_DIR when no agentDir is passed", () => {
		writeUser(JSON.stringify({ maxBackgroundWait: 2 }));
		vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
		expect(readBackgroundWorkPolicy({ cwd }).policy.maxBackgroundWait).toBe(2);
	});

	it("expands a leading ~ in PI_CODING_AGENT_DIR", () => {
		const home = join(root, "home");
		mkdirSync(join(home, "agent"), { recursive: true });
		writeFileSync(join(home, "agent", "background-work.json"), JSON.stringify({ maxCrashRecoveries: 4 }));
		vi.stubEnv("HOME", home);
		vi.stubEnv("USERPROFILE", home);
		vi.stubEnv("PI_CODING_AGENT_DIR", "~/agent");
		expect(readBackgroundWorkPolicy({ cwd }).policy.maxCrashRecoveries).toBe(4);
	});

	it("reads the files on every call so edits apply without a restart", () => {
		expect(readBackgroundWorkPolicy({ cwd, agentDir }).policy.maxBackgroundWait).toBe(30);
		writeUser(JSON.stringify({ maxBackgroundWait: 12 }));
		expect(readBackgroundWorkPolicy({ cwd, agentDir }).policy.maxBackgroundWait).toBe(12);
	});
});

describe("crashRecoveryDecision", () => {
	const policy = { maxBackgroundWait: 30, maxCrashRecoveries: 1 };

	it("triggers a recovery turn up to and including maxCrashRecoveries", () => {
		expect(crashRecoveryDecision(0, policy)).toEqual({ triggerTurn: true });
		expect(crashRecoveryDecision(1, policy)).toEqual({ triggerTurn: true });
	});

	it("asks the user past maxCrashRecoveries, with a count-aware note", () => {
		expect(crashRecoveryDecision(2, policy)).toEqual({
			triggerTurn: false,
			note: "interrupted twice by a crash; ask the user before resuming",
		});
		expect(crashRecoveryDecision(3, policy)).toEqual({
			triggerTurn: false,
			note: "interrupted 3 times by a crash; ask the user before resuming",
		});
	});

	it("uses 'once' for one interruption when zero recoveries are allowed", () => {
		expect(crashRecoveryDecision(0, { ...policy, maxCrashRecoveries: 0 })).toEqual({ triggerTurn: true });
		expect(crashRecoveryDecision(1, { ...policy, maxCrashRecoveries: 0 })).toEqual({
			triggerTurn: false,
			note: "interrupted once by a crash; ask the user before resuming",
		});
	});
});
