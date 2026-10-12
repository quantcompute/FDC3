---
name: fdc3-context-types
description: >-
  Use when typing the context payloads an FDC3 application broadcasts, sends with
  `raiseIntent`/`raiseIntentForContext`/`open`, or receives through an `addContextListener`
  handler, and when declaring a company- or vendor-specific context type in TypeScript.
  Covers the `@finos/fdc3-context` package: the base `Context` shape (`type`, optional `id`
  and `name`), the shipped standard and experimental context interfaces by domain, the
  `ContextType`/`StandardContextType` unions and the `isStandardContextType` guard (which
  live in `@finos/fdc3-standard`, not here), the `AppIdentifier` name clash between the two
  packages, the generated nature of every file in this package and how it is regenerated,
  and the `ContextMetadata` an agent may attach. Not for the Desktop Agent API surface
  (see `fdc3-app-integration`) or for changing the context JSON Schemas themselves (see
  `fdc3-schema-change`).
license: Apache-2.0
metadata:
  fdc3-package: '@finos/fdc3-context'
  fdc3-package-version: '3.0.0-beta.1'
---

# Using the context types in `@finos/fdc3-context`

This skill ships inside the `@finos/fdc3-context` package tarball and describes the API of the version it ships
with — `3.0.0-beta.1`. The `metadata.fdc3-package-version` above is the record of which version that is: when the
monorepo bumps the shared version, this file has to be reviewed, and the `fdc3-version-bump` skill's
`scripts/check-skill-versions.mjs` is what reports it as stale.

Everything below is drawn from the sources in this repository, not from general knowledge of FDC3. Where the
published documentation and the implementation disagree, the implementation is what runs and the disagreement is
called out. Note that for this particular package the "implementation" is a generated file, and the package's own
README (`packages/fdc3-context/README.md`, lines 5–7) states that the JSON Schema is the source of truth and the
generated TypeScript merely follows it.

## What the package is

`@finos/fdc3-context` has no hand-written logic at all. Its entire source is a single re-export line:

```ts
// packages/fdc3-context/src/index.ts
export * from '../generated/context/ContextTypes.js';
```

So everything a consumer imports from `@finos/fdc3-context` — the interfaces, the subtype helper types, the
`Convert` class — comes out of the generated file `generated/context/ContextTypes.ts`. That file is produced by
quicktype from the JSON Schema sources; no type definitions are authored by hand — the generated file is the whole
type surface. The practical consequences are covered under "This package is generated" below.

The package is `"type": "module"`, `sideEffects: false`, and exports a single entry point (`dist/src/index.d.ts`
/ `dist/src/index.js`) — see `packages/fdc3-context/package.json`. It is also re-exported, in part, by
`@finos/fdc3-standard` and therefore by the `@finos/fdc3` roll-up (`packages/fdc3-standard/src/index.ts:13`
re-exports the `Context` type only). An application that only sends and receives context may still want to depend
on this package directly to reach the concrete standard types.

## The base context shape

A context is any object with a `type` string. The base contract is declared twice in the generated file — once as
`Context` (`generated/context/ContextTypes.ts:989`) and once as `ContextElement` (`…:161`), a quicktype-generated
duplicate used for inline references such as `Action.context`, `TransactionResult.context`, `Chart.otherConfig`
and `MessageObject.context`. They carry the same three documented members plus an index signature:

| Field  | Type                     | Required | Meaning for the Desktop Agent                                                                                            |
| ------ | ------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `type` | `string`                 | yes      | The only required field. Used to route broadcast context and to filter `addContextListener` / `getCurrentContext` calls. |
| `id`   | `{ [key: string]: any }` | no       | A map of equivalent identifiers (ISIN, CUSIP, FIGI, …). Pure business data — the agent does not interpret it.            |
| `name` | `string`                 | no       | Human-readable/display name. Business data, not routing.                                                                 |

The index signature `[property: string]: any` means every context type in this package is open to arbitrary extra
properties, and — importantly — TypeScript will **not** flag a misspelled property on a context literal. The base
interface is deliberately generic: it declares `type: string`, not a literal `'fdc3.context'`, because it is a
contract to be extended rather than a wire type of its own (the `Context.md` ref page's "Type: `fdc3.context`" is
documentation framing, not a type you would broadcast).

Only `type` carries meaning for the Desktop Agent. `id` and `name` are passed through untouched; metadata is
deliberately kept _outside_ the context object and delivered separately as `ContextMetadata` (see below), per the
spec's argument at `website/docs/context/spec.md` lines 287–299.

## Standard, experimental and private context types

The standard FDC3 context types (`fdc3.instrument`, `fdc3.contact`, …) are **conventions, not a closed set**.
Applications are free to define their own types, and the specification's rule is namespacing: standard types use
the reserved `fdc3.` prefix; anything an organization defines MUST use its own namespace, by reverse-domain
(`com.example.account`) or a well-known abbreviation (`acme.rfq`) — see `website/docs/context/spec.md` lines
152–167. A bare `account` risks colliding with a future standard type, and `fdc3.account` is reserved.

Because `ContextType` is `StandardContextType | ExperimentalContextType | (string & {})`
(`packages/fdc3-standard/src/context/ContextType.ts:53`), a string literal custom type is accepted by the API
while still autocompleting the known ones. The type-safe way to declare a custom context is to extend the base
interface and narrow `type` to your literal:

```ts
import { Context } from '@finos/fdc3-context';

export interface Fund extends Context {
  type: 'com.example.fund'; // narrower than the base `string`
  id: { FIGI: string }; // required, so use the concrete map, not the base `any` map
  domicile?: string; // extra fields are allowed by the index signature
}
```

This works because `broadcast`, `raiseIntent`, `open` and `addContextListener` all accept the `Context` type
(re-exported into `@finos/fdc3-standard`), and any interface extending it is assignable to it.

## `ContextType` vs string literals, and where the guards live

Nothing about the type _names_ lives in `@finos/fdc3-context`. The union, its two halves and the runtime guard are
all in `@finos/fdc3-standard`:

| Symbol                                         | Where it is declared                                   |
| ---------------------------------------------- | ------------------------------------------------------ |
| `StandardContextType` (23 string literals)     | `packages/fdc3-standard/src/context/ContextType.ts:9`  |
| `ExperimentalContextType` (11 string literals) | `packages/fdc3-standard/src/context/ContextType.ts:37` |
| `ContextType` (union + any string)             | `packages/fdc3-standard/src/context/ContextType.ts:53` |
| `ContextTypes` enum (**deprecated** since 2.2) | `packages/fdc3-standard/src/context/ContextType.ts:58` |
| `isStandardContextType(contextType)`           | `packages/fdc3-standard/src/api/Methods.ts:17`         |
| `isStandardIntent(intent)`                     | `packages/fdc3-standard/src/api/Methods.ts:25`         |

`isStandardContextType` is a type predicate (`contextType is StandardContextType`). It returns `true` only for
the 23 names in `StandardContextType`; the _experimental_ types (`fdc3.order`, `fdc3.trade`, `fdc3.payment`,
`fdc3.security.*`, …) return `false` even though this package ships interfaces for them. Do not use it to mean
"is an FDC3-defined type" — use it to mean "is a type with a stable standard definition". The deprecated
`ContextTypes` enum still exists and still carries every value (standard, experimental and security), but new code
should use the string literals or `StandardContextType`.

## This package is generated — never hand-edit it

`generated/context/ContextTypes.ts` is produced by quicktype from JSON Schema. The `typegen` script in
`packages/fdc3-context/package.json` says exactly how:

```
"typegen": "cd schemas && node ../s2tQuicktypeUtil.cjs ../../fdc3-schema/schemas/api/api.schema.json context ../generated/context/ContextTypes.ts"
```

Read from right to left, that means: the source schemas are the `.schema.json` files under
`packages/fdc3-context/schemas/context/` (the `context` directory, resolved from the `schemas/` cwd), and
`packages/fdc3-schema/schemas/api/api.schema.json` is loaded as an additional schema so cross-references such as
`../context/context.schema.json` (`api.schema.json:630`) resolve. `scripts/generate` runs `mkdirs`, then
`typegen`, then `lint` (ESLint + Prettier over `generated/`); `npm run build` runs `generate` then `tsc`.

The file opens with quicktype's boilerplate header (`ContextTypes.ts:1–42`), listing the `Convert.toX` helpers
and referring to a generic `"./file"` module — that header is generator output, not documentation of this package.

What to do instead of editing:

- **A context type is missing** → add its schema under `packages/fdc3-context/schemas/context/` (and add it to the
  standard/experimental unions in `fdc3-standard` if it is meant to be recognised), then regenerate. Do not add a
  hand-written interface to the generated file: `generated/` is overwritten on every `generate`/`build`, so it
  disappears — put the definition in the schema instead.
- **A field is wrong** → fix the JSON Schema, which the package README declares authoritative over the generated
  TypeScript. Every derived schema imports the base via a `BaseContext` `$ref` (e.g. `…/instrument.schema.json:151`)
  and carries an `examples` array (`…:153`) that `test/validate-schema-examples.test.ts` validates with Ajv. The
  base `context.schema.json` (`packages/fdc3-context/schemas/context/context.schema.json:12`) declares that
  `BaseContext` definition but has no `examples` of its own, which is why the test skips it.
- Expect quicktype naming artefacts: subunit types get random names such as `PurpleInstrumentIdentifiers`
  (`generated/context/ContextTypes.ts:348`), `FluffyContactIdentifiers` (`…:939`) and `TentacledAppID` (`…:918`).
  The package README (lines 13–46) makes the same point using its own examples (`PurpleId`, `FluffyMarket`,
  `TentacledIdentifier`) and asks that these names be ignored as they are not part of the intended type structure.

## The shipped context types, by domain

The full generated surface is enumerable from the interface list in `ContextTypes.ts`; grouped by domain it is:

| Domain                   | Standard types (`StandardContextType`)                                                                                                                         | Interfaces                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Instruments & markets    | `fdc3.instrument`, `fdc3.instrumentList`                                                                                                                       | `Instrument`, `InstrumentList`                                                                  |
| Contacts & organizations | `fdc3.contact`, `fdc3.contactList`, `fdc3.organization`                                                                                                        | `Contact`, `ContactList`, `Organization`                                                        |
| Reference data           | `fdc3.country`, `fdc3.currency`                                                                                                                                | `Country`, `Currency`                                                                           |
| Communication            | `fdc3.email`, `fdc3.message`, `fdc3.fileAttachment`, `fdc3.action`                                                                                             | `Email`, `Message`, `FileAttachment`, `Action`                                                  |
| Charts & ranges          | `fdc3.chart`, `fdc3.timeRange`                                                                                                                                 | `Chart`, `TimeRange`                                                                            |
| Transactions             | `fdc3.transactionResult`                                                                                                                                       | `TransactionResult`                                                                             |
| Portfolios & valuations  | `fdc3.portfolio`, `fdc3.position`, `fdc3.valuation`                                                                                                            | `Portfolio`, `Position`, `Valuation`                                                            |
| Misc                     | `fdc3.interaction`, `fdc3.nothing`                                                                                                                             | `Interaction`, `Nothing`                                                                        |
| Chat (standard)          | `fdc3.chat.initSettings`, `fdc3.chat.message`, `fdc3.chat.room`, `fdc3.chat.searchCriteria`                                                                    | `ChatInitSettings`, `ChatMessage`, `ChatRoom`, `ChatSearchCriteria`                             |
| Trading (experimental)   | `fdc3.order`, `fdc3.orderList`, `fdc3.product`, `fdc3.trade`, `fdc3.tradeList`                                                                                 | `Order`, `OrderList`, `Product`, `Trade`, `TradeList`                                           |
| Payments (experimental)  | `fdc3.payment`                                                                                                                                                 | `Payment`                                                                                       |
| Security (experimental)  | `fdc3.security.user`, `fdc3.security.userRequest`, `fdc3.security.symmetricKeyRequest`, `fdc3.security.symmetricKeyResponse`, `fdc3.security.encryptedContext` | `User`, `UserRequest`, `SymmetricKeyRequest`, `SymmetricKeyResponse`, `EncryptedContextWrapper` |

The `@experimental` marker appears in the generated doc comments (e.g. `Payment` at `ContextTypes.ts:1688`) and
means the type may change outside the normal FDC3 versioning policy.

## The `AppIdentifier` name clash

`AppIdentifier` is declared in **both** packages, and they are not identical:

- `@finos/fdc3-context` — generated at `generated/context/ContextTypes.ts:125`: mutable `appId`, `desktopAgent`,
  `instanceId`, plus `[property: string]: any`.
- `@finos/fdc3-standard` — hand-written at `packages/fdc3-standard/src/api/AppIdentifier.ts:13`: `readonly`
  fields and no index signature.

`fdc3-standard` re-exports its own version and explicitly shadows the generated one:

```ts
// packages/fdc3-standard/src/index.ts:8
//explicit overwrite of conflicting & equivalent export from ContextTypes
export { AppIdentifier } from './api/AppIdentifier.js';
```

The consequence for a consumer: `import { AppIdentifier } from '@finos/fdc3'` yields the `fdc3-standard`
(readonly) interface, while `import { AppIdentifier } from '@finos/fdc3-context'` yields the generated one that
`Action.app` and other generated members use. The two are structurally close but not interchangeable in one
direction: the generated type has an index signature, so a value typed by `fdc3-standard`'s `AppIdentifier` is
**not** assignable to the generated type (a type without an index signature is not assignable to one that
declares a `[property: string]: any`), whereas the reverse assigns cleanly. Prefer the `fdc3-standard` type in
application code and only reach for the generated one when working with a generated member that requires it.

## Using context types at runtime

The context _types_ here are only data shapes; the behaviour lives in the Desktop Agent API
(`@finos/fdc3-standard`). The touch points that consume these types are:

- **Broadcast** — `fdc3.broadcast(context, metadata?)` sends a `Context` (plus optional app-provided
  `ContextMetadata` fields) to the app's current channel. Broadcasting while not joined to a channel silently
  does nothing.
- **Intents** — `fdc3.raiseIntent(intent, context?, app?, …)` and `fdc3.raiseIntentForContext(context, …)` pass a
  context as the intent payload; `findIntent(intent, context?, resultType?)` and `findIntentsByContext(context)`
  use it for discovery.
- **Listeners** — `fdc3.addContextListener(type | type[] | null, handler)` filters by context type (`null` = all);
  `addIntentListener(intent, handler)` and `addIntentListenerWithContext(intent, contextType, handler)` receive the
  context. Every handler receives `(context: Context, metadata: ContextMetadata)`.
- **Reading current context** — a `Channel`'s `getCurrentContext(contextType)` / `getCurrentContextWithMetadata()`.

`ContextMetadata` (`packages/fdc3-standard/src/api/ContextMetadata.ts:84`) is what the agent attaches _around_ the
context. The agent always supplies `source` (an `AppIdentifier`), `timestamp` (a `Date`) and `traceId`; the
originating app may contribute `traceId`, `signature`, `antiReplay` and `custom` via
`AppProvidableContextMetadata` (`ContextMetadata.ts:53`), forwarded by the agent but with `source`/`timestamp`
overwritten. This is why context objects themselves should not carry metadata fields — pass them as `broadcast`'s
second argument, `open`'s third, or `raiseIntent`'s fifth instead.

## Gotchas worth checking first

| Symptom                                                       | Cause / what to do                                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| A context literal with a misspelled field compiles            | Every generated interface has `[property: string]: any`; TypeScript cannot catch typos here        |
| `isStandardContextType('fdc3.trade')` is `false`              | It tests `StandardContextType` only; experimental and security types are excluded on purpose       |
| `Date`-typed fields reject an ISO string (or vice versa)      | Standard ref pages say dates are strings, but the generated types use `Date` — see the table above |
| A `'fdc3.context'` object looks valid but no listener matches | The base `Context` is a contract, not a routable type; give it a concrete `type`                   |
| Importing `AppIdentifier` from both packages                  | They are different interfaces; use the `fdc3-standard` one in application code                     |
| A hand-edited type disappears after `npm run build`           | `generated/` is regenerated from the schemas; change the schema, not the TypeScript                |
| `Convert.toX(json)` throws on otherwise-valid JSON            | `Convert` asserts the generated shape at runtime and is stricter than the wire format in places    |

## Where the detail lives

- `packages/fdc3-context/generated/context/ContextTypes.ts` — the whole generated surface (interfaces + `Convert`).
- `packages/fdc3-context/src/index.ts` — the single re-export; proof the package has no hand-written logic.
- `packages/fdc3-context/package.json` — `typegen`/`build` scripts and the `files` array.
- `packages/fdc3-context/s2tQuicktypeUtil.cjs` — how the schema files are handed to quicktype.
- `packages/fdc3-context/schemas/context/*.schema.json` — the authoritative JSON Schema definitions and examples.
- `packages/fdc3-context/test/validate-schema-examples.test.ts` — Ajv validation of the schema examples.
- `packages/fdc3-context/README.md` — the JSON-Schema-over-TypeScript rule and the quicktype naming caveats.
- `packages/fdc3-standard/src/context/ContextType.ts` and `packages/fdc3-standard/src/api/Methods.ts` — the
  `ContextType` unions and the `isStandardContextType` guard.
- `packages/fdc3-standard/src/api/ContextMetadata.ts` — `ContextMetadata` / `AppProvidableContextMetadata`.
- `website/docs/context/spec.md` — the normative Context Data specification (namespacing, `id`, `name`, metadata).
- `website/docs/context/ref/` — one page per standard type, plus `chat/` and `security/` subdirectories.
- `website/docs/api/ref/Types.md` — the `Context` type as the API sees it, and the metadata interfaces.
