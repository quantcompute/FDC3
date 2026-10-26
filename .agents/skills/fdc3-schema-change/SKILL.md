---
name: fdc3-schema-change
description: >-
  Use when changing the FDC3 wire protocol or context JSON Schemas: adding or renaming a field on a DACP message,
  adding a new Desktop Agent API method or request/response message pair, editing shared definitions in
  api.schema.json (ContextMetadata, AppIdentifier, DesktopAgentIdentifier), wiring a message through agent-proxy and
  fdc3-web-impl, or adding/changing a context type under fdc3-context. Covers regenerating BrowserTypes.ts,
  BridgingTypes.ts and ContextTypes.ts with quicktype via s2tQuicktypeUtil.cjs, keeping the hand-written
  fdc3-standard interfaces in step, regenerating the website context reference pages, and the checks that fail when
  the generated and hand-written sides drift apart. Not for app-directory (AppD) schema edits or documentation-only
  changes.
license: Apache-2.0
---

# Changing the FDC3 wire protocol or context schemas

The FDC3 monorepo has two definitions of every message and every type: one that travels on the wire and one that
applications code against. They are written in different languages of the same vocabulary — JSON Schema on one side,
TypeScript interfaces on the other — and nothing in the build generates one from the other. This skill is the
procedure for changing both without letting them drift.

Read `AGENTS.md` "Critical Relationships" and "Common Change Patterns" first; this skill assumes them and adds the
commands, file names and failure symptoms they leave out.

## The flow is one-way, and only the first half is automatic

```
JSON Schema files                    Generated TypeScript              Hand-written interfaces
─────────────────                    ────────────────────              ───────────────────────
packages/fdc3-schema/                packages/fdc3-schema/             packages/fdc3-standard/
  schemas/api/*.schema.json    ──►     generated/api/BrowserTypes*.ts    src/api/*.ts
  schemas/bridging/*.schema.json ──►   generated/bridging/BridgingTypes*.ts
packages/fdc3-context/
  schemas/context/*.schema.json ──►  packages/fdc3-context/
                                       generated/context/ContextTypes.ts
```

The arrow only goes left to right. `npm run build` in `fdc3-schema` or `fdc3-context` overwrites everything under
`generated/`, so a hand edit there survives exactly until the next build. Nothing regenerates
`packages/fdc3-standard/src/api/*.ts` — those interfaces are maintained by hand beside the schemas, and keeping the
two in step is the reviewer's first question. A change that updates only the schema leaves the public API describing
the previous shape; a change that updates only the interface leaves the proxy emitting fields the schema rejects.

Because the generated types are the wire format and the standard interfaces are the public API, you normally change
both. The exception is a field that is purely transport-level — something the Desktop Agent reads and answers without
it ever appearing in a documented API signature — and even then the DACP reference page needs it.

## Wire format vs public API

Three packages split the responsibility:

- `packages/fdc3-schema` — the JSON Schemas and the TypeScript generated from them. `generated/api/BrowserTypes*`
  describe **DACP** (the Desktop Agent Communication Protocol, what an app and a Desktop Agent exchange over a
  `MessagePort`) and the Web Connection Protocol messages (`WCP1Hello` … `WCP6Goodbye`) used by `getAgent()`.
  `generated/bridging/BridgingTypes*` describe the Agent Bridging protocol, the messages Desktop Agents send to a
  bridge. `packages/fdc3-schema/README.md` is explicit that the schemas, not the TypeScript, are the source of truth
  and that quicktype cannot always reproduce a schema faithfully (index signatures, `oneOf`/`allOf` merging, and
  randomly-named sub-interfaces like `FluffyMarket` are all expected).
- `packages/fdc3-standard` — the hand-written public API: `src/api/DesktopAgent.ts`, `Channel.ts`,
  `PrivateChannel.ts`, `Types.ts`, `ContextMetadata.ts`, `Events.ts`, `DesktopAgentIdentifier.ts` and friends.
  `src/index.ts` re-exports them, so anything new must also be exported there (see `AGENTS.md` "Adding a new API
  method").
- `packages/fdc3-agent-proxy` (client) and `toolbox/fdc3-for-web/fdc3-web-impl` (server) — the two DACP
  implementations. The proxy builds request messages and interprets responses and events; `fdc3-web-impl` has a
  handler per message family (`handlers/BroadcastHandler.ts`, `IntentHandler.ts`, `OpenHandler.ts`,
  `HeartbeatHandler.ts`) picked up by the `handlers` array in `DefaultFDC3Server`.

`generated/api/BrowserTypes.ts` is itself generated: it is a small compatibility barrel emitted by
`code-generation/generate-type-predicates.ts` that re-exports `BrowserTypesCore.ts` (interfaces, fast `is<X>`
predicates and the `RequestMessageType`/`ResponseMessageType`/`EventMessageType` unions) and
`BrowserTypesValidation.ts` (the `Convert` class and `isValid<X>` predicates). Internal consumers import either the
package root (`import { BrowserTypes } from '@qcomp/fdc3-schema'`) or a generated subpath directly
(`@qcomp/fdc3-schema/dist/generated/api/BrowserTypes.js`, or `BrowserTypesCore` for bundle-size-sensitive code such
as `fdc3-get-agent`). It follows from this that a new message must be added to the schema for its TypeScript
`AppRequestMessage`/`AgentResponseMessage`/`AgentEventMessage` union to contain it at all.

## Recipe: add a field to an existing DACP message

The `metadata` field on `broadcastRequest` is the worked example — it was added to carry app-provided
`AppProvidableContextMetadata` alongside a broadcast. The same nine steps apply to any field.

1. **Add the field to the message schema.** Message schemas live in `packages/fdc3-schema/schemas/api/` and follow a
   fixed shape: `allOf` of a base message schema (`appRequest.schema.json`, `agentResponse.schema.json` or
   `agentEvent.schema.json`) plus an inline object whose `payload` and `type` point at local `$defs`. Add the
   property to the payload definition in `$defs`, give it a `title` and a `description`, and add it to `required`
   only if it is genuinely mandatory — every payload here sets `"additionalProperties": false`, so the field must be
   declared or it is rejected. If the field should be absent rather than `null` when it has no value, leave it out of
   `required` and say so in the description: the DACP documentation calls this out as a protocol-wide convention.
2. **If the field is a shared or structured type, put it in the right shared schema.** Anything reusable goes in
   `packages/fdc3-schema/schemas/api/api.schema.json` under `definitions` (this file is hand-maintained and uses
   draft-07 `definitions`, whereas individual message schemas use `$defs`), and simple primitives with no reuse go in
   `packages/fdc3-schema/schemas/api/common.schema.json` under `$defs`. See "Shared definitions" below.
3. **Regenerate.** From `packages/fdc3-schema`:

   ```bash
   npm run generate   # mkdirs + typegen-browser + typegen-bridging + generate-type-predicates + lint
   npm run build      # generate, then tsc
   ```

   `npm run generate` alone is enough to refresh the committed `generated/` files; `build` additionally compiles them
   so you find out immediately if a dependent package's types no longer line up. Do not run `npx quicktype` yourself —
   the npm scripts wrap it.

4. **Update the hand-written interface.** Add the field to the matching `packages/fdc3-standard/src/api/*.ts`
   interface and, if it is a new named type, export it from `src/index.ts`. Where the field is metadata, remember
   that the standard side splits shared shapes the way the schema does — for example `ContextMetadata.ts` defines both
   `AppProvidableContextMetadata` (what an app may supply) and `ContextMetadata extends AppProvidableContextMetadata`
   (what a listener receives, with `source`/`timestamp`/`traceId` made required by the Desktop Agent).
5. **Send it from the proxy.** The request object is constructed inline in the proxy support class for that API
   family: `src/channels/DefaultChannel.ts` (`broadcastRequest`, `getCurrentContextRequest`, `clearContextRequest`),
   `src/apps/DefaultAppSupport.ts` (`openRequest`, `closeRequest`, `getInfoRequest`),
   `src/intents/DefaultIntentSupport.ts` (`findIntentRequest`, `raiseIntentRequest`). Add the field to that literal so
   the object still satisfies the generated TypeScript type — the compiler will tell you if you forget.
6. **Handle it in `fdc3-web-impl`.** Read it in the handler that already owns that message type (the `switch` on
   `msg.type` in `handlers/BroadcastHandler.ts`, or the equivalent in `IntentHandler.ts` / `OpenHandler.ts`) and put
   it on the response or event message you build. If you need a new identifier for the message, remember the
   `ServerContext` UUID counter is sequential in tests and every extra `sc.createUUID()` shifts later UUIDs, so
   existing feature files may need their expected values updated.
7. **Test on both sides.** Both suites are Cucumber/Gherkin over `quickpickle` + `vitest`; features live in
   `packages/fdc3-agent-proxy/test/features/` and `toolbox/fdc3-for-web/fdc3-web-impl/test/features/`, with step
   definitions beside them. New scenarios usually start from an existing one for the same call. The proxy suite
   asserts on the messages it posted with the `matches_type` column, which validates each posted message against
   `packages/fdc3-schema/schemas/api/*.schema.json` through the monorepo-only helpers
   (`@qcomp/fdc3-schema/test/setupSchemaSteps.js`, `fdc3SchemaMatchers.js`) wired up in
   `test/step-definitions/generic.steps.ts` — that is why an undeclared field fails the feature rather than silently
   passing. If the schema for a message has an invariant worth pinning down, add a plain vitest test next to
   `packages/fdc3-schema/test/getCurrentContextResponse.schema.test.ts`, which loads the schemas with AJV and
   validates payloads directly.
8. **Document it.** Update the affected `website/docs/api/ref/*.md` page for the public signature, and add the field
   to the message's section in `website/docs/api/specs/desktopAgentCommunicationProtocol.md`, which documents each
   message group under the API function it supports and links the schema with a
   `pathname:///schemas/next/api/<file>.schema.json` URL. If the field changes what a conformant Desktop Agent MUST
   do, add or amend the bullet in the "Desktop Agent API Standard Compliance" list at the top of
   `website/docs/api/spec.md`.
9. **Add a CHANGELOG entry.** `CHANGELOG.md`, under `[Unreleased]`, in `Added` / `Changed` / `Fixed` as appropriate,
   appended to the bottom of that section rather than the top. `CONTRIBUTING.md` requires the changelog update in the
   PR.

## Recipe: add a new API method or a new request/response pair

1. **Design the public signature first** in `packages/fdc3-standard/src/api/` — the interface for the object that
   exposes the method (`DesktopAgent.ts`, `Channel.ts`, `PrivateChannel.ts`) — and export any new type from
   `src/index.ts`. `AGENTS.md` "Adding a new API method" enumerates the same ordering.
2. **Create the message schemas** in `packages/fdc3-schema/schemas/api/`, one file per message, `<name>Request.schema.json`
   and `<name>Response.schema.json` (plus a `<name>Event.schema.json` if the call is event-driven). Copy the
   `allOf` + `$defs` structure from an existing pair such as
   `packages/fdc3-schema/schemas/api/clearContextRequest.schema.json` / `clearContextResponse.schema.json`. Name the
   file after the message's own `type` value and `$id`: a past audit fixed a heartbeat file whose name disagreed with
   its `$id`, and the name is what the docs and `matches_type` matchers resolve.
3. **Register the message type in the enumerations.** This is the step that is easiest to miss and it fails quietly.
   The generated `RequestMessageType`, `ResponseMessageType` and `EventMessageType` unions come from the `type`
   property enums in `schemas/api/appRequest.schema.json`, `agentResponse.schema.json` and `agentEvent.schema.json`,
   and `generate-type-predicates.ts` derives `AppRequestMessage`, `AgentResponseMessage` and `AgentEventMessage`
   from them. Add your new type string to the correct enum. Do not rename the `title` fields ("Request Message type",
   "Response Message Type", "Event Message Type") on which those generated alias names depend.
4. **If the message crosses a bridge, add the bridging wrappers too.** Bridging schemas are separate hand-written
   files in `packages/fdc3-schema/schemas/bridging/` that wrap the API message: `<name>AgentRequest.schema.json`
   provides the `$defs` payload and `$ref`s `agentRequest.schema.json`, and `<name>BridgeRequest.schema.json`
   `$ref`s that plus `bridgeRequest.schema.json` (see `openAgentRequest.schema.json` / `openBridgeRequest.schema.json`
   for the pattern; error-response variants follow `*AgentErrorResponse` / `*BridgeErrorResponse`). The bridge's own
   `type` enums live in `schemas/bridging/agentRequest.schema.json` and `agentResponse.schema.json`.
5. **Register the API schema files in the bridging generator.** The `typegen-bridging` script in
   `packages/fdc3-schema/package.json` lists each `api/*.schema.json` file the bridging schemas reference, before the
   `bridging` source folder. A bridging wrapper that `$ref`s an API schema which is not in that list will fail to
   resolve when generating `BridgingTypesCore.ts`. The browser generator needs no edit for a new API file — it passes
   the whole `api` folder as a source, so every `*.schema.json` in `schemas/api` becomes a top-level generated type —
   but API message files that are _supporting_ definitions rather than message types belong in the explicit list at
   the front of `typegen-browser` instead (that is how `api.schema.json` and `common.schema.json` are kept from being
   emitted as top-level types).
6. **Regenerate, then implement the client and server sides** (proxy support class, matching `fdc3-web-impl`
   handler plus the message's `case` in its `switch`), and add Cucumber scenarios to both suites, as in the previous
   recipe.
7. **Document** the message group in `website/docs/api/specs/desktopAgentCommunicationProtocol.md` (a `#### `
   subsection under `DesktopAgent`, `Channel` or `PrivateChannel`, linking each request and response schema), the new
   method in the relevant `website/docs/api/ref/` page, the compliance list in `website/docs/api/spec.md` if it
   carries a MUST, and add the CHANGELOG entry.

## Shared definitions in `api.schema.json`

`packages/fdc3-schema/schemas/api/api.schema.json` holds the reusable protocol vocabulary under `definitions`:
`AppIdentifier`, `DesktopAgentIdentifier`, `Icon`, `Image`, `AppMetadata`, `IntentMetadata`, `AppIntent`,
`DisplayMetadata`, `Channel`, `ContextMetadata`, `AppProvidableContextMetadata`, the error enums (`ChannelError`,
`OpenError`, `ResolveError`, `ResultError`, `CloseError`, `BridgingError`), `ImplementationMetadata`,
`IntentResolution`, `IntentResult`, `FDC3EventType`, `FDC3Event`, `PrivateChannelEventType` and
`PrivateChannelEvent`, among others. Individual schemas reach them by `$ref` with the file name and the draft-07
keyword, for example `"$ref": "api.schema.json#/definitions/AppIdentifier"` (as in
`schemas/api/appRequest.schema.json`, which types the request `meta.source` that way) or
`"$ref": "api.schema.json#/definitions/AppProvidableContextMetadata"` (as in `schemas/api/broadcastRequest.schema.json`).

Because these definitions are shared, a change there ripples the other way: it alters every message that references
them at once, and usually the corresponding hand-written interface in `packages/fdc3-standard/src/api/` has to move
in the same commit. The bridging schemas reference several of them directly across folders, e.g.
`packages/fdc3-schema/schemas/bridging/common.schema.json` `$ref`s
`../api/api.schema.json#/definitions/AppIdentifier` and `DesktopAgentIdentifier`, and
`openAgentRequest.schema.json` combines `DesktopAgentIdentifier` and `AppIdentifier` for its `app` field. Grep for
the definition name before you change it, then regenerate `fdc3-schema` and rebuild the dependants, since a rename
here is a compile error in `fdc3-agent-proxy`, `fdc3-web-impl` and `fdc3-get-agent` rather than a silent one.

## Context types are a separate pipeline

Context data does not flow through the DACP message schemas. It has its own schemas, its own generated file and its
own documentation generator:

- Sources: `packages/fdc3-context/schemas/context/*.schema.json`. Every type `allOf`s `context.schema.json` and
  declares its identity as a `const` on the `type` property (e.g. `"const": "fdc3.instrument"`).
- Generated: `packages/fdc3-context/generated/context/ContextTypes.ts`, produced by
  `npm run build` in `packages/fdc3-context` (the `typegen` script runs
  `s2tQuicktypeUtil.cjs ../../fdc3-schema/schemas/api/api.schema.json context ../generated/context/ContextTypes.ts`,
  which is why `api.schema.json` is passed in — context schemas reference API types such as `ContextMetadata`).
  `packages/fdc3-context/src/index.ts` is nothing but `export * from '../generated/context/ContextTypes.js'`, and
  `AGENTS.md` and `CONTRIBUTING.md` both say this package contains only schemas and generated code.
- Hand-written companions in `fdc3-standard`: adding a standard type means adding its `fdc3.*` string to
  `StandardContextType` (or `ExperimentalContextType`) in `packages/fdc3-standard/src/context/ContextType.ts`, to the
  deprecated-but-still-checked `ContextTypes` enum in the same file, and — for a standard type — to the exhaustive
  tuple in `packages/fdc3-standard/src/internal/contextConfiguration.ts`. That tuple is typed with
  `exhaustiveStringTuple<StandardContextType>()`, so it is a compile error to extend the union and not the tuple.
- Documentation: `website/schema2Markdown.js` reads the copied schemas under `website/static/schemas/next/context/`
  and writes one page per object into `website/docs/context/ref/`, adding entries to `website/sidebars.json`. The
  file name comes from the schema `title` with spaces removed, and any type whose string is `fdc3.<subcategory>.*`
  (such as `fdc3.chat.message` or `fdc3.security.userRequest`) is written to a subdirectory named after the
  subcategory — `website/docs/context/ref/chat/`, `website/docs/context/ref/security/` — and hung under a matching
  sidebar category. Adding a `fdc3.payment` type therefore produces `ref/Payment.md`, but adding
  `fdc3.chat.reminder` produces `ref/chat/Reminder.md`.
- Also update the standard context type list and any normative wording in `website/docs/context/spec.md`, which
  lists each type next to its `pathname:///schemas/next/context/<file>.schema.json` link.

`website/static/schemas/next/` is git-ignored and rebuilt by `npm run copy-schemas`; the committed artifacts of this
pipeline are the generated `ContextTypes.ts` and the markdown under `website/docs/context/ref/`. Never hand-edit
either — regenerate them.

## Regeneration commands, verbatim

From the repo root, using each package's own scripts:

```bash
# Wire protocol: schemas/api and schemas/bridging -> generated/api, generated/bridging
cd packages/fdc3-schema && npm run generate   # mkdirs, typegen-browser, typegen-bridging, predicates, lint
cd packages/fdc3-schema && npm run build      # generate + tsc
cd packages/fdc3-schema && npm test           # generate + tsc + vitest run

# Context types: schemas/context -> generated/context/ContextTypes.ts
cd packages/fdc3-context && npm run build
cd packages/fdc3-context && npm test

# Consumers (rebuild fdc3-schema/fdc3-context first, then)
cd packages/fdc3-standard && npm test
cd packages/fdc3-agent-proxy && npm test
cd toolbox/fdc3-for-web/fdc3-web-impl && npm test

# Website: copy schemas, regenerate the context reference pages, then build to check links
cd website && npm run copy-schemas && node schema2Markdown.js
cd website && npx docusaurus build
```

`npm run build` at the root builds every workspace in dependency order, which is the right final check, but during
iteration build only the package you changed plus its dependants. The scripts that hide the real invocation are
`typegen-browser` and `typegen-bridging` in `packages/fdc3-schema/package.json`; both call
`node ../s2tQuicktypeUtil.cjs` from inside `schemas/`, and that utility exists to work around a quicktype bug where
passing a directory as input makes it ignore `-s schema` (see `packages/fdc3-schema/README.md`, which still refers to
an older `quicktypeUtil.js` — the file in the tree is `s2tQuicktypeUtil.cjs`). Its arguments are the only place that
decides which schemas are treated as reference-only inputs versus top-level generated types.

## What catches drift, and where to look when it does

The generated files are committed, so a stale `generated/` tree is visible in the diff; regenerate rather than reason
about it. The checks that actually fail are:

- `ContextTypeSync.test.ts` in `packages/fdc3-standard/test/` collects every `fdc3.*` constant from
  `packages/fdc3-context/schemas/context/*.schema.json` and fails if any is missing from the `ContextTypes` enum in
  `src/context/ContextType.ts` — the standard context-type drift detector.
- `tsc` in `fdc3-standard` rejects an extended `StandardContextType` without the matching
  `contextConfiguration.ts` tuple.
- `tsc` in `fdc3-agent-proxy`, `fdc3-web-impl` and `fdc3-get-agent` rejects a message literal that no longer matches
  the generated wire type, which is what makes a schema change without a proxy/web-impl change fail rather than pass.
- The Cucumber `matches_type` matcher validates each posted message against the real JSON schema at test time, so an
  undeclared field, a missing required field, or a payload that violates an `oneOf`/conditional constraint fails the
  feature on the proxy or web-impl side.
- The plain vitest schema tests under `packages/fdc3-schema/test/` pin specific payload invariants.
- `npx docusaurus build` in `website/` catches broken relative links in the documentation you touched; the
  `pathname:///schemas/...` links resolve against the files `npm run copy-schemas` places in
  `website/static/schemas/next/`, so check the schema file exists rather than assuming the build will.

## Files never to hand-edit

`packages/fdc3-schema/generated/` (including `BrowserTypes.ts`, `BrowserTypesCore.ts`, `BrowserTypesValidation.ts`
and the bridging equivalents), `packages/fdc3-context/generated/`, `website/docs/context/ref/`,
`website/static/schemas/`, `website/versioned_docs/` and `website/versioned_sidebars/`, and the `fdc3` /
`fdc3-commonjs` roll-up packages, which contain only re-exports. `AGENTS.md` "What NOT to Edit" is the authority
here: fix the schema or the generator, then regenerate.
