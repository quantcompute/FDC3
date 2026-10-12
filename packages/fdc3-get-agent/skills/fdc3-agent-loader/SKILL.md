---
name: fdc3-agent-loader
description: >-
  Use when you need the loader directly rather than through the `@finos/fdc3` rollup — bundling only the
  connection code, or understanding and debugging how an application actually finds its desktop agent:
  `getAgent()` parameters and defaults, module-scope promise caching, the preload-then-post-message
  discovery chain (`DesktopAgentPreloadLoader`, `PostMessageLoader`, `HelloHandler`,
  `IdentityValidationHandler`, `FailoverHandler`, the `Loader` interface), identity validation and
  `AccessDenied`, the SessionStorage reconnection record, the deprecated `fdc3Ready()` 20-second wrapper,
  the injected Channel Selector and Intent Resolver UIs (`AbstractUIComponent` and the `Default*`/`Null*`
  pairs), `NoopAppSupport`, and the Content-Security-Policy consequences of the iframes this loader injects.
  Not for ordinary application usage of the rollup (see `fdc3-app-integration`), not for authoring App
  Directory records (see `fdc3-appd-authoring`), and not for changing the API itself (see `fdc3-schema-change`).
license: Apache-2.0
metadata:
  fdc3-package: '@finos/fdc3-get-agent'
  fdc3-package-version: '3.0.0-beta.1'
---

# The FDC3 desktop agent loader

This skill ships inside the `@finos/fdc3-get-agent` package tarball and describes the API of the version it
ships with — `3.0.0-beta.1`. The `metadata.fdc3-package-version` above is the record of which version that is:
when the monorepo bumps the shared version, this file has to be reviewed, and the `fdc3-version-bump` skill's
`scripts/check-skill-versions.mjs` is what reports it as stale.

Everything below is drawn from the sources in this repository, not from general knowledge of FDC3. Where the
published documentation and the implementation disagree, the implementation is what runs and the disagreement
is called out.

## What the package is

`@finos/fdc3-get-agent` is the discovery and connection layer of the JavaScript API. `@finos/fdc3` re-exports
only `getAgent` and `fdc3Ready` from it (`packages/fdc3/src/index.ts:24`), so an app normally gets those two
indirectly; the UI classes below reach consumers only by importing this package directly. This package is for
the app that wants the loader on its own, or for anyone who has to reason about how an app finds its agent.

`packages/fdc3-get-agent/src/index.ts` is a small module. It exports the `getAgent` function from
`./strategies/getAgent.js`, the deprecated `fdc3Ready` wrapper defined in the same file, and five UI classes:
`AbstractUIComponent`, `DefaultDesktopAgentChannelSelector`, `DefaultDesktopAgentIntentResolver`,
`NullChannelSelector`, `NullIntentResolver`. Nothing else from the package surface — the strategy classes,
the session-storage helpers and the messaging adapter are internal.

The package is ESM-only (`"type": "module"`, `main: dist/src/index.js`, `sideEffects: false`) and is pinned to
the same version as the rest of the API packages it depends on (`@finos/fdc3-standard`,
`@finos/fdc3-context`, `@finos/fdc3-schema`, `@finos/fdc3-agent-proxy`).

### The README's title is wrong

`packages/fdc3-get-agent/README.md` opens with `# FDC3 Agent Proxy` on line 1. That is a copy-paste from the
sibling `@finos/fdc3-agent-proxy` package — the desktop-agent proxy is a _different_ package that this one
consumes; `@finos/fdc3-get-agent` is the loader/discovery entry point. The README body is otherwise about
`getAgent` from this package, so the H1 is the only thing that is mislabelled.

## `getAgent()`

`getAgent()` returns `Promise<DesktopAgent>` and is the one function most consumers use. Its exported type is
`GetAgentType`, imported from `@finos/fdc3-standard`:

```ts
const fdc3: DesktopAgent = await getAgent();
```

Do not copy the broken usage snippet in the sibling rollup README (`packages/fdc3/README.md:22`,
`const fdc3 = getAgent();` followed by `fdc3.raiseIntent(...)`): without `await`, `fdc3` is a `Promise` and every
method call on it fails. This package's own README is correct — it uses `await getAgent()`. Treat
`await getAgent()` or `.then` as the only correct form.

### Parameters

The defaults below are the `DEFAULT_OPTIONS` object in `getAgent.ts` lines 211–217, merged with the caller's
`params` so a supplied value always wins. `timeoutMs` is taken from `DEFAULT_GETAGENT_TIMEOUT_MS` in
`src/strategies/Timeouts.ts`, which is `1000`.

| Parameter           | Default                           | Consequence                                                                                                                                                                                                          |
| ------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `timeoutMs`         | `1000`                            | Milliseconds allowed for _discovery_ before the loaders reject or `failover` runs. The timeout is cancelled as soon as an agent is detected; the identity-validation and setup steps that follow are **outside** it. |
| `identityUrl`       | `globalThis.window.location.href` | The URL sent to a web agent to establish identity. The code sets this default when it is absent (`getAgent.ts` lines 45–47). It MUST match the app's origin (scheme, host, port) or the agent ignores it.            |
| `channelSelector`   | `true`                            | Whether an injected Channel Selector UI is wanted. MAY be ignored by preload implementations.                                                                                                                        |
| `intentResolver`    | `true`                            | Whether an injected Intent Resolver UI is wanted. MAY be ignored by preload implementations.                                                                                                                         |
| `dontSetWindowFdc3` | `false`                           | Leave `window.fdc3` untouched and suppress the `fdc3Ready` event when true.                                                                                                                                          |
| `failover`          | `undefined`                       | Async fallback called only when normal discovery fails or times out. MUST resolve to a `DesktopAgent` or a `WindowProxy` of a window/iframe that provides one.                                                       |
| `logLevels`         | connection `INFO`, proxy `WARN`   | Per-channel console logging. The `getAgent` `Logger` defaults to `LogLevel.INFO` (`src/util/Logger.ts:15`); the proxy level is passed through to `DesktopAgentProxy`.                                                |

Passing `logLevels.connection` calls `Logger.setLogLevel` before discovery starts (`getAgent.ts` lines 37–39),
which is how you turn on the `FDC3 getAgent:` diagnostic output.

### On success

`getAgent` wraps the discovery promise in `handleSetWindowFdc3` (`getAgent.ts` lines 224–230). Only when
`dontSetWindowFdc3` is not set **and** `window.fdc3` is not already present does it assign the agent to
`window.fdc3` and dispatch a `fdc3Ready` event on `window`; if either condition fails — the option is set, or
`window.fdc3` already exists — the assignment is skipped. Both are for backwards compatibility with the 2.x
pattern; an app that only needs the agent should use the returned value.

### Promise caching

`theAgentPromise` is a module-scope variable (`getAgent.ts` line 28). The first call initialises it; every
later call returns the same promise and **ignores its parameters**:

```ts
if (!theAgentPromise) {
  theAgentPromise = initAgentPromise(options).then(handleSetWindowFdc3);
}
return theAgentPromise;
```

This is deliberate — it lets unrelated modules and components call `getAgent()` freely and share one
connection. It also means that after a success, a second call cannot reconfigure the connection. If the first
call rejects, the cached promise is cleared by `clearAgentPromise` — but only via a `setTimeout(..., 500)`
(`CLEAR_PROMISE_DELAY`, `getAgent.ts` line 30), so a retry issued immediately in a rejection handler may still
see the old rejected promise. That 500 ms delay is an implementation detail the published reference page does
not mention; it says only that the promise "is cleared".

Note also that the failover failure path (`getAgent.ts` lines 160–166) throws without scheduling a clear, so a
failed failover does not automatically re-arm discovery.

## The discovery strategy chain

Discovery is not a single mechanism. `initAgentPromise` (`getAgent.ts` lines 36–176) picks a list of strategies
— objects implementing the `Loader` interface — based on any persisted SessionStorage record, runs them, and
settles on the first fulfilled result.

The `Loader` interface (`src/strategies/Loader.ts`) is deliberately small:

| Member         | Purpose                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `get(options)` | Resolves to a `DesktopAgentSelection` (the agent plus the details to persist) or rejects with an `AgentError` value. |
| `cancel()`     | Tears down listeners and timers; also rejects an in-flight `get` with `AgentNotFound`.                               |
| `name`         | Used only in debug logging.                                                                                          |

`DesktopAgentSelection.details` carries exactly what must be stored: `agentType`, `identityUrl`, `actualUrl`,
`appId`, `instanceId`, `instanceUuid` and an optional `agentUrl`.

### Which strategies run

Without persisted data, the two strategies are `[new DesktopAgentPreloadLoader(), new PostMessageLoader(options)]`
and run in parallel (`getAgent.ts` lines 70–72). When a persisted record exists, the recorded `agentType` narrows
the list so the app reconnects the same way (lines 51–69):

| Persisted `agentType`     | Strategy list                                      |
| ------------------------- | -------------------------------------------------- |
| `PRELOAD`                 | `[DesktopAgentPreloadLoader]`                      |
| `PROXY_URL`               | `[PostMessageLoader(options, persisted.agentUrl)]` |
| `PROXY_PARENT`            | `[PostMessageLoader(options)]`                     |
| `FAILOVER`                | `[]` (failover only)                               |
| anything else / no record | both loaders                                       |

When one strategy resolves, the others are cancelled first (`getAgent.ts` lines 74–91) — the winner calls
`cancel()` on every sibling, then `Promise.allSettled` picks the first fulfilled result. Errors are then
filtered (lines 123–173): any rejection that is **not** `AgentError.AgentNotFound` is rethrown as an `Error`
whose message is that value, which is why a lost identity race surfaces as `AccessDenied` rather than a generic
failure.

### `DesktopAgentPreloadLoader` — the `window.fdc3` path

This loader handles a preload: a container-injected agent that has published itself at `globalThis.window.fdc3`
(`src/strategies/DesktopAgentPreloadLoader.ts`). It checks for `window.fdc3` immediately; failing that it both
listens for the `fdc3Ready` event and polls every 100 ms (`poll`, lines 26–35), until `timeoutMs` elapses and it
rejects with `AgentNotFound`. On discovery it reads `getInfo()` and builds a selection with
`agentType: Preload`; because a preload issues no `instanceUuid`, `instanceId` and `instanceUuid` are both set
from `appMetadata.instanceId` (lines 47–57).

### `PostMessageLoader` — the web-connection path

`src/strategies/PostMessageLoader.ts` is the Web Connection Protocol client. Its `get()`:

1. Starts a `timeoutMs` timer that rejects with `AgentNotFound` (`get` lines 72–78).
2. Builds a `HelloHandler` and begins `listenForHelloResponses()`.
3. If a `previousUrl` was supplied (persisted `agentUrl`), it skips window discovery and calls
   `openFrame(previousUrl)` immediately. Otherwise it walks the window's `opener`/`parent` chain via
   `collectPossibleTargets` and sends `WCP1Hello` to each candidate with `targetOrigin: '*'` — the agent's origin
   is unknown at that point (`PostMessageLoader.ts` lines 16–35 and 91–99).
4. On a `WCP2LoadUrl` response, `HelloHandler.openFrame` injects a hidden iframe (id
   `fdc3-communications-embedded-iframe`, name `FDC3 Communications`) and hellos its `contentWindow`
   (`HelloHandler.ts` lines 70–104).
5. On a `WCP3Handshake`, the `MessagePort` is extracted, the initial timeout is cleared, and
   `IdentityValidationHandler` runs `WCP4ValidateAppIdentity` / `WCP5…` before `createDesktopAgentAPI` builds the
   proxy (`PostMessageLoader.ts` lines 106–160).

`HelloHandler` filters every incoming message by `meta.connectionAttemptUuid` (a `uuidv4` per connection
attempt), so messages from an unrelated attempt are ignored.

### Failover

If every loader rejects with `AgentNotFound` and a `failover` function was supplied, `FailoverHandler`
(`src/strategies/FailoverHandler.ts`) runs it with a **fresh** `connectionAttemptUuid` (line 30). The result is
classified as a `DesktopAgent` (has `getInfo`) or a `Window` (has `postMessage`): a `DesktopAgent` is passed
straight through with `agentType: Failover`; a `Window` is treated like a post-message target — a `WCP1Hello`
goes to it and the normal identity-validation flow follows. Anything else throws `AgentError.InvalidFailover`,
and a non-function `failover` throws the same. Failover has no timeout of its own; a failover that never
resolves leaves the caller waiting.

## Identity validation, and what an app can do about it

For a web connection the app must prove who it is. `IdentityValidationHandler` sends `WCP4ValidateAppIdentity`
with the `identityUrl` and `actualUrl`, plus the persisted `instanceId`/`instanceUuid` when a record exists
(`IdentityValidationHandler.ts` lines 46–70). The agent matches `identityUrl` against an App Directory record.

| Agent response                             | Loader outcome                                                        |
| ------------------------------------------ | --------------------------------------------------------------------- |
| `WCP5ValidateAppIdentityResponse`          | success — appId, instanceId, instanceUuid are used to build the proxy |
| `WCP5ValidateAppIdentityFailedResponse`    | rejects with `AgentError.AccessDenied` (line 101)                     |
| no response within `ID_VALIDATION_TIMEOUT` | rejects with `AgentError.ErrorOnConnect` (line 130)                   |

`ID_VALIDATION_TIMEOUT` is `5000` ms (`IdentityValidationHandler.ts:18`) and is **additional** to `timeoutMs`:
by then an agent has already been found and the loader is just finishing setup.

An application author cannot override a rejected identity in `getAgent` — the origin of `identityUrl` is checked
against the message source and the agent has final say. What the author _can_ do is fix the directory record
(one AppD record per app, distinguished by path when several apps share an origin) or pass a stable
`identityUrl` when client-side routing makes the live URL unreliable. Authoring those records is the
`fdc3-appd-authoring` skill's job. `AccessDenied` looks like a permissions problem but is usually a directory
problem.

## SessionStorage and why not to touch it

`getAgent` persists the connection so a reload or same-origin navigation reconnects to the same agent and
reclaims the same `instanceId`. `src/sessionStorage/DesktopAgentDetails.ts` builds the key from the real
constant plus the browsing context's name:

```ts
const keyName = DESKTOP_AGENT_SESSION_STORAGE_KEY_PREFIX + '-' + windowName;
```

`DESKTOP_AGENT_SESSION_STORAGE_KEY_PREFIX` is `'fdc3-desktop-agent-details'` (lowercase) — declared in
`packages/fdc3-standard/src/api/GetAgent.ts:206`. So the key is
`fdc3-desktop-agent-details-<window.name>`. If the window has no name, `getAgent` assigns a UUID to
`window.name` first (`sessionKey()`, `DesktopAgentDetails.ts` lines 8–16) and uses that. The value is a JSON
object keyed by `identityUrl`, each entry a `DesktopAgentDetails`: `agentType`, `identityUrl`, `actualUrl`,
optional `agentUrl`, `appId`, `instanceId` and the secret `instanceUuid`.

**The published documentation gets the prefix wrong.** `website/docs/api/ref/GetAgent.md` (lines 221 and 226)
and `website/docs/api/specs/webConnectionProtocol.md` (lines 97 and 277) render it capitalised, as
`FDC3-Desktop-Agent-Details-` / `FDC3-Desktop-Agent-Details`. The implementation constant is lowercase, so any
code that reads that documented key finds nothing.

Applications SHOULD NOT read or write this data. It holds the secret `instanceUuid` used to reclaim the same
instance, and interfering with it produces confusing identity failures. The record also drives strategy
selection on the next load (see the table above), so a corrupted entry changes _how_ the app reconnects.

## `fdc3Ready()` — the deprecated wrapper

`fdc3Ready` is exported from `src/index.ts` and marked `@deprecated Since FDC3 2.2`. It is a thin wrapper over
`getAgent`:

```ts
export function fdc3Ready(waitForMs = DEFAULT_WAIT_FOR_MS): Promise<DesktopAgent> {
  return getAgent({
    timeoutMs: waitForMs,
    dontSetWindowFdc3: false,
    channelSelector: true,
    intentResolver: true,
  });
}
```

`DEFAULT_WAIT_FOR_MS` is `20000` (`src/index.ts:9`). The 20 seconds is _not_ the same as `getAgent`'s discovery
timeout: `getAgent`'s own default is `DEFAULT_GETAGENT_TIMEOUT_MS = 1000`, while `fdc3Ready` passes its
argument straight through as `timeoutMs`. So a bare `fdc3Ready()` discovers for twenty seconds before giving
up — a deliberate legacy behaviour, not a default the rest of the loader shares. And because `fdc3Ready` calls
`getAgent`, it is subject to the same module-scope caching: if something else already called `getAgent`, the
20-second value is ignored.

## Injected user interfaces

When a web connection is established, `createDesktopAgentAPI` (`src/messaging/message-port.ts` lines 40–49)
decides which UIs to wire up:

```ts
const useResolver = cd.handshake.payload.intentResolverUrl && cd.options.intentResolver;
const useSelector = cd.handshake.payload.channelSelectorUrl && cd.options.channelSelector;
```

A `Default…` variant is used whenever the handshake supplies a **truthy** value for the field **and** the
corresponding `getAgent` option is true; otherwise the `Null…` variant is used. Truthy means a URL string
**or** the boolean `true` — the WCP3 handshake schema allows each of `intentResolverUrl` /
`channelSelectorUrl` to be either (`WCP3Handshake.schema.json`), and the constructors receive the handshake
value only after `string()` maps booleans to `null`, so a `true` selects the `Default…` UI at the project's
own reference URL rather than being passed through as a bogus one. `NullIntentResolver` and
`NullChannelSelector` are no-op implementations of `IntentResolver` / `ChannelSelector` whose methods do
nothing, so when the field is absent or falsy, intent resolution and channel selection fall back to the agent
without any injected UI. The protocol prose documents exactly this: setting the fields to `true` makes
`getAgent()` use its default reference-UI URLs.

The classes this package ships:

| Class                                | Role                                                                                                                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AbstractUIComponent`                | Base class implementing `Connectable`. Creates the hidden container + iframe, waits for a `Fdc3UserInterfaceHello`, then keeps a `MessagePort` open. Implements the restyling protocol. |
| `DefaultDesktopAgentChannelSelector` | Implements `ChannelSelector`; posts `Fdc3UserInterfaceChannels` to the iframe and turns `Fdc3UserInterfaceChannelSelected` back into a callback.                                        |
| `DefaultDesktopAgentIntentResolver`  | Implements `IntentResolver`; posts `Fdc3UserInterfaceResolve` and resolves `chooseIntent` from the user's `Fdc3UserInterfaceResolveAction`.                                             |
| `NullChannelSelector`                | No-op `ChannelSelector` used when no injected selector is in use.                                                                                                                       |
| `NullIntentResolver`                 | No-op `IntentResolver` used when no injected resolver is in use.                                                                                                                        |

Both `Default*` constructors fall back to `DEFAULT_UI_ROOT_URL` (`https://fdc3.finos.org/toolbox/fdc3-reference-ui/`,
`AbstractUIComponent.ts:34`) plus `channel_selector.html` or `intent_resolver.html` when the passed URL is
nullish. `AbstractUIComponent.connect()` is deliberately _not_ awaited with the agent connection: it returns
`Promise.resolve()` immediately, because a CSP that blocks the iframe must not block the agent connection.
After the proxy is created, `populateChannelSelector` seeds the selector with the current user channel and the
list of user channels (`message-port.ts` lines 76–80), and `handleDisconnectOnPageHide` disconnects the
`MessagePort` (sending `WCP6Goodbye`) on a non-persisted `pagehide`.

## `NoopAppSupport`, and methods a web connection may not have

`src/apps/NoopAppSupport.ts` defines a `NoopAppSupport` that extends `DefaultAppSupport` and overrides
`getAppMetadata` to return just `{ appId: app.appId }`. It exists as the shape a connection uses when app
metadata is not available over the wire. Note that it is **not currently referenced anywhere in the package** —
`createDesktopAgentAPI` constructs `DefaultAppSupport` (`message-port.ts:56`), and `NoopAppSupport` is neither
exported from `index.ts` nor imported elsewhere in `packages/`. Treat it as an available-but-unwired support
class rather than behaviour you will observe.

More broadly, a desktop agent reached over a web connection does not necessarily implement every
`DesktopAgent` method. In particular the User Channel membership APIs (`joinUserChannel`, `getCurrentChannel`,
`leaveCurrentChannel`) are optional: check `getInfo().optionalFeatures.UserChannelMembershipAPIs` before
calling them rather than feature-detecting by `typeof`.

## Content-Security-Policy

This loader may inject hidden iframes into the application window: the communications/adaptor iframe
(`HelloHandler.openFrame`, id `fdc3-communications-embedded-iframe`), plus a Channel Selector and/or Intent
Resolver frame if those UIs are in use. A CSP that does not allow those frames produces a connection that
half-works — the agent is found but a resolver or selector never appears. Allow the agent's and UI
implementations' domains in `frame-src`, `child-src` and `default-src`, including `fdc3.finos.org` where the
reference UIs are served from.

## How this differs from `fdc3-app-integration`

The `fdc3-app-integration` skill shipped by `@finos/fdc3` is about _using_ the agent: broadcasting context,
raising intents, joining channels. This skill is about the loader underneath — how `getAgent` decides which
mechanism to use, what it persists, when it injects UI, and how to debug a connection that does not come up. If
you are writing an application, read that one first; come here when you bundle the loader directly or when a
connection fails.

## Failure modes worth checking first

| Symptom                                                      | Usual cause                                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `fdc3.raiseIntent is not a function`                         | `getAgent()` was not awaited                                                                            |
| Connection rejects with `AgentNotFound`                      | No agent present, no response within `timeoutMs`, or a previously used adaptor URL that no longer works |
| Connection rejects with `AccessDenied`                       | The app's identity URL does not match an AppD record (or the agent refused it)                          |
| Connection rejects with `ErrorOnConnect`                     | The agent did not answer identity validation within the 5-second `ID_VALIDATION_TIMEOUT`                |
| Connection rejects with `InvalidFailover`                    | `failover` was not a function, or resolved to something that is neither `DesktopAgent` nor `Window`     |
| A second `getAgent()` call ignores its new options           | The first call already succeeded; the module-scope promise is returned                                  |
| Retrying right after a rejection still returns the rejection | The cached promise is cleared after a 500 ms delay, not immediately                                     |
| Resolver or channel selector never appears                   | The handshake field was absent or falsy, the option was `false`, or CSP is blocking the injected iframe |
| Reload yields a different `instanceId`                       | SessionStorage was cleared or the window's `name` changed, so the key changed                           |
| `joinUserChannel` is undefined                               | The agent does not implement the optional membership APIs — check `optionalFeatures`                    |

## Where the detail lives

- `packages/fdc3-get-agent/src/index.ts` — the exact export list and `fdc3Ready`.
- `packages/fdc3-get-agent/src/strategies/getAgent.ts` — defaults, strategy selection, caching, error handling.
- `packages/fdc3-get-agent/src/strategies/Timeouts.ts` — `DEFAULT_GETAGENT_TIMEOUT_MS` and the DACP timeouts.
- `packages/fdc3-get-agent/src/strategies/Loader.ts` — the `Loader` interface and `DesktopAgentSelection`.
- `packages/fdc3-get-agent/src/strategies/DesktopAgentPreloadLoader.ts` — the `window.fdc3` / `fdc3Ready` path.
- `packages/fdc3-get-agent/src/strategies/PostMessageLoader.ts`, `HelloHandler.ts`,
  `IdentityValidationHandler.ts`, `FailoverHandler.ts` — the Web Connection Protocol client.
- `packages/fdc3-get-agent/src/messaging/message-port.ts` — where the proxy and its UIs are constructed.
- `packages/fdc3-get-agent/src/sessionStorage/DesktopAgentDetails.ts` — the SessionStorage key and record.
- `packages/fdc3-get-agent/src/ui/` — `AbstractUIComponent` and the `Default*` / `Null*` UI implementations.
- `packages/fdc3-standard/src/api/GetAgent.ts` — `DESKTOP_AGENT_SESSION_STORAGE_KEY_PREFIX` and the parameter types.
- `website/docs/api/ref/GetAgent.md` and `website/docs/api/specs/webConnectionProtocol.md`,
  `preloadDesktopAgents.md`, `browserResidentDesktopAgents.md` — the normative descriptions (see the defects above).
