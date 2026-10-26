# @cad0p/pi-background-work

Zero-dependency TypeScript implementation of the pi-subagents background-work registry, protocol v1, plus two owner policies (`maxBackgroundWait`, crash recovery) and a daily upstream compatibility probe.

## Credit

The background-work protocol and the ported code are by Nico Bailon (MIT), from [pi-subagents](https://github.com/nicobailon/pi-subagents). The provider API is documented in his [Background-work provider API](https://github.com/nicobailon/pi-subagents/blob/v0.83.0/docs/extension-api.md#background-work-provider-api) section. The port tracks pi-subagents 0.83.0. See [LICENSE](./LICENSE).

## Install

```sh
npm install @cad0p/pi-background-work
```

The entry point is TypeScript (`./src/index.ts`). Load it through a TypeScript-aware loader such as the jiti loader pi uses. Plain `node` cannot import it.

## Providers

A provider reports background work that is still pending for a session. Register one provider per package per process. Registering a name that already exists replaces the earlier provider.

```ts
import { registerBackgroundWorkProvider } from "@cad0p/pi-background-work";

const jobs = new Map<string, { id: string; sessionId: string }>();

registerBackgroundWorkProvider({
  name: "my-jobs",
  wakeChannels: ["my-jobs:done"],
  listActiveWork(context) {
    const forms = context?.sessionIds ?? [];
    return [...jobs.values()].filter((job) => forms.includes(job.sessionId));
  },
});
```

These are this package's recommendations for providers:

1. Re-register on `session_start` with reason `reload`. On other starts, register only if the name is absent.
2. Entries in shared state carry a protocol version. Read the current version and the one before it, and ignore others.
3. Item ids are unique per session key across activations. A duplicate `(provider, sessionId, id)` makes every snapshot throw.
4. `listActiveWork` must not throw.

## Consumers

```ts
import { sessionIdentityForms, snapshotBackgroundWork } from "@cad0p/pi-background-work";

const { providers, items } = snapshotBackgroundWork(sessionIdentityForms(sessionManager));
```

`snapshotBackgroundWork(sessionIds, nowMs?)` is all-or-nothing. A throwing provider, a malformed registry, or a duplicate id throws for the whole snapshot. To tolerate a bad provider, list each provider from `listBackgroundWorkProviders()` inside its own `try`, and warn with the provider name. Listing providers yourself skips the reconcile calls, item validation, duplicate checks and session filtering that `snapshotBackgroundWork` performs. Validate and filter the items yourself if you use this form.

An empty snapshot means nothing is pending now. A provider may remove its item shortly before its wake arrives, so confirm an empty result with a second snapshot before treating the work as finished.

## Session ids

Key items by `sessionKey(sm)`, which returns the session uuid. Upstream consumers may pass the session file path as `sessionId` in the context, so `listActiveWork` must match any entry of `context.sessionIds`, not only `context.sessionId`. `sessionIdentityForms(sm)` returns the uuid and the file path (when there is one), without duplicates.

## Policy

`readBackgroundWorkPolicy({ cwd, agentDir? })` returns `{ policy, warnings }`. Each file is a JSON object:

```json
{ "maxBackgroundWait": 30, "maxCrashRecoveries": 1 }
```

- `maxBackgroundWait`: minutes, a finite number greater than 0. Default `30`.
- `maxCrashRecoveries`: an integer 0 or greater. Default `1`.

Files are read in this order: `<cwd>/.pi/background-work.json` (project), then `<agentDir>/background-work.json`. `agentDir` is `PI_CODING_AGENT_DIR` when set, otherwise `~/.pi/agent`. A `PI_CODING_AGENT_DIR` of `~` or starting with `~/` is expanded to the home directory. Other forms are not expanded: `~\` on Windows and `file://` URLs, which pi's own path normalization handles. Per key, the first valid value wins: project, then user, then default. Invalid JSON or an invalid value is ignored and reported in `warnings`. Nothing throws. Files are read on every call, so edits apply without a restart.

## Crash recovery

```ts
import { crashRecoveryDecision, readBackgroundWorkPolicy } from "@cad0p/pi-background-work";

const { policy } = readBackgroundWorkPolicy({ cwd });
const decision = crashRecoveryDecision(consecutiveInterruptions, policy);
```

`triggerTurn` is `true` while `consecutiveInterruptions <= maxCrashRecoveries`. Beyond that it is `false`, and `note` reads "interrupted once by a crash; ask the user before resuming" for one interruption, "interrupted twice by a crash; ask the user before resuming" for two, and "interrupted N times by a crash; ask the user before resuming" otherwise.

Convention: count consecutive crash interruptions per item. Persist that a recovery wake was delivered before delivering it, so each crash wakes at most once per item.

## Compatibility

`test/compat.test.ts` loads pi-subagents' published `pi-subagents/background-work` (a devDependency pinned to exact `0.83.0`) and this package in one process. It checks that each side sees the other's providers and items, that invalid providers and caps fail the same way on both, and that `listActiveWork` and `reconcile` receive the same context shape. The `.d.ts` signature drift from upstream is reported informationally, not asserted.

The upstream `waitForSubagents` cases are not ported. They are listed in `test/registry.test.ts`.

`.github/workflows/upstream-probe.yml` runs daily and on push to `main`. It installs the latest published `pi-subagents` on the runner only and runs the compat test. A version that passes is cached and not retested. A failure opens, or comments on, one issue labelled `upstream-probe`. A later pass closes it.

## Development

```sh
pnpm install
pnpm run lint
pnpm run typecheck
pnpm run test
```
