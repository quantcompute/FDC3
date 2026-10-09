---
name: fdc3-appd-authoring
description: Author, edit and review FDC3 App Directory (AppD) records - the JSON that tells a Desktop Agent which apps exist, how to launch them and which intents they listen for. Use when adding an AppD record for a new conformance mock app or a demo/example app, when a record must be added to website-conformance.json or localhost-conformance.json, when an app is missing from a launcher or intent resolver, when fdc3.open, fdc3.findIntent or fdc3.getAppMetadata cannot find an app, when checking appId, title, type, details, version, fdc3Version, icons, hostManifests, localizedVersions or interop fields, or when a record has to be validated against appd.schema.json.
license: Apache-2.0
---

# Authoring FDC3 App Directory records

An App Directory (appD) record is the only thing that tells a Desktop Agent that an application exists. The App
Directory overview states the consequence directly: "if an app is not listed in appD, the Desktop Agent can't ensure its
participation in context sharing or use it to resolve intents" (`website/docs/app-directory/overview.md`). A record that
is merely _almost_ right - a missing `title`, an intent declared in the wrong place, a `fdc3Version` string the
implementation cannot parse - produces exactly the same outcome as no record at all, usually with no error message
anywhere. That is why this skill exists: the failure mode is silence.

Read the normative sources before changing a record:

- `website/docs/app-directory/spec.md` - the App Directory API specification. Short, and worth reading in full; it lists
  what a compliant App Directory MUST, SHOULD and MAY do.
- `website/docs/app-directory/overview.md` - the concepts: why the directory exists, how `appId` works, how directories
  are discovered, and what the optional `interop` metadata is for.
- The machine-readable definition: `packages/fdc3-standard/src/app-directory/specification/appd.schema.json`. This is the
  source of truth for every field, and it is also the OpenAPI document that the website renders at
  `/docs/next/app-directory/api` (registered in `website/docusaurus.config.js`). `website/static/schemas/next/appd.schema.json`
  is a build-time copy of exactly the same file - the website's `copy-appd` script (`website/package.json`) copies it - so
  edit the copy under `packages/fdc3-standard`, never the copy under `website/static`.

`website/docs/app-directory/spec.md` documents the compliance obligations of the _directory service_. Record authors are
bound by two of them: `appId` values assigned to applications must be unique within the directory, and the records served
must meet the minimum requirements of the OpenAPI specification (that is, the `required` list of the `Application`
schema, and the constraints of each referenced schema).

## What the record is for

A record does three jobs, and all three are driven from the same JSON:

1. **Discovery.** "An appD provides a way for users to discover the apps they need" (`overview.md`). A launcher or app
   catalog renders human-readable material from the record: `title`, `tooltip`, `description`, `icons`, `screenshots`,
   `publisher`, `categories`, support contacts. These fields matter even though no Desktop Agent logic reads them - they
   are the reason a user can find the app at all.
2. **Launching.** `type` and `details` tell the Desktop Agent how to start the application, and `hostManifests` carries
   the same information for container products that have their own manifest format.
3. **Intent resolution.** "AppD provides information to the Desktop Agent on which applications can handle particular
   intents and the context types they support as input to them. This allows the Desktop Agent to implement an intent
   resolver" (`overview.md`). The declaration lives in `interop.intents.listensFor`. On the API side, a compliant Desktop
   Agent SHOULD "allow applications to register an `IntentHandler` for particular Intent and Context type pairs by
   providing `interop.intents.listensFor` metadata in their AppD record" (`website/docs/api/spec.md`). In practice this
   means an app that listens for `ViewChart` at runtime but never declares it in its record will not be offered by
   `fdc3.findIntent` or resolved by `fdc3.raiseIntent`.

The record is deliberately not a W3C Web App Manifest: "a different use-case ... which is hosted on the same domain as
the app, is limited to web apps, and is generally used to 'install' an app that the user has already accessed"
(`overview.md`). A record can point at such a manifest, via `hostManifests`.

## Where records are read in this repository

Understanding the reader makes the field rules obvious. The web-resident Desktop Agent living in this repo consumes
records like this:

- `toolbox/fdc3-for-web/fdc3-web-impl/src/directory/BasicDirectory.ts` - the in-memory directory. `addApps` filters a
  record out when `appSupportsFdc3Version` returns false, and **silently ignores** a record whose `appId` is already
  present. `retrieveApps(contextType, intentName, resultType)` selects apps by walking `interop.intents.listensFor`;
  `retrieveAppsById` looks a record up by `appId` alone.
- `toolbox/fdc3-for-web/fdc3-web-impl/src/handlers/IntentHandler.ts` - `findIntent` and `findIntentsByContext` answer
  from `retrieveApps`/`retrieveIntents`; `createPendingIntentIfAllowed` (used when raising an intent at an app that is
  not yet running) consults the record again and answers `ResolveError.NoAppsFound` when the app has not declared the
  intent and context pair.
- `toolbox/fdc3-for-web/fdc3-web-impl/src/handlers/OpenHandler.ts` - `open` and `getAppMetadata` call `retrieveAppsById`;
  an unknown `appId` yields `ResolveError.TargetAppUnavailable`. `filterPublicDetails` builds the `AppMetadata` handed
  back to apps from a fixed subset of the record: `appId`, `version`, `title`, `tooltip`, `description`, `icons`,
  `screenshots`, plus the instance's `instanceId`.
- `toolbox/fdc3-for-web/demo/src/client/da/FDC3_JSONDirectory.ts` - the demo Desktop Agent loads a directory by fetching
  a URL and reading `data.applications` only.
- `toolbox/fdc3-for-web/reference-ui/src/intent_resolver.ts` - the resolver UI renders `icons[0].src` and the label
  `title ?? name ?? appId`; the "open apps" list falls back to `title ?? appId`.
- `toolbox/fdc3-example-apps/main.ts` - collects each example app's `static/appd.v2.json`, rewrites localhost URLs to the
  port it assigns, and writes a combined directory for the demo.
- `packages/fdc3-standard/test/AppDirectory.test.ts` - validates the two shipped example records against the
  `Application` schema.
- `toolbox/fdc3-conformance/src/test/support/metadata-support.ts` - `MetadataValidator` asserts that every property of
  the `AppMetadata` a Desktop Agent returns is one of a fixed list of API fields, so record-only material such as
  `publisher` or `categories` must not leak into `getAppMetadata` responses.

Note the shape of `filterPublicDetails`: `version`, `tooltip` and `screenshots` are the fields that reach applications
through `fdc3.getAppMetadata`. Leaving them out is legal, but the metadata an app receives is then thinner.

## The record, field by field

The schema defines `BaseApplication` (all fields optional, except as marked in the extended `Application` schema) and
requires exactly four properties: **`appId`, `title`, `type`, `details`**. Everything else is optional, and
`additionalProperties` is not restricted at the top level, so unknown fields (such as the legacy `name` still present in
many records in this repo) validate but are not part of the standard.

### Identity

- `appId` (required) - "The unique application identifier located within a specific application directory instance."
  Uniqueness within the directory is a MUST in `spec.md`. The overview explains the fully-qualified form: the local id
  is made globally unique as `appId@fqdn`, where the fqdn is the host of the directory serving it. Because that syntax
  is built by appending `@host`, keep `appId` free of `@` and of characters that need escaping in the `/v2/apps/{appId}`
  path. The repo's suites use PascalCase ids (`IntentAppAId`, `MockAppId`) or lowercase ids (`pricer`, `app1`); either
  style works, consistency within a file is what matters. The schema itself places no pattern on the field.
- `version` - a free-form string: "This allows multiple app versions to be defined using the same app name. This can be a
  triplet but can also include things like 1.2.5 (BETA)". There is no pattern, so nothing stops you writing nonsense;
  the repo's records all use a simple `1.0.0` form.
- `fdc3Version` - the FDC3 version range the app supports, "expressed as an npm-style semantic version range using
  two-component FDC3 versions, for example `2.2`, `<=2.3`, `~2.3`, `^2.2`, or `>=2.2`". Desktop Agents "MAY use this value
  to filter applications that are incompatible with the FDC3 version they provide", and this repo's implementation does
  exactly that: `appSupportsFdc3Version` treats a missing value as compatible with everything, an unparsable value as
  incompatible, and otherwise applies the range. Every record currently in this repo's suites omits the field, which is
  what keeps a mock app visible no matter which Desktop Agent version is under test. Add it only when you mean to
  exclude the app from some agents.

### Presentation

- `title` (required) - "Title for the application, typically used in a launcher UI." This is the label the reference
  resolver UI prefers, so it is the field a user actually reads.
- `description` - "This will typically be a 1-2 paragraph style blurb about the application."
- `tooltip` - "Optional tooltip description e.g. for a launcher"; it is one of the fields returned in `AppMetadata`.
- `icons` / `screenshots` - arrays of `Icon` and `Screenshot` objects. Both require `src` (a URI) and forbid additional
  properties. `size` is "Icon dimension formatted as `<height>x<width>`" and `type` is the media type, used only when
  `src` does not make it obvious. A launcher may use several icon sizes; the in-repo resolver UI shows the first entry
  only, so order them by what you want displayed.
- `publisher` - "The name of the company that owns the application."
- `categories` - "meant as a hint to catalogs or stores"; the schema description asks authors to "use lower-case and,
  where possible, to select categories from the following list" and then lists `allocations`, `analytics`, `charts`,
  `chat`, `communication`, `compliance`, `crm`, `developer tools`, `events`, `execution management`, `file sharing`,
  `market data`, `news`, `networking`, `office apps`, `order management`, `other`, `portfolio management`,
  `presentation`, `pricing`, `productivity`, `research`, `risk`, `screen sharing`, `security`, `spreadsheet`,
  `trade cost analysis`, `trading system`, `training`, `travel`, `video`, `visualization`, `weather`. The repo's own
  records often ignore this advice, and nothing enforces it; still, a free-text category is a hint nobody can act on.
- `contactEmail`, `supportEmail` (`format: email`), `moreInfo` (`format: uri`) - contact and documentation links.
- `lang` - "A language tag that specifies the primary language of both the application and its AppD entry, as defined by
  IETF RFC 5646", matching `^[a-z]{2}(-[a-zA-Z0-9]{2,8}){0,1}$`.
- `localizedVersions` - a map from language tag to a partial `BaseApplication`, "Provides localized alternatives to any
  field of the AppD record, which may also refer to an alternative version of the application that is also localized
  (e.g. by providing an alternative URL)". Because the target schema is `BaseApplication`, an entry such as
  `{ "title": "...", "description": "..." }` is complete and valid; you do not repeat `appId`, `type` or `details`.

### Launching

- `type` (required) - "The technology type that is used to launch and run the application", one of `web`, `native`,
  `citrix`, `onlineNative`, `other`. The schema's description of `Type` adds: "FDC3 Desktop Agents MUST support at least
  the `web` application type and MAY support any or all of the other types."
- `details` (required) - the type-specific launch information, defined as an `anyOf` over five shapes: `WebAppDetails`
  (`url`), `NativeAppDetails` (`path`, optional `arguments`), `CitrixAppDetails` (`alias`, optional `arguments`),
  `OnlineNativeAppDetails` (`url`) and `OtherAppDetails` (empty). Each shape forbids additional properties, and the
  schema does **not** tie `details` to `type`: a `web` app whose `details` also carries `path` fails validation, but a
  `native` app carrying only a `url` passes because it happens to match the `onlineNative` shape. Choose the pair
  deliberately - the Desktop Agent asked to launch the app will use `type` to decide what to do with `details`.
  `type: "other"` is the exception that still needs `details`, as the empty object `{}`.
- `hostManifests` - "A mapping from host name to a host-specific application manifest object or URI from which that
  manifest can be retrieved", where the manifest "MAY duplicate or override information provided in the `details`
  field". Each value is either a URI string or an arbitrary JSON object; the host key is the product's name (the records
  in this repo carry `sail`, `Finsemble`, `Glue42` and a `Web App Manifest` URI). Nothing in this repository reads this
  field, so treat it as pass-through configuration for the named container products: harmless to keep, never a
  substitute for correct `details`, and never something to invent values for.

### `interop`

`overview.md` describes the optional `interop` field as metadata that "supports intent resolution by declaring what
intents the app listens for (`interop.intents.listensFor`) and raises (`interop.intents.raises`)", helps catalog UIs find
apps that interoperate, and documents channel usage. "Applications only need to complete the elements of the `interop`
element that they make use of."

- `interop.intents.listensFor` - the field that changes Desktop Agent behaviour. It is a map from intent name to an
  `Intent` object whose only required property is `contexts`: "A comma separated list of the types of contexts the
  intent offered by the application can process, where the first part of the context type is the namespace". `resultType`
  optionally declares the output (`"fdc3.instrument"`, `"channel"`, or `"channel<fdc3.instrument>"`); the schema's
  `displayName` and `customConfig` are both marked deprecated, although existing records in this repo still use
  `displayName` to label test intents.
- `interop.intents.raises` - a map from intent name to **an array of context type names** the app may raise with. Use
  the name `any` for apps that call `fdc3.raiseIntentForContext`. The schema notes this metadata is not currently used
  by Desktop Agents; it documents the app for other developers.
- `interop.userChannels` - `broadcasts` and `listensFor`, each an array of context type names.
- `interop.appChannels` - an array of objects, each requiring `id` (the channel id - "N.b. in FDC3 2.0 this field was
  incorrectly called `name`"), plus optional `description`, `broadcasts` and `listensFor`.

## Authoring a record for this repo's suites

Most record work in this repository is one of three things: a mock app for the conformance suite, an example app for
the demo, or the workbench record.

### Conformance mock apps

`AGENTS.md` describes the contract for adding a conformance test: each mock app needs "a TypeScript source file in
`src/mock/`", "an HTML entry point in `static/apps/<app-name>/`" and "an AppD record in
`static/directories/website-conformance.json`". The records live in two files:

- `toolbox/fdc3-conformance/static/directories/website-conformance.json` - the copy the hosted suite publishes; its URLs
  point at `https://fdc3.finos.org/toolbox/fdc3-conformance/...`, which the versioning scripts rewrite for released
  snapshots (`website/package.json`'s `version:conformance-replace-path`, and `website/replaceConformanceUrls.js` for
  the `next` snapshot).
- `toolbox/fdc3-conformance/static/directories/localhost-conformance.json` - the copy a Desktop Agent running on the
  same machine loads; its URLs point at `http://localhost:3001/...`, which is where `npm run dev` in
  `toolbox/fdc3-conformance` serves the suite (`npx http-server ./dist -p 3001 -c-1 --cors` after copying `static/`
  into `dist/`). `toolbox/fdc3-for-web/demo/src/client/da/dummy-desktop-agent.ts` loads this one by URL
  (`http://localhost:3001/directories/localhost-conformance.json`) and documents the intent in
  `toolbox/fdc3-for-web/demo/README.md`.

Both files currently hold the same 18 records (`Conformance1`, `ChannelsAppId`, `IntentAppAId` ... `IntentAppLId`,
`OpenAppAId`, `OpenAppBId`, `MockAppId`, `MetadataAppId`), and the differences between the variants are only URLs and
descriptions: `details.url`, `icons[].src` and `screenshots[].src` use the localhost port rather than the published
toolbox path, most `description` values differ ("Part of the FDC3 2.0 Conformance Tests - developed for FINOS by Scott
Logic" locally, versus "Part of the FDC3 Conformance Tests" on the website), `Conformance1` carries
`"categories": ["Developer Tools"]` only in the localhost file, and `IntentAppLId` differs only in `details.url`. When
you add a mock app, add it to both files with the same `appId` and matching content, or the local run and the hosted run
will test different app sets.

A complete record for a new mock app, following the shape of its neighbours:

```json
{
  "appId": "QuoteAppId",
  "title": "Quote App",
  "description": "Part of the FDC3 Conformance Tests - displays quotes for a fdc3.instrument",
  "type": "web",
  "details": {
    "url": "http://localhost:3001/apps/quote"
  },
  "version": "1.0.0",
  "publisher": "FINOS",
  "icons": [
    {
      "src": "http://localhost:3001/finos-icon-256.png",
      "size": "256x256",
      "type": "image/png"
    }
  ],
  "hostManifests": {
    "sail": {
      "inject-api": "2.0"
    },
    "demo": {
      "visible": false
    },
    "Web App Manifest": "http://localhost:3001/apps/quote/manifest.json"
  },
  "interop": {
    "intents": {
      "listensFor": {
        "ViewQuote": {
          "contexts": ["fdc3.instrument"],
          "resultType": "channel<fdc3.valuation>"
        }
      },
      "raises": {
        "ViewOrders": ["fdc3.instrument", "fdc3.organization"]
      }
    },
    "userChannels": {
      "broadcasts": ["fdc3.instrument"],
      "listensFor": ["fdc3.instrument"]
    },
    "appChannels": [
      {
        "id": "quoteApp.quotes",
        "description": "Shares indications for the currently displayed instrument",
        "broadcasts": ["quoteApp.quote"],
        "listensFor": ["fdc3.instrument"]
      }
    ]
  }
}
```

The intent name is what conformance code passes to `fdc3.raiseIntent`, and the contexts are what the test app
broadcasts, so both must agree with the test implementation and with
`toolbox/fdc3-conformance/src/context-types.ts` (which is where the suite's custom context types are named). The
website variant of the same record uses
`"url": "https://fdc3.finos.org/toolbox/fdc3-conformance/apps/quote/index.html"` and
`"src": "https://fdc3.finos.org/toolbox/fdc3-conformance/finos-icon-256.png"`.

### Example apps and the demo

Each app under `toolbox/fdc3-example-apps/front-end-apps/<app>/` or `toolbox/fdc3-example-apps/server-apps/<app>/` keeps
its record in `static/appd.v2.json`. `toolbox/fdc3-example-apps/main.ts` merges those files, rewrites `details.url`, `icons[].src` and
`screenshots[].src` onto the port it assigned to the app (from `BASE_PORT = 4010` plus the app's index, overridable by
the app's own `properties.json`), and writes the result to
`toolbox/fdc3-example-apps/directory/static/generated/fdc3-example-apps.json`. That generated file is what the demo
Desktop Agent loads, from `http://localhost:4005/static/generated/fdc3-example-apps.json`, and 4005 is the port the
`directory` app itself declares in `toolbox/fdc3-example-apps/directory/properties.json`. Because the ports are
rewritten for you, write the URLs as they would be in a browser on the standard dev ports; do not hard-code the
orchestrator's assignment. `toolbox/fdc3-example-apps/directory/static/` also holds standalone JSON files
(`microsite-conformance.json`, `microsite-workbench.json`, `symphony.json`) that nothing in the repository references -
do not copy from them or "sync" them, they are not part of any workflow the repo runs.

The demo Desktop Agent fetches exactly three directories (`dummy-desktop-agent.ts`): the generated example-apps
directory, `http://localhost:4001/toolbox/fdc3-workbench/localhost-workbench.json` and the conformance directory above.
The workbench record lives at `toolbox/fdc3-workbench/public/localhost-workbench.json` and is served by the workbench's
Vite dev server, which runs on port 4001 with base `/toolbox/fdc3-workbench/`. (`toolbox/fdc3-for-web/demo/README.md`
claims the demo also loads "its local `appd.json`"; the code does not - `toolbox/fdc3-for-web/demo/static/da/appd.json`
is a useful template of plain records but is not referenced anywhere.) A Desktop Agent that ships with the demo
therefore only sees these three sets, so a record added elsewhere will not appear until the demo is pointed at it.

## Hosting and retrieval

A compliant App Directory service (the App Directory view of the standard) exposes two endpoints, and `spec.md` makes
them the minimum a Desktop Agent may rely on: `GET /v2/apps` to "retrieve all application definitions" and
`GET /v2/apps/{appId}` to "retrieve an application definition" (plus the requirement that a Desktop Agent "only
require[s] app directories that they connect to to have implemented only the minimum requirements"). The schema's
`servers` block declares the base path `/appd`, so a deployment publishes the routes under something like
`https://appd.example.com/appd/v2/apps`. The list endpoint returns an `AllApplicationsResponse` - an object with an
`applications` array and an optional `message` - while the single-app endpoint returns a bare `Application` record. The
schema also declares an optional bearer security scheme; `spec.md` describes authentication as a SHOULD, together with
the reminder that filtering by entitlement is allowed.

Records are addressed by `appId`, in either form: `spec.md` requires a directory to support "retrieval of app directory
records via either the raw `appId` (e.g. `myAppId`) or fully-qualified appId (e.g. `myAppId@host.domain.com`)", and the
overview's "Shrinking the URI" section shows that `app1@appd.foo.com` is represented inside its directory as `app1`, so
`https://appd.foo.com/api/appd/v2/apps/app1` resolves the same record. The same section documents the three discovery
mechanisms (static configuration, fully-qualified appId host resolution, and DNS SRV records under `_appd._tcp`), of
which a Desktop Agent MUST support at least static configuration.

Inside this repository, none of that HTTP plumbing is exercised: the dev servers publish the same JSON _files_ that the
service would return, and the demo's loader reads only `data.applications` from them. That is why the files in
`static/directories/` and the `appd.v2.json` files carry the `AllApplicationsResponse` envelope (`applications` plus
`message`) rather than being a bare array, and why the URLs a Desktop Agent is configured with point at the file
(`.../directories/localhost-conformance.json`), not at `/v2/apps`. If you write a real directory service, implement the
`/v2` endpoints; if you are adding records for this repo, keep the envelope.

## Validating a record

There is no CI job that validates AppD JSON: the only schema-driven validation in the repository is
`packages/fdc3-standard/test/AppDirectory.test.ts`, which loads the schema with `@apidevtools/swagger-parser` and checks
the two shipped examples (`packages/fdc3-standard/src/app-directory/specification/examples/application/`) with the
`jsonschema` validator. Those two packages are dev dependencies of `@finos/fdc3-standard`, so you can run the same
combination against any record file from the repository root, by reusing the test's technique of dereferencing the
schema first (the `Application` schema contains internal `$ref`s):

```sh
node -e '
const SwaggerParser = require("@apidevtools/swagger-parser");
const { Validator } = require("jsonschema");
const fs = require("fs");
(async () => {
  const schemaPath = "packages/fdc3-standard/src/app-directory/specification/appd.schema.json";
  const api = await SwaggerParser.validate(JSON.parse(fs.readFileSync(schemaPath, "utf-8")));
  const application = api.components.schemas.Application;
  const validator = new Validator();
  let invalid = 0;
  for (const file of process.argv.slice(1)) {
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    const records = Array.isArray(data) ? data : Array.isArray(data.applications) ? data.applications : [data];
    for (const record of records) {
      const result = validator.validate(record, application);
      console.log((result.valid ? "ok      " : "INVALID ") + record.appId + "  (" + file + ")");
      if (!result.valid) {
        invalid++;
        result.errors.forEach(error => console.log("   " + error.stack));
      }
    }
  }
  process.exit(invalid === 0 ? 0 : 1);
})();
' toolbox/fdc3-conformance/static/directories/localhost-conformance.json
```

The script accepts any mix of single records
(`packages/fdc3-standard/src/app-directory/specification/examples/application/myApplication.json`), directory files
(`toolbox/fdc3-conformance/static/directories/*.json`) and per-app records
(`toolbox/fdc3-example-apps/front-end-apps/pricer/static/appd.v2.json`). It validates `format` assertions as well as
structure, which matters: an `email` or `uri` that is slightly malformed is reported here but ignored by every Desktop
Agent. Run it before you open a pull request, and expect it to report pre-existing failures in files you did not touch
(see the pitfalls below).

For the conformance files specifically, the cheapest end-to-end check is to run the suite locally (`npm run dev` in
`toolbox/fdc3-conformance`, then the demo Desktop Agent) and confirm the new app appears in the runner's app list when
the test opens it by `appId`.

Changing a record usually needs no test run, but changing the _schema_ does: `npm test -w @finos/fdc3-standard` runs
`packages/fdc3-standard/test/AppDirectory.test.ts`, which validates the shipped examples and pins the `fdc3Version`
range pattern, and `npm test -w @finos/fdc3-web-impl` runs
`toolbox/fdc3-for-web/fdc3-web-impl/test/BasicDirectory.test.ts`, which covers version filtering and duplicate `appId`
handling against the generated OpenAPI types.

## Common pitfalls

1. **A missing `title` is invisible until someone validates.** As of this branch, `MockAppId` exists in both conformance
   directories without `title` (it has only the legacy `name`), so the schema reports
   `instance requires property "title"` for it. Nothing in CI catches that, and the record still works in the suite
   because no code path needs the title. Do not copy that shape: `title` is required, and it is the label the resolver
   UI prefers.
2. **`fdc3Version` must be a two-component range.** `"3.0.0"`, `"2.x"` or `"not-a-version"` fail the schema pattern, and
   `BasicDirectory` drops any record whose value the pattern does not match, or whose range the running agent version
   does not satisfy. A wrong value is the quietest way to remove an app from a Desktop Agent. The range pattern is
   duplicated in `BasicDirectory.ts` as `FDC3_VERSION_RANGE_PATTERN` with a comment requiring the two to stay in sync,
   and `packages/fdc3-standard/test/AppDirectory.test.ts` exercises accepted and rejected values.
3. **Duplicate `appId` values are dropped, not merged.** `BasicDirectory.addApps` keeps the first record with a given
   `appId` and ignores later ones, so a second record under an existing id never appears - and reusing an id while
   meaning a new version of the app silently does nothing.
4. **`details` is required even when it looks pointless.** Use `{}` for `type: "other"`. Remember too that the schema
   cannot check that `details` matches `type`: mixing a `url` into `type: "web"` details is invalid (the shape forbids
   extra properties), but a `type: "native"` app whose details carry only a `url` validates, because that object happens
   to match the `onlineNative` shape.
5. **`icons` and `screenshots` are strict shapes.** Each entry needs `src`, and anything beyond `src`/`size`/`type`
   (`label` for screenshots) is rejected - which is easy to trip over when copying a manifest from another standard.
6. **`interop.intents.raises` takes arrays of context type names, not `Intent` objects.** Two records in the repo get
   this wrong today - `toolbox/fdc3-example-apps/server-apps/login-poc/static/appd.v2.json` and
   `toolbox/fdc3-example-apps/server-apps/security-demo-app1/static/appd.v2.json` both put a `{ "contexts": [...] }`
   object where the array belongs - and the schema rejects them. The `listensFor` shape (an object with `contexts`) is
   not the `raises` shape.
7. **`localizedVersions` entries are partial records.** They are `BaseApplication` objects keyed by a language tag, so
   `{ "fr-FR": { "title": "...", "description": "..." } }` is complete; repeating `appId`, `type` or `details` there is
   redundant, and an invalid language tag as the key is a mistake you cannot see in the JSON.
8. **Trailing commas inside string values survive parsing.** `toolbox/fdc3-workbench/public/localhost-workbench.json`
   contains `"contactEmail": "fdc3@finos.org,"` and `"supportEmail": "fdc3-maintainers@finos.org,"` - valid JSON, but
   both fail the `email` format check. The same corruption appears in the schema's own embedded examples
   (`"myApp.quotes,"`, `"FDC3,"`), which is a hint about how it spreads: text copied out of a comma-separated list.
9. **Only `interop.intents.listensFor` changes agent behaviour.** `raises`, `userChannels` and `appChannels` are
   documentation for humans and catalog tools, so do not expect an agent to resolve an intent, or deliver a channel's
   context, because it is declared there.
10. **Record fields are not API fields.** `getAppMetadata` returns `AppMetadata`, which the in-repo Desktop Agent builds
    from a subset of the record in `filterPublicDetails` (`appId`, `version`, `title`, `tooltip`, `description`, `icons`,
    `screenshots`). The conformance suite asserts that the returned object contains no properties outside the API's field
    list (`toolbox/fdc3-conformance/src/test/support/metadata-support.ts`), so record-only material such as `publisher`,
    `categories` or `hostManifests` must stay in the catalog layer.
11. **`appId` is global when qualified.** A raw `appId` is unique only inside its directory; the fully-qualified
    `appId@fqdn` form is what makes it global. Avoid `@` inside the record's own `appId`, since the qualifier is
    appended with that character.
12. **`version` is not validated at all.** The schema quotes `1.2.5 (BETA)` as a legitimate value, so nothing stops you
    writing something a catalog UI or a version comparison cannot use. Keep to the simple triplet the repo's records use.

## Reviewing a record change

What a reviewer of this repository looks for, in order:

- The record validates: run the command above on every file you touched. Fix what you introduced; do not "fix" the
  pre-existing failures in records you did not otherwise need to change, unless the change is part of your task.
- The `appId` is new and unique across the file, and matches the literal string the test or demo code uses.
- Required fields are present (`appId`, `title`, `type`, `details`), and `type` and `details` describe the same kind of
  app.
- Intent declarations agree with the app's code: the intent names passed to `fdc3.addIntentListener` appear in
  `interop.intents.listensFor` with the context types the app accepts, because that declaration is what lets the
  Desktop Agent resolve the intent at all.
- For conformance apps, the record exists in both `website-conformance.json` and `localhost-conformance.json`, the URLs
  differ exactly as the other records' do, and the app has an HTML entry point under
  `toolbox/fdc3-conformance/static/apps/<app-name>/`.
- Formatting matches the file: the repository's root `.prettierignore` excludes `*.json` (and `*.md`), so Prettier - and
  the `lint-staged` hook that runs `prettier --write --ignore-unknown` on commit - leaves these records alone
  (`npx prettier --check --ignore-path /dev/null toolbox/fdc3-conformance/static/directories/localhost-conformance.json`
  reports style issues, which is why the files must be kept tidy by hand). A reordered or re-indented record therefore
  adds noise to a review.
- Nothing references the standalone `microsite-*.json` copies as a source of truth, and no edit was made to the
  website's generated copies under `website/static/`.
