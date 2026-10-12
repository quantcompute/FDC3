---
name: fdc3-app-integration
description: >-
  Use when writing or reviewing application code that talks to an FDC3 Desktop Agent through the `@finos/fdc3`
  package: connecting with `getAgent()` or `fdc3Ready()`, broadcasting and listening for context, raising intents
  and handling their resolutions, joining User Channels, creating App or Private Channels, reading
  `getInfo()`/`getAppMetadata()`, or migrating an app from FDC3 2.x to 3.0. Covers the package's ESM-only
  packaging and CommonJS alternative, `getAgent()` parameters and promise caching, app identity and
  `identityUrl`, SessionStorage-backed reconnection, the injected iframes and the Content-Security-Policy
  allowances they need, the error enumerations an app must handle, and the failure modes that follow from
  treating `getAgent()` as synchronous. Not for authoring App Directory records (see `fdc3-appd-authoring`) or
  for changing the API itself (see `fdc3-schema-change`).
license: Apache-2.0
metadata:
  fdc3-package: '@finos/fdc3'
  fdc3-package-version: '3.0.0-beta.1'
---

# Integrating an application with `@finos/fdc3`

This skill ships inside the `@finos/fdc3` package tarball and describes the API of the version it ships with —
`3.0.0-beta.1`. The `metadata.fdc3-package-version` above is the record of which version that is: when the
monorepo bumps the shared version, this file has to be reviewed, and the `fdc3-version-bump` skill's
`scripts/check-skill-versions.mjs` is what reports it as stale.

Everything below is drawn from the sources in this repository, not from general knowledge of FDC3. Where the
published documentation and the implementation disagree, the implementation is what runs and the disagreement is
called out.

## What the package is

`@finos/fdc3` is the roll-up entry point for applications. `packages/fdc3/src/index.ts` is essentially its whole
implementation — it re-exports four other packages so an app has one dependency instead of four:

| Re-exported from        | What it brings                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@finos/fdc3-standard`  | the API interfaces (`DesktopAgent`, `Channel`, `PrivateChannel`, …), the error enumerations, `ImplementationMetadata`, and the helpers `isStandardContextType`, `isStandardIntent`, `compareVersionNumbers`, `versionIsAtLeast` |
| `@finos/fdc3-context`   | the context data types (`fdc3.instrument`, `fdc3.contact`, …)                                                                                                                                                                   |
| `@finos/fdc3-schema`    | the generated DACP and bridging types (`BrowserTypes*`, `BridgingTypes*`) — wire-level, rarely needed by an app                                                                                                                 |
| `@finos/fdc3-get-agent` | `getAgent` and `fdc3Ready`                                                                                                                                                                                                      |

It also declares the global `Window.fdc3?: DesktopAgent`, which is how a container-injected (preload) agent is
found. All four dependencies are pinned to the same version as this package, so installing it cannot mix versions
of the API and its types.

The package is **ESM-only** (`"type": "module"`, entry `dist/src/index.js`, `sideEffects: false`). An application
that must stay CommonJS is expected to depend on `@finos/fdc3-commonjs` instead — see the package README for that
split, which dates from 2.2.0.

## Connecting: `getAgent()` and `fdc3Ready()`

The first thing application code does is obtain a `DesktopAgent`. `getAgent()` is asynchronous — it returns
`Promise<DesktopAgent>`:

```ts
import { getAgent, DesktopAgent, AgentError } from '@finos/fdc3';

let fdc3: DesktopAgent;
try {
  fdc3 = await getAgent();
} catch (e) {
  // e is a JS Error whose message is a member of AgentError
}
```

**The package README's example is wrong** and must not be copied: it shows `const fdc3 = getAgent();` followed by
`fdc3.raiseIntent(...)`. Without `await`, `fdc3` is a `Promise`, and every method call on it fails at runtime.
Treat `await getAgent()` (or `.then`) as the only correct form.

What `getAgent()` resolves covers three discovery mechanisms without the app knowing which one applied: a Desktop
Agent Preload that has already published `window.fdc3`, a parent window or frame that hosts a Desktop Agent, or a
web Desktop Agent reached by messaging. That is the point of the Web Connection Protocol — the application is not
supposed to branch on which one it got.

On success it also, unless told otherwise:

- assigns the agent to `window.fdc3`, and
- dispatches a `fdc3Ready` event on `window`.

Both exist for backwards compatibility with the 2.x pattern. An app that only needs the agent should use the
returned value. Preload implementations set `window.fdc3` themselves and fire `fdc3Ready`; `getAgent()` listens for
that event _and_ polls, so either ordering works.

`fdc3Ready(waitForMs = 20000)` is the 2.x-style wrapper: it resolves a `DesktopAgent` and sets `window.fdc3`, with
a much longer 20-second wait before failing.

### Parameters

| Parameter           | Default                         | Notes                                                                                                                                                                                                 |
| ------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `timeoutMs`         | `1000`                          | Time allowed for discovery before rejecting or invoking `failover`. Cancelled as soon as an agent is detected; setup can continue past it.                                                            |
| `identityUrl`       | the app's current URL           | Sent to a web Desktop Agent to establish identity. MUST match the app's origin (scheme, host, port) or it is ignored — use it when client-side routing makes the live URL unstable as an identity.    |
| `channelSelector`   | `true`                          | Whether the app needs a Channel Selector UI because it supports User Channels and has none of its own. MAY be ignored by preload implementations.                                                     |
| `intentResolver`    | `true`                          | Whether the app needs an Intent Resolver UI because it raises intents and cannot choose target apps itself. MAY be ignored by preload implementations.                                                |
| `dontSetWindowFdc3` | `false`                         | Set `true` to leave `window.fdc3` untouched and suppress the `fdc3Ready` event.                                                                                                                       |
| `failover`          | —                               | Async function called when normal discovery fails or times out. MUST resolve either to a `DesktopAgent` (e.g. from a proprietary adaptor) or to a `WindowProxy` of a window/iframe that provides one. |
| `logLevels`         | connection `INFO`, proxy `WARN` | Per-channel console logging; raise `proxy` to `DEBUG` to see message traffic when diagnosing a connection.                                                                                            |

A documentation discrepancy worth knowing: the `GetAgent` reference page's "Failover function" section says the
default timeout is 750 ms, while the parameter table on the same page says 1000 ms. The implementation is
`DEFAULT_GETAGENT_TIMEOUT_MS = 1000` in `packages/fdc3-get-agent/src/strategies/Timeouts.ts` — 1000 is correct.

### Promise caching

`getAgent()` caches the connection at module scope: after the first success, later calls return the same promise
and **ignore their parameters**. This is what lets unrelated modules call it freely. If the first call rejects,
the cached promise is cleared shortly afterwards and a later call may retry. Do not rely on passing new parameters
to a second call to reconfigure an existing connection.

If an app wants to bypass FDC3's discovery entirely, the documented approach is not a failover function but to
skip `getAgent()` and provide its own `DesktopAgent` object.

### When connection fails

Rejection is a JS `Error` whose message is taken from `AgentError`:

| Value             | Meaning                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `AgentNotFound`   | No Desktop Agent found by any means, or a previously connected agent is no longer reachable |
| `AccessDenied`    | Identity validation failed, or the agent is otherwise refusing this app                     |
| `ErrorOnConnect`  | An error or exception occurred while setting up communication                               |
| `InvalidFailover` | The failover function was not a function, or did not resolve to an allowed type             |
| `ApiTimeout`      | A call timed out and no more specific error applies                                         |

An application MUST NOT assume an agent exists. Handling `AgentNotFound` is the difference between an app that
degrades gracefully in a plain browser and one that throws on load.

## The API surface in 3.0.0-beta.1

Grouped as `packages/fdc3-standard/src/api/DesktopAgent.ts` declares it:

- **Context** — `broadcast(context, metadata?)`, `addContextListener(type, handler)` (a `null` type listens to
  all, and an array overload listens to several types).
- **Intents** — `raiseIntent(intent, context?, app?, …)`, `raiseIntentForContext(context, app?, …)`,
  `findIntent(intent, context?, resultType?)`, `findIntentsByContext(context, resultType?)`,
  `addIntentListener(intent, handler)`, `addIntentListenerWithContext(intent, contextType, handler)`.
- **Applications** — `open(app, context?, metadata?)`, `close()`, `findInstances(app)`, `getAppMetadata(app)`.
- **Channels** — `getUserChannels()`, `joinUserChannel(channelId)`, `getCurrentChannel()`,
  `leaveCurrentChannel()`, `getOrCreateChannel(channelId)`, `createPrivateChannel()`.
- **Events and metadata** — `addEventListener(type, handler)`, `getInfo()`.

`close()` is a 3.x addition; code written against 2.x will not use it. The changelog lists
`addIntentListenerWithContext` under the FDC3 Standard 2.2 section, but the published 2.2 reference
(`website/versioned_docs/version-2.2/api/ref/DesktopAgent.md`) does not document it.

## Context

A context object is any object with a `type`; `fdc3.instrument`, `fdc3.contact` and the rest are conventions
rather than a closed set, and applications are free to define their own types. `isStandardContextType` and
`isStandardIntent` let you tell a standard type from a private one without hard-coding lists.

The trap is that **`broadcast` is scoped to the app's User Channel membership**: calling it while the app is not
joined to a channel does nothing at all. It is not an error, and it produces no warning. Before concluding that
broadcasting is broken, check `getCurrentChannel()`. Direct broadcasting and listening on a specific `Channel`
object is the alternative when the app manages its own wiring.

Every listener-registering call returns a `Listener`; applications should keep hold of it and unsubscribe rather
than leaking handlers across navigations.

## Channels

User Channels are the ones a person joins and shares. Their membership APIs are **optional** in the standard:
check `getInfo().optionalFeatures.UserChannelMembershipAPIs` before calling `joinUserChannel`,
`getCurrentChannel` or `leaveCurrentChannel`, and provide a fallback rather than assuming the methods exist. This
is also why `getAgent`'s `channelSelector` defaults to true — the agent may need to supply the UI.

App Channels (`getOrCreateChannel`) are created by name and exist without user involvement. Private Channels
(`createPrivateChannel`) get an auto-generated identity and are intended to be handed to another application
through an intent resolution, so the two ends talk on a channel nobody else can join. A Private Channel's
`disconnect` event — registered with `addEventListener('disconnect', handler)` — is how the receiving app learns
the other end went away; calling `disconnect()` is how an app signals it will no longer interact with the channel.
The 2.x synchronous `onAddContextListener`, `onUnsubscribe` and `onDisconnect` handlers were replaced by the async
`addEventListener` mechanism.

## Intents

Raising an intent returns an `IntentResolution` that identifies the application instance that accepted it, and
whether a result will follow. Two independent error families apply: `ResolveError` when no target could be
resolved (`NoAppsFound`, `UserCancelled`, `ResolverUnavailable`, `ResolverTimeout`, `TargetAppUnavailable`,
`TargetInstanceUnavailable`, `IntentDeliveryFailed`, …) and `ResultError` when the chosen app failed to produce a
result (`NoResultReturned`, `IntentHandlerRejected`). `ApiTimeout` appears in six of the seven error enumerations
as the catch-all; `BridgingError` is the exception, using `ResponseTimedOut` instead.
Applications that raise intents should expect a rejection and treat "user cancelled the resolver" as normal, not
exceptional.

On the receiving side, `addIntentListener` handles an intent, while `addIntentListenerWithContext` narrows it to
particular context types and saves writing that check by hand.

## Apps, metadata and version gating

`getInfo()` returns `ImplementationMetadata`: `fdc3Version`, `provider`, optional `providerVersion`, the
`optionalFeatures` flags described above, and `appMetadata` for the calling instance. Use it to _gate_ features —
`versionIsAtLeast(metadata, '2.2')` and `optionalFeatures.UserChannelMembershipAPIs` are the intended
mechanism — rather than feature-detecting methods by `typeof`, which does not survive proxies well.

`getAppMetadata(app)` returns an `AppMetadata` describing another application (icons, title, and the directory
details). `open()` launches an app and resolves to the `AppIdentifier` you should use to talk to that instance;
`findInstances()` lists the running instances of an app when only one of them is the right target.

## Identity, registration and the directory

An app cannot simply connect anonymously: the agent usually has to recognise it. On a web connection the app's
URL is sent as its identity, and the agent matches it against an App Directory record it already knows. Two
consequences that bite in practice:

- Several FDC3 applications hosted on the same origin (say `https://host/trade` and `https://host/watchlist`)
  must each be registered as a **separate** record, distinguished by their path — otherwise the agent cannot tell
  which one connected.
- When client-side routing makes the live URL unstable, pass `identityUrl` so the identity is a URL that matches
  the app's origin and actually identifies it.

Writing those records is the `fdc3-appd-authoring` skill's job; validation of the identity is specified in the
Web Connection Protocol. An app that is not registered, or whose URL does not match its record, fails at
connection time with `AccessDenied` — a symptom that looks like a permissions problem but is usually a directory
problem.

## SessionStorage, and why not to touch it

`getAgent()` persists connection details in `sessionStorage` so that reloads and same-origin navigation do not
produce a new identity each time. The key is
`fdc3-desktop-agent-details-<window.name>` (`DESKTOP_AGENT_SESSION_STORAGE_KEY_PREFIX` in
`fdc3-standard`, joined to the browsing context's name with a hyphen; if the window has no name, `getAgent`
assigns a UUID). The referenced page elsewhere renders the prefix capitalised as `FDC3-Desktop-Agent-Details-`,
which does not match the constant.

Applications SHOULD NOT read or write that data. It holds the app's `appId`, `instanceId` and a secret
`instanceUuid` used to reclaim the same instance, and interfering with it produces confusing identity failures.

## Content-Security-Policy

`getAgent()` may inject hidden iframes into the application window to load an adaptor, an Intent Resolver or a
Channel Selector. A CSP that does not allow those frames is a common cause of a connection that half-works (the
agent is found, but raising an intent never shows a resolver). Allow the Desktop Agent's and UI implementations'
domains in `frame-src`, `child-src` and `default-src` — including `fdc3.finos.org` where the reference resolver
and channel selector are served from.

## Failure modes worth checking first

| Symptom                                                  | Usual cause                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `fdc3.raiseIntent is not a function`                     | `getAgent()` was not awaited                                                               |
| `broadcast` has no effect, no error                      | the app is not joined to a User Channel                                                    |
| Connection rejects with `AgentNotFound`                  | no agent present, or the agent was not detected within `timeoutMs`                         |
| Connection rejects with `AccessDenied`                   | the app is not registered, or its identity URL does not match its record                   |
| Resolver never appears                                   | CSP is blocking the injected iframe, or the app passed `intentResolver: false`             |
| `joinUserChannel` is undefined                           | the agent does not implement the optional membership APIs — check `optionalFeatures` first |
| A second `getAgent()` call appears to ignore its options | the first call already succeeded; the cached promise is returned                           |
| Reload produces a different `instanceId`                 | SessionStorage was cleared, or the app's identity URL is unstable                          |

## Where the detail lives

- `website/docs/api/spec.md` — the normative API standard, including which parts are optional.
- `website/docs/api/ref/` — `DesktopAgent.md`, `GetAgent.md`, `Channel.md`, `PrivateChannel.md`, `Errors.md`,
  `Types.md`, `Events.md`.
- `website/docs/api/specs/webConnectionProtocol.md` and `desktopAgentCommunicationProtocol.md` — how the
  connection and the message exchange actually work.
- `packages/fdc3/src/index.ts` — exactly what this package re-exports.
- `packages/fdc3-get-agent/src/strategies/` — discovery, timeout and failover behaviour.
