# Changelog

All notable changes to this project will be documented in this file.

## [0.0.2] - 2026-10-29

<!-- USER-EDITABLE SECTION START -->
- **The package now ships the pi extension** ([#9](https://github.com/cad0p/pi-background-work/issues/9), [#10](https://github.com/cad0p/pi-background-work/pull/10)): `package.json` declares `pi.extensions` pointing at `src/extension.ts`, so the published tarball carries the extension instead of only the registry: an install of this package as a pi package now gives pi the footer. It renders the session's pending background work as one status line, `⏳ 2 agents · 1 pi-heartbeat`, on `session_start`, on `agent_settled` and on a 1 s timer, writes only when the text changes and clears the line when nothing is pending. UI sessions only.
- **A display-provider registry** ([#10](https://github.com/cad0p/pi-background-work/pull/10)): `registerBackgroundWorkDisplayProvider({ name, describe })` / `listBackgroundWorkDisplayProviders()` let a provider own its segment wording without touching the v1 provider object. Matching is by provider name; validation runs on register and on read; the disposer removes only its own object. A provider that throws, or an item that breaks the rules, shows `<name> ?` — pending work is never shown as finished.
- **Per-provider collection** ([#10](https://github.com/cad0p/pi-background-work/pull/10)): `collectBackgroundWorkSources` runs each provider's `reconcile` and `listActiveWork` in its own guard with a per-call context, so one bad provider costs its own segment instead of the whole line.
- **The compat suite covers unknown item fields** ([#5](https://github.com/cad0p/pi-background-work/issues/5), [#6](https://github.com/cad0p/pi-background-work/pull/6)): both sides must reject an unknown item field the same way, so an upstream field addition cannot pass unnoticed.
- **The probe diffs the file the runtime loads** ([#7](https://github.com/cad0p/pi-background-work/issues/7), [#11](https://github.com/cad0p/pi-background-work/pull/11)): the informational diff snapshots the entry `pi-subagents/background-work` resolves to through the tarball's `exports`, plus the files it imports, instead of a stale source path.
<!-- USER-EDITABLE SECTION END -->

### 🚀 Features

- The background-work footer, a display registry and one status line (closes #9) ([#10](https://github.com/cad0p/pi-background-work/pull/10))

### 🐛 Bug Fixes

- *(probe)* Snapshot the runtime entry and its imports, and share the unknown-field test body (closes #7) ([#11](https://github.com/cad0p/pi-background-work/pull/11))

### 🧪 Testing

- Compat case for unknown item fields; README drops the .d.ts claim (closes #5) ([#6](https://github.com/cad0p/pi-background-work/pull/6))


