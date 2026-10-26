---
name: fdc3-wire-protocol
description: >-
  Use when implementing or consuming the message-level types that FDC3 defines rather than the
  application API: Desktop Agent implementers, Desktop Agent Bridge (bridging) implementers, and
  builders of FDC3-for-Web connections — the Desktop Agent Proxy, Preload or Browser-Resident
  agents. Covers the two generated groups in `@qcomp/fdc3-schema` (`BrowserTypes*` for the Web
  Connection Protocol and the Desktop Agent Communication Protocol, `BridgingTypes*` for Desktop
  Agent Bridging), which specification each group serves, the `Core`/`Validation`/barrel split,
  how the JSON Schema sources are regenerated with quicktype, the request/response/event envelope
  and its `meta` fields, the `fdc3Version` fields carried on the wire, and the relationship to the
  API types in `@qcomp/fdc3-standard`. Not for application code that calls a `DesktopAgent` (see
  `fdc3-app-integration`), for authoring App Directory records (see `fdc3-appd-authoring`), or for
  changing the wire schemas themselves (see `fdc3-schema-change`).
license: Apache-2.0
metadata:
  fdc3-package: '@qcomp/fdc3-schema'
  fdc3-package-version: '3.0.0-beta.1'
---

# The FDC3 wire protocol in `@qcomp/fdc3-schema`

This skill ships inside the `@qcomp/fdc3-schema` package tarball and describes the message types of
the version it ships with — `3.0.0-beta.1`. The `metadata.fdc3-package-version` above is the record
of which version that is: when the monorepo bumps the shared version, this file has to be reviewed,
and the `fdc3-version-bump` skill's `scripts/check-skill-versions.mjs` is what reports it as stale.

Everything below is drawn from the sources in this repository, not from general knowledge of FDC3.
Where the published documentation and the implementation disagree, the implementation is what runs
and the disagreement is called out.

## What the package is

`@qcomp/fdc3-schema` holds two things that belong together: the JSON Schema documents that normatively
define the FDC3 message formats, and the TypeScript types generated from them. `packages/fdc3-schema/src/index.ts`
is the entire runtime entry point — six lines of `import * as` re-exporting six modules:

| Exported namespace        | Generated file                                  |
| ------------------------- | ----------------------------------------------- |
| `BrowserTypes`            | `generated/api/BrowserTypes.ts`                 |
| `BrowserTypesCore`        | `generated/api/BrowserTypesCore.ts`             |
| `BrowserTypesValidation`  | `generated/api/BrowserTypesValidation.ts`       |
| `BridgingTypes`           | `generated/bridging/BridgingTypes.ts`           |
| `BridgingTypesCore`       | `generated/bridging/BridgingTypesCore.ts`       |
| `BridgingTypesValidation` | `generated/bridging/BridgingTypesValidation.ts` |

The package is `"type": "module"` and publishes `dist` and this skill's `skills/` directory
(`"files": ["dist", "skills"]` in `packages/fdc3-schema/package.json`). `tsconfig.json` sets
`rootDirs: ["src", "generated"]` and
`outDir: "dist"`, so the published tree is `dist/src/index.js` plus `dist/generated/**`. **The
`schemas/` directory is not published in the tarball** — only the generated types and the schemas'
`$id`-addressed copies on the FDC3 website are available to a consumer. Import the types from
`@qcomp/fdc3-schema` (namespace or deep `dist/generated/...` path); do not expect the `.schema.json`
files to be present in `node_modules`.

There are no runtime dependencies: the generated code stands alone, `sideEffects: false`.

## Which group serves which specification

The two generated groups exist because FDC3 defines **two independent protocols**, and an
implementer almost never needs both:

| Generated group                          | Specification                                                                               | Who needs it                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `BrowserTypes*` (`generated/api/`)       | Web Connection Protocol (WCP) + Desktop Agent Communication Protocol (DACP)                 | Desktop Agent Proxy / `getAgent()` implementers, Browser-Resident Desktop Agents, and anything that speaks to an app over a `MessagePort` |
| `BridgingTypes*` (`generated/bridging/`) | Desktop Agent Bridging — Bridge Connection Protocol (BCP) + Bridge Messaging Protocol (BMP) | Desktop Agent implementations that connect to a Desktop Agent Bridge, and the Bridge itself                                               |

The four specification documents named in this package's remit map as follows:

- `website/docs/api/specs/webConnectionProtocol.md` — the connection handshake. Its messages are the
  `WebConnectionProtocol*` interfaces in `BrowserTypes*` (`WCP1Hello` … `WCP6Goodbye`), generated from
  `schemas/api/WCP*.schema.json`.
- `website/docs/api/specs/desktopAgentCommunicationProtocol.md` — the API-call messages exchanged
  over the `MessagePort` after connection. These are the `*Request` / `*Response` / `*Event`
  interfaces in `BrowserTypes*`, generated from `schemas/api/*.schema.json`.
- `website/docs/api/specs/browserResidentDesktopAgents.md` — an implementer guide for a Browser-Resident
  DA. It tells a DA how to _use_ WCP and DACP (`WCP1Hello` handling, `WCP4ValidateAppIdentity`, identity
  matching), and it enumerates the injected user-interface messages — `Fdc3UserInterfaceRestyle`,
  `Fdc3UserInterfaceDrag`, `Fdc3UserInterfaceChannels`, `Fdc3UserInterfaceChannelSelected`,
  `Fdc3UserInterfaceResolve` and `Fdc3UserInterfaceResolveAction`, which it calls "part of the DACP".
  Those have their own `schemas/api/fdc3UserInterface*.schema.json` sources and `BrowserTypesCore.ts`
  interfaces — `BrowserTypes*` again.
- `website/docs/api/specs/preloadDesktopAgents.md` — an implementer guide for a Preload DA (the
  `window.fdc3` / `fdc3Ready` interface). It defines **no message types at all**, and therefore has no
  generated group: a Preload DA exposes the `DesktopAgent` API directly and does not use the wire
  protocol.
- `website/docs/agent-bridging/spec.md` (and `website/docs/agent-bridging/ref/*`) — Desktop Agent
  Bridging. Its connection steps and message exchanges are the `ConnectionStep*` and `*Agent*` /
  `*Bridge*` interfaces in `BridgingTypes*`.

So the rule of thumb is: **an app-facing desktop agent / adaptor needs `BrowserTypes*`; an agent that
is being bridged needs `BridgingTypes*`; an agent that is both needs both.**

## The three files that make up each group

Each group is one quicktype output split into three files at generation time (see below). They carry
different things and have different costs, so pick deliberately:

| File                                 | Carries                                                                                                                                                                                                                                               | Size (this version)                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `*Core.ts`                           | All the interfaces and type aliases, and for the browser API the fast `is<X>(value)` predicates that only look at `type` (`generatePredicates: true`); the bridging Core file exports interfaces and type aliases only (`generatePredicates: false`). | `BrowserTypesCore` 5179 lines; `BridgingTypesCore` 4400 lines             |
| `*Validation.ts`                     | The quicktype `Convert` class and its type maps, and for the browser API the `isValid<X>(value)` predicates that check shape; the bridging Validation file exports `Convert` only.                                                                    | `BrowserTypesValidation` 3556 lines; `BridgingTypesValidation` 2476 lines |
| `*Types.ts` (e.g. `BrowserTypes.ts`) | A compatibility barrel: `export * from './…Core.js'; export * from './…Validation.js';`.                                                                                                                                                              | 9 lines each                                                              |

Internal consumers do not import the `Core` file directly. `fdc3-agent-proxy` (its messaging and channel
code) and `fdc3-web-impl` (its handlers) import the barrel
`@qcomp/fdc3-schema/dist/generated/api/BrowserTypes.js` for their message types; `fdc3-web-impl` also
value-imports `is<X>` predicates from that barrel (e.g. `isAddContextListenerRequest` in
`handlers/OpenHandler.ts`), whereas `fdc3-agent-proxy`'s only predicate use is the `BrowserTypesCore`
namespace imported from the package root (`listeners/PrivateChannelEventListener.ts`). `fdc3-get-agent`
likewise uses the `BrowserTypesCore` namespace exported from the package root. The barrel
re-exports both `…Core.js` and `…Validation.js`, so importing it reaches the validation runtime; it exists
so that `import { BrowserTypes } from '@qcomp/fdc3-schema'` and `BrowserTypes.isValidX(...)` keep working
for existing code. If you only need the interfaces and cheap type guards, import the `Core` module
directly (`@qcomp/fdc3-schema/dist/generated/api/BrowserTypesCore.js`) and you avoid the ~150 KB
validation runtime entirely.

## These types are generated — never hand-edit

`generated/**` is build output. Editing it is always wrong: the next `npm run generate` overwrites it,
and the JSON Schema in `schemas/` remains the source of truth (the `packages/fdc3-schema/README.md`
says so explicitly, and adds that where the generated TypeScript and the JSON Schema disagree the
**JSON Schema wins**).

The regeneration path, exactly:

- `npm run generate` runs `mkdirs`, then `typegen-browser`, then `typegen-bridging`, then
  `generate-type-predicates`, then `lint` (see `packages/fdc3-schema/package.json`).
- `typegen-browser` runs, from inside `schemas/`,
  `node ../s2tQuicktypeUtil.cjs api/api.schema.json api/common.schema.json ../../fdc3-context/schemas/context/context.schema.json api ../generated/api/BrowserTypesCore.ts`.
  That is: two additional schema files (`api.schema.json`, `common.schema.json`) plus the context
  schema, then every `*.schema.json` in `api/`, written to `generated/api/BrowserTypesCore.ts`.
- `typegen-bridging` runs the same utility with `api/api.schema.json` and `api/common.schema.json`, plus
  14 enumerated `api/*Request` / `*Response` schema files (broadcast, findInstances, findIntent,
  findIntentsByContext, getAppMetadata, open, raiseIntent and raiseIntentResult) and the context schema
  as additional sources, and the whole `bridging/` directory as the top-level source set, written to
  `generated/bridging/BridgingTypesCore.ts`.
- `s2tQuicktypeUtil.cjs` exists to work around a quicktype bug: when a _directory_ is passed as
  input, quicktype ignores `-s schema` and parses the files as JSON. The utility lists directories
  itself, passes each `*.schema.json` as an individual `--src`, and passes the named single files as
  `-S` (additional reference schemas). It then invokes quicktype with
  `--prefer-const-values --prefer-unions -s schema`.
- `generate-type-predicates` (`code-generation/generate-type-predicates.ts`) reads the raw quicktype
  output, splits the `Convert` class / `isValid<X>` / runtime helpers into the `*Validation.ts`
  companion, writes the `is<X>` fast predicates and `<X>_TYPE` constants into the `*Core.ts` file (only
  for the browser API — the bridging run passes `generatePredicates: false`, so `BridgingTypesCore.ts`
  receives no predicates), and writes the 9-line compatibility barrel at the original `*Types.ts` name.

The JSON Schema sources live at `packages/fdc3-schema/schemas/api/` and
`packages/fdc3-schema/schemas/bridging/` (plus `schemas/bridgingAsyncAPI/bridgingAsyncAPI.json`, an
AsyncAPI document that references the bridging schemas for client/server stub generation). The context
schema that is folded into both outputs comes from the separate `@qcomp/fdc3-context` package
(`packages/fdc3-context/schemas/context/context.schema.json`). Each schema carries an `$id` under
`https://fdc3.finos.org/schemas/next/…` — for example `api/WCP1Hello.schema.json` and
`bridging/connectionStep2Hello.schema.json` — and those are the deployed, authoritative copies.

## The two protocols, and why a bridged agent needs both

`BrowserTypes*` and `BridgingTypes*` look superficially similar — both carry named requests and
responses for the same FDC3 operations (`broadcast`, `raiseIntent`, `findIntent`, `open`,
`getAppMetadata`, `findInstances`, and the PrivateChannel events). They are not interchangeable; they
sit at different layers:

- **The FDC3-for-Web message set (`BrowserTypes*`)** is the protocol between _an application and its
  own Desktop Agent_. An application's `getAgent()` produces a Desktop Agent Proxy that serialises each
  `DesktopAgent` API call into an `AppRequestMessage`, posts it over a `MessagePort`, and matches the
  `AgentResponseMessage` back by `meta.requestUuid`; the agent pushes unsolicited `AgentEventMessage`s
  for inbound context and events. This is where an _app_ implicitly lives (though the app itself never
  sees these types — see the API-vs-wire section below).
- **The bridging message set (`BridgingTypes*`)** is the protocol between _a Desktop Agent and a
  Desktop Agent Bridge_. A bridged agent is a websocket client of the bridge; it completes the BCP
  (`hello` → `handshake` → `authenticationFailed`? → `connectedAgentsUpdate`) and then, for each FDC3
  interaction that must cross agents, sends a `…AgentRequest` (a request _from_ an agent) and receives
  `…BridgeRequest` (the bridge's augmented forward), `…AgentResponse` (a single agent's reply) and
  `…BridgeResponse` (the bridge's collated reply).

The reason a bridged desktop agent needs the second set is that bridging does not reuse the app-facing
wire format at all. The bridge is the router: an agent hands it an `agentRequest`, the bridge augments
`meta.source.desktopAgent` and forwards `bridgeRequest`s to other agents, collates their responses, and
returns a `bridgeResponse`. Two message names carry this: the bridging spec's **BCP** (connection) and
**BMP** (messaging). A DA that is _also_ an app-facing browser-resident agent therefore carries **both**
generated groups and uses each on its own transport (websocket to the bridge, `MessagePort` to its apps).

An important naming detail: the browser group is not a synonym for the DACP. `BrowserTypes*` carries two
things at once — the Web Connection Protocol (WCP) handshake and the DACP application API messages
(which is why the package README calls its messages "FDC3 for Web messages" while it also ships WCP).
The `BridgingTypes*` group is the separate Desktop Agent Bridging exchange, whose two protocols the
bridging spec distinguishes explicitly as the **Bridge Connection Protocol (BCP)** and the **Bridge
Messaging Protocol (BMP)**. Do not conflate the browser/app-facing protocol with bridging.

## Wire types versus the API types in `@qcomp/fdc3-standard`

Two packages define "the FDC3 contract", and picking the wrong one is the most common mistake:

| Package                | What it is the contract for                                                                                                                                                             | Typical dependant                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `@qcomp/fdc3-standard` | The **API** an application calls: `DesktopAgent`, `Channel`, `PrivateChannel`, `Listener`, the `*Error` enumerations, `ImplementationMetadata`. Hand-written TypeScript, not generated. | An application (directly, or via `@qcomp/fdc3`); a Desktop Agent's app-facing implementation.            |
| `@qcomp/fdc3-schema`   | The **wire** types for a _connection_: the JSON messages a proxy, an agent, or a bridge send to each other. Generated from JSON Schema.                                                 | A Desktop Agent Proxy (`fdc3-agent-proxy`), a Browser-Resident agent, a bridged Desktop Agent, a Bridge. |

The two are deliberately separate: `@qcomp/fdc3-standard` does **not** depend on `@qcomp/fdc3-schema`.
An application depends only on the API package and never imports a wire type. A component that sits
_behind_ the API — translating `DesktopAgent` calls into messages — needs both, and
`packages/fdc3-agent-proxy/package.json` is the working example: it depends on `@qcomp/fdc3-schema`
("3.0.0-beta.1") _and_ `@qcomp/fdc3-standard` ("3.0.0-beta.1"). The roll-up `@qcomp/fdc3` package
depends on all of `fdc3-context`, `fdc3-get-agent`, `fdc3-schema` and `fdc3-standard`, which is why the
documentation's tip that you can `import { BrowserTypes } from "@qcomp/fdc3"` is true — it is a
re-export of this package, not a separate copy. All four are pinned to the same version.

## Message envelopes you can start from

Most messages in both protocols are a JSON object with a `type` string, a `payload`, and a `meta`, but
this is not universal: `payload` is optional on the WCP base interface (`WebConnectionProtocolMessage`,
which models the common WCP shape), and the `WCP6Goodbye` disconnect message carries only `meta` and
`type`. In the JSON Schema sources, `WCPConnectionStep.schema.json` requires only `["type","meta"]`.

### DACP / WCP envelopes (`BrowserTypesCore.ts`)

- **App → agent request**: `AddContextListenerRequest`, `BroadcastRequest`, `RaiseIntentRequest`, …
  `meta: AppRequestMessageMeta` = `{ requestUuid: string; source?: AppIdentifier; timestamp: Date }`.
  The union is `AppRequestMessage`. (Quicktype emits the identical-shaped `AddContextListenerRequestMeta`
  for several request types — they are the same fields by design.)
- **Agent → app response**: `AddContextListenerResponse`, `RaiseIntentResponse`, … `meta` =
  `{ requestUuid; responseUuid; timestamp }`, quoting the request's `requestUuid`. The union is
  `AgentResponseMessage`.
- **Agent → app event**: `BroadcastEvent`, `IntentEvent`, `ChannelChangedEvent`, `ContextClearedEvent`,
  the `PrivateChannelOn*Event`s. `meta: AgentEventMessageMeta` = `{ eventUuid: string; timestamp: Date }`.
  The union is `AgentEventMessage`.
- **WCP connection steps**: `WebConnectionProtocol1Hello` (`type: 'WCP1Hello'`),
  `WebConnectionProtocol2LoadURL`, `WebConnectionProtocol3Handshake`, `WebConnectionProtocol4ValidateAppIdentity`,
  `WebConnectionProtocol5ValidateAppIdentityFailedResponse`,
  `WebConnectionProtocol5ValidateAppIdentitySuccessResponse`, `WebConnectionProtocol6Goodbye`. The six
  step messages other than the goodbye carry `meta: WebConnectionProtocol1HelloMeta` =
  `{ connectionAttemptUuid: string; timestamp: Date }`; `WebConnectionProtocol6Goodbye` carries
  `meta: WebConnectionProtocol6GoodbyeMeta` = `{ timestamp: Date }` only. (`ConnectionStepMetadata` =
  `{ timestamp; connectionAttemptUuid? }` belongs to the aggregate `WebConnectionProtocolMessage`, not
  to any individual step message.) The message-type union is `ConnectionStepMessageType`.

A minimal request, importing the concrete type rather than the namespace:

```ts
import type { BroadcastRequest } from '@qcomp/fdc3-schema/dist/generated/api/BrowserTypesCore.js';

const request: BroadcastRequest = {
  type: 'broadcastRequest',
  payload: { channelId: 'fdc3.channel.1', context: { type: 'fdc3.instrument' } },
  meta: { requestUuid: crypto.randomUUID(), timestamp: new Date() },
};
```

Use `BrowserTypes` (barrel) when you also want `isValid<X>` shape checks; use `BrowserTypesCore` when
you want only the interfaces and the cheap `is<X>` guards.

### Bridging envelopes (`BridgingTypesCore.ts`)

- **Connection protocol**: `ConnectionStep2Hello` (`type: 'hello'`), `ConnectionStep3Handshake`
  (`type: 'handshake'`), `ConnectionStep4AuthenticationFailed` (`type: 'authenticationFailed'`),
  `ConnectionStep6ConnectedAgentsUpdate` (`type: 'connectedAgentsUpdate'`). `ConnectionStepMessageType`
  is the union `'hello' | 'handshake' | 'authenticationFailed' | 'connectedAgentsUpdate'`. The
  handshake payload carries `implementationMetadata: ConnectingAgentImplementationMetadata`,
  `requestedName: string` and `channelsState: { [channelId: string]: Context[] }`.
- **From an agent**: `…AgentRequest` (e.g. `BroadcastAgentRequest`, `RaiseIntentAgentRequest`),
  `…AgentResponse`, `…AgentErrorResponse`. `meta: AgentRequestMetadata` =
  `{ requestUuid: string; timestamp: Date; source?: SourceIdentifier; destination?: BridgeParticipantIdentifier }`
  — `source` is optional and `SourceIdentifier` is `{ appId?; desktopAgent?; instanceId? }`.
- **From the bridge**: `…BridgeRequest`, `…BridgeResponse`, `…BridgeErrorResponse`. `meta` is
  `BridgeRequestMetadata` / `BridgeResponseMessageMeta`, which add the `desktopAgent` routing name to
  `source` and `destination` (`DesktopAgentIdentifier` = `{ desktopAgent: string }`).
- The union type names are `RequestMessageType` / `ResponseMessageType` for the message `type` strings,
  and there are distinct interfaces `AgentRequestMessage`, `AgentResponseMessage`, `BridgeRequestMessage`,
  `BridgeResponseMessage`, `BridgeErrorResponseMessage`, `AgentErrorResponseMessage` modelling the
  generic envelopes.

Requests that expect a reply MUST quote `requestUuid`; responses add `responseUuid`. Most request types
are answered by a matching response — `broadcastRequest`, for example, is answered by a
`broadcastResponse` — but the message set is not uniformly request/response.
`heartbeatAcknowledgementRequest` is a request type with no response type: the spec frames it as the
completion of an agent-initiated `heartbeatEvent`, acknowledged by an `AppRequest` message rather than a
response (DACP spec, "Checking apps are alive").

## Version fields on the wire — verified, not assumed

The wire format **does** carry FDC3 version strings, but it does **not** define a negotiation algorithm.
Verified against `generated/`:

| Where                                                                                                                       | Field                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WebConnectionProtocol1HelloPayload` (`BrowserTypesCore.ts:128`)                                                            | `fdc3Version: string` — "the version of FDC3 API that the app supports"                                                                                                                                                                                     |
| `WebConnectionProtocol3HandshakePayload` (`BrowserTypesCore.ts:224`)                                                        | `fdc3Version: string` — "the version of FDC3 API that the Desktop Agent will provide support for"; the required `channelSelectorUrl` and `intentResolverUrl` (`boolean \| string`), and the optional `appLaunchTimeout` / `messageExchangeTimeout` timeouts |
| `WebConnectionProtocol5ValidateAppIdentitySuccessResponsePayload` (`BrowserTypesCore.ts:364`)                               | `implementationMetadata: ImplementationMetadata`, whose `fdc3Version` is the agent's supported version                                                                                                                                                      |
| `ConnectionStep2HelloPayload` (`BridgingTypesCore.ts:938`)                                                                  | `desktopAgentBridgeVersion: string` and `supportedFDC3Versions: string[]` — the bridge advertises the versions it supports                                                                                                                                  |
| `ConnectionStep3HandshakePayload` → `ConnectingAgentImplementationMetadata` (`BridgingTypesCore.ts:992`, `:1015`)           | `fdc3Version: string`                                                                                                                                                                                                                                       |
| `ConnectionStep6ConnectedAgentsUpdatePayload` → `DesktopAgentImplementationMetadata` (`BridgingTypesCore.ts:1129`, `:1155`) | `fdc3Version: string` per connected agent                                                                                                                                                                                                                   |

What is **not** there: no min/max, no pick-a-version logic, no fallback field. The schemas carry the
version strings and leave compatibility decisions to implementations. Do not claim a negotiation step
exists — there is none in the schemas.

## Failure modes worth checking first

| Symptom                                                            | Usual cause                                                                                                                                                           |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Import of `@qcomp/fdc3-schema/dist/generated/...` fails            | You imported `schemas/` paths — they are not published (`files: ["dist", "skills"]`). Use `dist/generated`                                                            |
| Bundle bloats with a `Convert` class                               | You imported the `BrowserTypes`/`BridgingTypes` barrel (or `…Core` via the package root); import `@qcomp/fdc3-schema/dist/generated/api/BrowserTypesCore.js` directly |
| Hand-edit disappears after a build                                 | `generated/**` is overwritten by `npm run generate` — edit `schemas/**`, then regenerate                                                                              |
| Response never matches a request                                   | The response must quote `meta.requestUuid`; events are matched by `eventUuid`, not `requestUuid`                                                                      |
| A bridged agent receives app-format messages and cannot parse them | You used `BrowserTypes*` where the bridge speaks `BridgingTypes*` (or vice-versa)                                                                                     |
| `payload.metadata` arrives as `{}` from an implementation          | An omitted optional API argument MUST be absent, not `{}`/`null` (DACP spec, "Metadata in messages")                                                                  |

## Where the detail lives

- `packages/fdc3-schema/src/index.ts` — the six namespace exports and nothing else.
- `packages/fdc3-schema/generated/api/BrowserTypesCore.ts` and
  `generated/bridging/BridgingTypesCore.ts` — the interfaces, unions (`AppRequestMessage`,
  `AgentResponseMessage`, `AgentEventMessage`, `RequestMessageType`, `ConnectionStepMessageType`, …) and,
  for the browser API only, the `is<X>` predicates.
- `packages/fdc3-schema/generated/api/BrowserTypesValidation.ts` and the bridging equivalent — the
  `Convert` class (the browser file also has `isValid<X>` predicates; the bridging file has none).
- `packages/fdc3-schema/schemas/api/` and `schemas/bridging/` — the JSON Schema source of truth and the
  `$id` values deployed to `https://fdc3.finos.org/schemas/next/…`.
- `packages/fdc3-schema/package.json` — the exact `typegen-browser` / `typegen-bridging` / `generate`
  scripts; `s2tQuicktypeUtil.cjs` and `code-generation/generate-type-predicates.ts` — the generation
  and split logic.
- `packages/fdc3-schema/README.md` — the quicktype caveats (index signatures, `oneOf`/`allOf` merging,
  random sub-unit names) and the rule that JSON Schema beats the generated TypeScript.
- `website/docs/api/specs/webConnectionProtocol.md`, `desktopAgentCommunicationProtocol.md`,
  `browserResidentDesktopAgents.md`, `preloadDesktopAgents.md` — the four app-facing specs.
- `website/docs/agent-bridging/spec.md` and `website/docs/agent-bridging/ref/*` — bridging connection
  steps and per-operation message exchanges.
