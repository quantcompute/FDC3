---
name: fdc3-standard-api
description: >-
  Use when coding against, or implementing to, the FDC3 API surface shipped by `@qcomp/fdc3-standard`:
  the `DesktopAgent` interface and its members, the `Channel`/`PrivateChannel`/`Listener` types, the
  `AgentError`/`OpenError`/`CloseError`/`ResolveError`/`ResultError`/`ChannelError`/`BridgingError`
  enumerations, the `isStandardContextType`/`isStandardIntent`/`versionIsAtLeast`/
  `compareVersionNumbers` helpers, the `IntentResolver`/`ChannelSelector`/`Connectable` UI interfaces,
  or the `Window.fdc3` global. Also covers what "standard" means in this package's name (interfaces
  and types only, no loader and no implementation), how the `AppIdentifier` duplicate export and the
  `Context` re-export are handled, and when to depend on this package instead of the `@qcomp/fdc3`
  roll-up. Not for connecting an app to an agent at runtime (see `fdc3-app-integration`) or for
  authoring App Directory records (see `fdc3-appd-authoring`).
license: Apache-2.0
metadata:
  fdc3-package: '@qcomp/fdc3-standard'
  fdc3-package-version: '3.0.0-beta.1'
---

# The FDC3 API interfaces in `@qcomp/fdc3-standard`

This skill ships inside the `@qcomp/fdc3-standard` package tarball and describes the API of the version it
ships with — `3.0.0-beta.1`. The `metadata.fdc3-package-version` above is the record of which version that
is: when the monorepo bumps the shared version, this file has to be reviewed, and the `fdc3-version-bump`
skill's `scripts/check-skill-versions.mjs` is what reports it as stale. Everything below is drawn from the
sources in this repository, not from general knowledge of FDC3; where the published documentation and the
implementation disagree, the implementation is what runs and the disagreement is called out.

## What the package is

`@qcomp/fdc3-standard` is the _interface_ half of FDC3. It exports TypeScript declarations for the Desktop
Agent API, the error enumerations its calls reject with, and a small set of pure helper functions. It
contains **no loader, no `DesktopAgent` implementation, and nothing that talks to a desktop** — every piece
of runtime behaviour is supplied by somebody else (a container, a web agent, or the `@qcomp/fdc3-get-agent`
loader). That is what "standard" means in the name, and it is the reason the package has a single dependency
(`@qcomp/fdc3-context`) and no side effects (`package.json`: `"type": "module"`, entry `dist/src/index.js`,
types `dist/src/index.d.ts`, `sideEffects: false`).

Three audiences use it:

- **Application authors** who want the API's types (`DesktopAgent`, `Context`, the error enums) and the
  helpers without dragging in a loader at runtime.
- **Desktop Agent and bridge implementers** who must provide something assignable to the `DesktopAgent`
  interface and reject with the enumerated error strings.
- **Anyone reusing the shared helpers or implementing the optional UI contracts** (`IntentResolver`,
  `ChannelSelector`).

The whole public surface is `src/index.ts` (43 lines). Publishing is driven by the `files` field in
`package.json` (`["dist", "skills"]`), so the built output under `dist` ships — but so does the `skills`
tree, which is not build output, meaning `files` is not simply a "built artifacts only" filter.

## The public surface, as `src/index.ts` declares it

| Export                                                                                                                                                                              | Source                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `DesktopAgent`, `Channel`, `PrivateChannel`, `Listener`, `IntentResolution`, `AppIntent`, `AppMetadata`, `AppIdentifier`, `IntentMetadata`                                          | `src/api/*.ts`               |
| `ImplementationMetadata`, `ContextMetadata`, `AppProvidableContextMetadata`, `DisplayMetadata`, `Icon`, `Image`, `DetachedSignature`, `AntiReplayClaims`                            | `src/api/*.ts`               |
| `ContextHandler`, `IntentHandler`, `IntentResult`, `IntentResolutionResult`, `ContextWithMetadata`                                                                                  | `src/api/Types.ts`           |
| `ApiEvent`, `FDC3Event`, `FDC3EventTypes`, `ChannelEventTypes`, `EventHandler`, `FDC3ChannelChangedEvent`, `PrivateChannelEvent`, …                                                 | `src/api/Events.ts`          |
| `AgentError`, `OpenError`, `CloseError`, `ResolveError`, `ResultError`, `ChannelError`, `BridgingError`                                                                             | `src/api/Errors.ts`          |
| `isStandardContextType`, `isStandardIntent`, `compareVersionNumbers`, `versionIsAtLeast`                                                                                            | `src/api/Methods.ts`         |
| `GetAgentType`, `GetAgentParams`, `GetAgentLogLevels`, `LogLevel`, `SessionStorageFormat`, `DesktopAgentDetails`, `WebDesktopAgentType`, `DESKTOP_AGENT_SESSION_STORAGE_KEY_PREFIX` | `src/api/GetAgent.ts`        |
| `StandardContextType`, `ExperimentalContextType`, `ContextType`, deprecated `ContextTypes` enum                                                                                     | `src/context/ContextType.ts` |
| `StandardIntent`, `Intent`, deprecated `Intents` enum                                                                                                                               | `src/intents/Intents.ts`     |
| `IntentResolver`, `IntentResolutionChoice`, `ChannelSelector`, `Connectable`                                                                                                        | `src/ui/*.ts`                |
| `FDC3_VERSION` (`'3.0'`)                                                                                                                                                            | `src/index.ts:37`            |
| `Window.fdc3?: DesktopAgent` (global augmentation)                                                                                                                                  | `src/index.ts:39-43`         |

Two details of that list are easy to miss. `src/index.ts:18` and `:30` both contain
`export * from './api/GetAgent.js'` — a harmless duplicate, but it means everything from `GetAgent.ts`
arrives twice. And `src/api/DesktopAgentIdentifier.ts` defines a `DesktopAgentIdentifier` interface that is
**not** re-exported from `index.ts` at all — it exists for bridging code but is not part of this package's
public surface (check `src/index.ts` before assuming an exported symbol is reachable).

Crucially, `src/api/GetAgent.ts` declares only the **types** of the loader — `GetAgentType`,
`GetAgentParams`, `LogLevel`, `WebDesktopAgentType` and the SessionStorage shapes. It does not define a
`getAgent()` function: `import { getAgent } from '@qcomp/fdc3-standard'` fails. The callable loader lives in
`@qcomp/fdc3-get-agent`.

## The `DesktopAgent` interface, grouped by area

Declared in `src/api/DesktopAgent.ts` (676 lines). Grouped as the reference page does:

- **Applications** — `open(app, context?, metadata?)`, `close()`, `findInstances(app)`,
  `getAppMetadata(app)`.
- **Context** — `broadcast(context, metadata?)`, `addContextListener(contextType: ContextType | null,
handler)` and the array overload `addContextListener(contextTypes: ContextType[], handler)`.
- **Intents** — `findIntent(intent, context?, resultType?)`, `findIntentsByContext(context, resultType?)`,
  `raiseIntent(intent, context?, app?, newInstance?, metadata?)`,
  `raiseIntentForContext(context, app?, newInstance?, metadata?)`, `addIntentListener(intent, handler)`,
  `addIntentListenerWithContext(intent, contextType, handler)`.
- **Channels** — `getUserChannels()`, `getOrCreateChannel(channelId)`, `createPrivateChannel()`, and the
  optional User–Channel membership trio `joinUserChannel(channelId)`, `getCurrentChannel()`,
  `leaveCurrentChannel()`.
- **Events and metadata** — `addEventListener(type, handler)`, `getInfo()`.

Points worth reading out of the source rather than the docs:

- `raiseIntent` and `raiseIntentForContext` gained a `newInstance?: boolean | null` parameter
  (`DesktopAgent.ts:324-330`, `:362-367`). Omitted/`null` leaves selection to the agent; `true` demands a
  new instance; `false` forbids launching one and MUST reject with
  `ResolveError.TargetInstanceUnavailable` when no instance is running.
- `close()` is a settled 3.x addition (`CHANGELOG.md:39`). For `addIntentListenerWithContext()`
  (`DesktopAgent.ts:454-458`) the repository contradicts itself on the version: `CHANGELOG.md:202` files it
  under `## [FDC3 Standard 2.2]` (`CHANGELOG.md:162`), yet
  `website/versioned_docs/version-2.2/api/ref/DesktopAgent.md` does not document it and the conformance
  tests badge its cases `3.0+` (`website/docs/api/conformance/Intents-Tests.md:358`), so no version should be
  asserted for it. `addIntentListener` returns a `Promise<Listener>` (`:429`), not a bare `Listener`.
- `broadcast` and the listener-registering calls all return promises, and every listener call resolves to a
  `Listener` whose `unsubscribe()` (`src/api/Listener.ts`) is the only way to detach.
- `raiseIntent` may omit context; the agent MUST substitute the `fdc3.nothing` context type
  (`DesktopAgent.ts:264`).

## Optional members and how a consumer detects them

The only genuinely optional Desktop Agent features are the User–Channel membership APIs. They are
**declared as required** members of the TypeScript interface (`DesktopAgent.ts:545`, `:616`, `:632` have no
`?` — the typings cannot express the optionality), so the contract is signalled at runtime instead:
`getInfo()` returns an `ImplementationMetadata` (`src/api/ImplementationMetadata.ts:26-34`) with

| Flag                        | Meaning                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `UserChannelMembershipAPIs` | Whether `joinUserChannel`, `getCurrentChannel` and `leaveCurrentChannel` are implemented. |
| `DesktopAgentBridging`      | Whether the experimental Desktop Agent Bridging feature is implemented.                   |

An application MUST check `optionalFeatures` before calling the membership trio and provide a fallback,
because an agent that does not advertise it may leave those methods absent at runtime. Feature-gating the
whole API is done the same way: `versionIsAtLeast(await fdc3.getInfo(), '2.2')` rather than `typeof` checks.
`getInfo().appMetadata` also carries the calling instance's own `appId`/`instanceId`.

## The error enumerations and where each applies

`src/api/Errors.ts` (152 lines) defines seven enums, all string-valued. The member names are also the
string values in every case _except_ the two noted below.

| Enum            | Applies to                                                                   | Members (values)                                                                                                                                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AgentError`    | connecting — the `getAgent`/`fdc3Ready` family                               | `AgentNotFound`, `AccessDenied`, `ErrorOnConnect`, `InvalidFailover`, `ApiTimeout`                                                                                                                                                                                  |
| `OpenError`     | `open`                                                                       | `AppNotFound`, `ErrorOnLaunch`, `AppTimeout`, `ResolverUnavailable`, `MalformedContext`, `DesktopAgentNotFound`\*, `ApiTimeout`, `InvalidArguments`                                                                                                                 |
| `CloseError`    | `close`                                                                      | `ErrorOnClose`, `ApiTimeout`                                                                                                                                                                                                                                        |
| `ResolveError`  | `findIntent`, `findIntentsByContext`, `raiseIntent`, `raiseIntentForContext` | `NoAppsFound`, `ResolverUnavailable`, `UserCancelled`\*\*, `ResolverTimeout`, `TargetAppUnavailable`, `TargetInstanceUnavailable`, `IntentDeliveryFailed`, `MalformedContext`, `IntentListenerConflict`, `DesktopAgentNotFound`\*, `ApiTimeout`, `InvalidArguments` |
| `ResultError`   | `IntentResolution.getResult()`                                               | `NoResultReturned`, `IntentHandlerRejected`, `ApiTimeout`                                                                                                                                                                                                           |
| `ChannelError`  | channel calls (`getOrCreateChannel`, `broadcast`, joins, listeners)          | `NoChannelFound`, `AccessDenied`, `CreationFailed`, `MalformedContext`, `ApiTimeout`, `InvalidArguments`                                                                                                                                                            |
| `BridgingError` | bridging (`@experimental`)                                                   | `ResponseTimedOut`\*\*\*, `AgentDisconnected`, `NotConnectedToBridge`, `MalformedMessage`                                                                                                                                                                           |

\* `DesktopAgentNotFound` is `@experimental` (bridging). \*\* `ResolveError.UserCancelled` has the string
value `'UserCancelledResolution'` (`Errors.ts:79`) — compare against the member, not the literal.
\*\*\* `BridgingError.ResponseTimedOut` has the string value `'ResponseToBridgeTimedOut'`
(`Errors.ts:142`).

`ApiTimeout` appears in six of the seven enumerations as the catch-all "no more specific error applies" —
every one except `BridgingError` (`Errors.ts:140-152`), whose members are only `ResponseTimedOut`,
`AgentDisconnected`, `NotConnectedToBridge` and `MalformedMessage`. Because each
family applies to a different operation, catching an error string from one family on another operation is a
bug: `ResolverUnavailable` exists in both `OpenError` and `ResolveError` and means different things
depending on which call rejected.

## The helpers and type guards this package adds

`src/api/Methods.ts` is the part of the package that is more than declarations:

- `isStandardContextType(contextType)` — a type guard to `StandardContextType`, backed by
  `StandardContextsSet` in `src/internal/contextConfiguration.ts`.
- `isStandardIntent(intent)` — a type guard to `StandardIntent`, backed by `StandardIntentsSet` in
  `src/internal/intentConfiguration.ts`.
- `compareVersionNumbers(a, b)` — numeric semver comparison returning `-1`/`0`/`1`, or `null` on error.
  Shorter versions lose when otherwise equal (`1.1.1 > 1.1`).
- `versionIsAtLeast(metadata, version)` — wraps `compareVersionNumbers` against `metadata.fdc3Version`,
  returning a boolean or `null`.

The two sets are the authority for "is this a standard type/intent"; see the disagreement section below,
where they do not match the published lists.

`src/context/ContextType.ts` adds the string unions `StandardContextType`, `ExperimentalContextType` and the
open `ContextType = StandardContextType | ExperimentalContextType | (string & {})`. `src/intents/Intents.ts`
adds `StandardIntent`, the open `Intent = StandardIntent | (string & {})`, and a deprecated `Intents` enum
(superseded in 2.2 by the `StandardIntent` union). The same pattern appears for context in the deprecated
`ContextTypes` enum. New code should use the unions; the enums only exist for backwards compatibility.

## The optional-UI interfaces

`src/ui/` defines three interfaces that are deliberately **not** part of `DesktopAgent`:

- `IntentResolver` (`src/ui/IntentResolver.ts`) — `chooseIntent(appIntents, context)` resolves to the chosen
  `IntentResolutionChoice` (`{ intent, appId }`) or `void` when the user cancels.
- `ChannelSelector` (`src/ui/ChannelSelector.ts`) — `updateChannel(channelId, availableChannels)` and
  `setChannelChangeCallback(callback)`.
- `Connectable` (`src/ui/Connectable.ts`) — `connect()`/`disconnect()`.

They are the contract for the **UI components** an app supplies or an agent injects (the Intent Resolver and
Channel Selector): the desktop agent proxy calls them, and the UI side implements them. A Desktop Agent
implementing the `DesktopAgent` interface does not implement these — which is why they ship separately from
it. `src/ui/Connectable.ts:1` carries a standing TODO noting it is really an implementation detail of
`getAgent` and is consumed by `@qcomp/fdc3-get-agent` and `@qcomp/fdc3-agent-proxy`
(`AbstractUIComponent implements Connectable`, `DefaultDesktopAgentIntentResolver implements IntentResolver`
in `packages/fdc3-get-agent/src/ui/`).

## The global `Window.fdc3`

`src/index.ts:39-43` augments the global scope:

```ts
declare global {
  interface Window {
    fdc3?: DesktopAgent;
  }
}
```

This is a type declaration only. It exists so that code compiled with this package can read
`window.fdc3` without a cast, because a **Desktop Agent Preload** injects an implementation there (see
`WebDesktopAgentType.Preload` in `src/api/GetAgent.ts:185-188`). The declaration does not create the object,
and `window.fdc3` may legitimately be absent (`fdc3?:`) — in a plain browser the agent has to be reached
through `getAgent()` instead. Prefer the value returned by `getAgent()` over reading the global directly.

## Relationship to `@qcomp/fdc3` and `@qcomp/fdc3-get-agent`

`@qcomp/fdc3` is a roll-up: `packages/fdc3/src/index.ts` re-exports this package in full
(`export * from '@qcomp/fdc3-standard'`), adds `@qcomp/fdc3-context`, the generated schema/bridging types
from `@qcomp/fdc3-schema`, and the real `getAgent`/`fdc3Ready` from `@qcomp/fdc3-get-agent`, then repeats the
`Window.fdc3` augmentation. Applications normally want the roll-up, because that is the only package that
gives them a callable `getAgent`.

Depend on `@qcomp/fdc3-standard` directly when you need the **types and helpers only** and do not want the
loader, the schema/bridging types, or the context package pulled in:

| Need                                                                           | Depend on              |
| ------------------------------------------------------------------------------ | ---------------------- |
| Retrieving an agent at runtime and using the API                               | `@qcomp/fdc3`          |
| Only the interface/type definitions, error enums and helpers                   | `@qcomp/fdc3-standard` |
| Implementing a `DesktopAgent` (or a bridge) to reject with the standard errors | `@qcomp/fdc3-standard` |

`getAgent` is deliberately _excluded_ from this package: the loader performs discovery, iframe injection,
SessionStorage persistence and CSP-sensitive work — none of which belongs in an interface library. So this
package describes the API and the loader's parameter types, but never performs a connection.

## The `AppIdentifier` duplicate export and the `Context` re-export

`src/index.ts:8-13` does two unusual things:

```ts
// explicit overwrite of conflicting & equivalent export from ContextTypes
export { AppIdentifier } from './api/AppIdentifier.js';
…
export { type Context } from '@qcomp/fdc3-context';
```

The `@qcomp/fdc3-context` package exports its **own** `AppIdentifier` interface
(`packages/fdc3-context/generated/context/ContextTypes.ts:125`) that is structurally equivalent to the API
one in `src/api/AppIdentifier.ts`. To keep `@qcomp/fdc3-standard`'s `AppIdentifier` unambiguous, index.ts
re-exports the API version explicitly, and `AppIdentifier` is _not_ pulled in from the context package.
The roll-up repeats the guard: `packages/fdc3/src/index.ts` does `export * from '@qcomp/fdc3-context'` and
`export * from '@qcomp/fdc3-standard'`, both of which define `AppIdentifier`, so it explicitly adds
`export { AppIdentifier }` (from the standard package's import) to break the tie. If you re-export both
packages yourself, you will have to do the same.

`Context` is different: the API needs a context type and this package does not define one, so it re-exports
`type Context` from `@qcomp/fdc3-context`. That is why `ContextHandler`, `broadcast`, `raiseIntent` and the
rest are typed with a context type that actually comes from the context package, even though you imported
them from `@qcomp/fdc3-standard`.

## Where the published documentation disagrees with the implementation

These were checked while writing this skill; the source path is the one to trust.

| Claim in the docs                                                                                                                                            | Implementation                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `website/docs/intents/spec.md:157-183` lists `GetUser` as a standard intent and marks `ViewContact` **deprecated**                                           | `StandardIntent` (`src/intents/Intents.ts:9-29`) and `STANDARD_INTENTS` (`src/internal/intentConfiguration.ts`) contain `ViewContact` (not deprecated) and no `GetUser`. `isStandardIntent('GetUser')` returns `false`; `isStandardIntent('ViewContact')` returns `true`. The docs also omit `SendChatMessage`, which is in the implementation. |
| `website/docs/context/spec.md:327-348` lists the standard context types and omits `fdc3.fileAttachment` (which has its own reference page)                   | `StandardContextType` (`src/context/ContextType.ts:21`) includes `'fdc3.fileAttachment'`, so `isStandardContextType('fdc3.fileAttachment')` is `true`.                                                                                                                                                                                          |
| `website/docs/context/spec.md:350-356` omits the experimental security types and `fdc3.payment`                                                              | `ExperimentalContextType` (`src/context/ContextType.ts:37-48`) includes `fdc3.security.*` and `fdc3.payment`.                                                                                                                                                                                                                                   |
| `website/docs/api/spec.md:115` lists `getCurrentChannel` among the **MUST**-implement functions, while `:154-157` lists it as **OPTIONAL**                   | `ImplementationMetadata.optionalFeatures.UserChannelMembershipAPIs` (`src/api/ImplementationMetadata.ts:27-30`) treats `getCurrentChannel` as optional. Trust `optionalFeatures`.                                                                                                                                                               |
| `website/docs/api/ref/GetAgent.md:183` says the default discovery timeout is **750 ms**; the same file at `:64` says 1000                                    | `src/api/GetAgent.ts:47` documents the default as 1000, and `@qcomp/fdc3-get-agent` sets `DEFAULT_GETAGENT_TIMEOUT_MS = 1000`. 1000 is correct.                                                                                                                                                                                                 |
| `website/docs/api/ref/GetAgent.md:221-226` and `webConnectionProtocol.md:97-99` render the SessionStorage prefix capitalised (`FDC3-Desktop-Agent-Details-`) | `DESKTOP_AGENT_SESSION_STORAGE_KEY_PREFIX` (`src/api/GetAgent.ts:206`) is `'fdc3-desktop-agent-details'` (lower case).                                                                                                                                                                                                                          |

## Where the detail lives

- `packages/fdc3-standard/src/index.ts` — exactly what this package exports, the `FDC3_VERSION` constant
  and the `Window.fdc3` augmentation.
- `packages/fdc3-standard/src/api/` — `DesktopAgent.ts` (the interface and its doc comments),
  `Errors.ts` (the enumerations), `GetAgent.ts` (loader types and the SessionStorage constant),
  `Channel.ts`, `PrivateChannel.ts`, `Types.ts`, `Events.ts`, `ImplementationMetadata.ts`,
  `AppIdentifier.ts`, `IntentResolution.ts`, `Methods.ts` (the helpers).
- `packages/fdc3-standard/src/internal/{contextConfiguration,intentConfiguration}.ts` — the authoritative
  standard-type and standard-intent sets behind the type guards.
- `packages/fdc3-standard/src/ui/` — `IntentResolver.ts`, `ChannelSelector.ts`, `Connectable.ts`.
- `website/docs/api/spec.md` — the normative API standard, including which parts are optional.
- `website/docs/api/ref/` — `DesktopAgent.md`, `Errors.md`, `Types.md`, `Channel.md`, `PrivateChannel.md`,
  `Events.md`, `GetAgent.md`.
- `website/docs/intents/spec.md` and `website/docs/context/spec.md` — the published standard intent and
  context lists (see the disagreements above before relying on them).
- `packages/fdc3/src/index.ts` and `packages/fdc3-get-agent/src/` — the roll-up and the loader that this
  package deliberately excludes.
