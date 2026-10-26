/** Structural view of a Pi SessionManager. No pi import. */
export interface SessionIdentitySource {
	getSessionId(): string;
	getSessionFile(): string | undefined;
}

/** The key that owns work started by this session (the uuid). */
export function sessionKey(sessionManager: SessionIdentitySource): string {
	return sessionManager.getSessionId();
}

/** Every identity form of a session, uuid first, for `snapshotBackgroundWork`. */
export function sessionIdentityForms(sessionManager: SessionIdentitySource): string[] {
	const forms = [sessionManager.getSessionId(), sessionManager.getSessionFile()];
	return [...new Set(forms.filter((form): form is string => form !== undefined && form !== ""))];
}
