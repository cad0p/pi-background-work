import { describe, expect, it } from "vitest";
import { type SessionIdentitySource, sessionIdentityForms, sessionKey } from "../src/session";

function manager(id: string, file: string | undefined): SessionIdentitySource {
	return { getSessionId: () => id, getSessionFile: () => file };
}

describe("session identity", () => {
	it("keys ownership by the session uuid", () => {
		expect(sessionKey(manager("uuid-1", "/sessions/a.jsonl"))).toBe("uuid-1");
	});

	it("lists the uuid first, then the file, without duplicates or undefined", () => {
		expect(sessionIdentityForms(manager("uuid-1", "/sessions/a.jsonl"))).toEqual(["uuid-1", "/sessions/a.jsonl"]);
		expect(sessionIdentityForms(manager("uuid-1", undefined))).toEqual(["uuid-1"]);
		expect(sessionIdentityForms(manager("uuid-1", "uuid-1"))).toEqual(["uuid-1"]);
	});
});
