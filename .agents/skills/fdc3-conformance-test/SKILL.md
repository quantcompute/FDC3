---
name: fdc3-conformance-test
description: Add, update or review FDC3 conformance tests. Use when a MUST or MUST NOT requirement in the standard needs test coverage, when writing a test definition in website/docs/api/conformance/, when implementing or editing a test in toolbox/fdc3-conformance/ (Mocha + Chai, multi-app orchestration over the app-control channel), when registering a test in src/test/testSuite.ts, when adding a mock app under src/mock/ with a static/apps/<app>/index.html entry point and an AppD record under static/directories/, when deciding whether a SHOULD, MAY or @experimental feature needs a conditional test, or when running the conformance suite locally against the demo Desktop Agent before a release.
license: Apache-2.0
compatibility: Needs Node >= 22 (toolbox/fdc3-conformance/package.json) and a Desktop Agent to load the runner and its mock apps into.
---

# Writing FDC3 conformance tests

An FDC3 conformance test exists twice. It exists as prose in the published standard, under
`website/docs/api/conformance/`, where it describes a multi-app scenario and carries a unique test
ID. It also exists as runnable code in `toolbox/fdc3-conformance/`, where a Mocha + Chai suite
running inside a Desktop Agent exercises that scenario and reports pass or fail against the ID.

The ID is the contract between the two halves, and it is the reason this workflow always runs in
the same order: definition first, then implementation, then registration. A test whose ID does not
appear in the standard cannot be traced back to a requirement, and a definition whose ID appears in
no `it()` title can never be shown to have passed. Desktop Agents are certified against public test
results, so a broken trace is a broken certification claim rather than a cosmetic problem.

`AGENTS.md` (section "Conformance Testing") and
`.github/pull_request_template.md` both describe this area in outline. This skill is the detailed
path through it.

## Step 1 — Decide whether a test is required

Not every feature needs a conformance test. `website/docs/fdc3-compliance.md` sets the rule, and
`AGENTS.md` restates it:

| Keyword in the standard           | What it means for conformance                                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MUST**, **MUST NOT**            | A conformance test is required.                                                                                                                                                 |
| **SHOULD**, **MAY**, **OPTIONAL** | Not always required. But if an implementation provides the feature, the feature MUST still conform, so write a **conditional** test that runs only when the feature is present. |
| `@experimental`                   | Optional for compliance, recommended for implementation (the SHOULD keyword is implied). A test is welcome but is not a gate.                                                   |

The compliance requirements for each part of the standard are listed in `website/docs/api/spec.md`
("Desktop Agent API Standard Compliance", the list of mandatory API functions and behaviours),
`website/docs/app-directory/spec.md`, `website/docs/intents/spec.md`, and
`website/docs/context/spec.md`. Read the requirement you are claiming to test before writing
anything: it tells you whether the test is mandatory or conditional, and it usually tells you the
exact API call and error value to assert on.

Conditional tests are marked in code, not just in prose. The pattern used for the optional User
Channel membership APIs is to ask the agent what it advertises and skip otherwise:

```typescript
const info = await fdc3.getInfo();
if (!info.optionalFeatures.UserChannelMembershipAPIs) {
  this.skip();
}
```

You can see this in `toolbox/fdc3-conformance/src/test/basic/fdc3.basic.ts` (`BasicJC1`) and
`toolbox/fdc3-conformance/src/test/advanced/fdc3.user-channels.ts`. Note that `BasicGI2` asserts the
opposite direction: `optionalFeatures` itself is mandatory, so the test always runs and checks that
the keys exist and are booleans. `toolbox/fdc3-conformance/src/test/support/metadata-support.ts`
holds the shared version of that check.

Conformance today covers the Desktop Agent API only. `website/docs/fdc3-compliance.md` states that
App Directory and Bridging conformance is still determined manually, so do not try to write a
conformance test for those parts.

## Step 2 — Write the definition

Definitions live in `website/docs/api/conformance/` and are part of the published standard — the
website build publishes them as the "FDC3 Conformance Tests" section (`Overview.md` links to each
file). Choose the file that matches the part of the API under test:

| File                            | Covers                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `Overview.md`                   | Index, how to run, hosted snapshots                                                                                          |
| `Basic-Tests.md`                | Connection check, context/event/intent listener sanity checks, `getInfo`, channels, `BasicDM1` destructured methods, `close` |
| `Open-Tests.md`                 | `fdc3.open()` behaviour and `OpenError` values                                                                               |
| `User-Channel-Tests.md`         | User channel membership, broadcast filtering, `userChannelChanged`, clearing context                                         |
| `App-Channel-Tests.md`          | App channel retrieval, broadcast, `contextCleared`, `ChannelError` values                                                    |
| `Metadata-Tests.md`             | `getInfo()`, `getAppMetadata()`, `findInstances()`                                                                           |
| `Intents-Tests.md`              | `findIntent`, `findIntentsByContext`, `raiseIntent`, intent results, private channels, manual resolver tests                 |
| `Destructured-Methods-Tests.md` | Destructured method calls on agents, channels and listeners                                                                  |

A definition block is a Docusaurus markdown section: a short paragraph explaining the scenario, a
table of the steps describing which app performs each one, then one bullet per test ID. The table
always has an "App" column whose values are the roles in the scenario — `A`, `B`, `Test` (the
conformance runner itself), `User`, or a named app such as `ChannelChangedEvent`:

```markdown
| App | Step                  | Details                                                                           |
| --- | --------------------- | --------------------------------------------------------------------------------- |
| A   | 1. addContextListener | A adds an _unfiltered_ Context Listener using `addContextListener(null,handler)`. |
| B   | 4. Broadcast          | B broadcasts an `fdc3.instrument` context.                                        |

- `UCBasicUsage1` ![2.0+](https://img.shields.io/badge/FDC3-2.0+-blue) Perform above test.
```

Conventions worth copying from the existing files:

- The ID is backticked on its own bullet, followed by the version badge (an image link to
  shields.io) and a one-line imperative instruction. Badges mark the version that introduced the
  test, and there is an `:::info` note in `Overview.md` explaining them.
- Steps that instantiate an app read as the actual API call (`fdc3.raiseIntent("sharedTestingIntent2",testContextY)`),
  so that the implementation can be written without re-deriving the intent.
- Where several IDs share one scenario, the shared table is written once and each ID bullet says
  how it differs (for example `UCFilteredUsage5` through `UCFilteredUsageNoJoin` in
  `User-Channel-Tests.md`, or the `...-Destructured` variants in `Open-Tests.md`).
- Scenario setup that needs AppD records is stated up front. `Intents-Tests.md` opens with a table
  mapping apps A–L to the intents and context types their records must declare; that table is what
  you keep in sync with `static/directories/` in Step 5.

**Pick an ID that is unique and never reuse or renumber an existing one.** IDs are quoted in test
results and issue reports ("failed UCFilteredUsageLeave"), so changing an ID silently invalidates
history. Grep the folder before claiming an ID.

Definitions can legitimately get ahead of implementations: `BasicCL5` and `BasicClose1` in
`Basic-Tests.md`, and `AOpensB3-Destructured` in `Open-Tests.md`, are defined but have no matching
`it()` title under `toolbox/fdc3-conformance/src/test/` yet. An unimplemented definition is an
accepted state for a newly agreed requirement, but it must eventually be picked up — the PR template
explicitly asks whether the definitions are "still correct and complete".

## Step 3 — Implement the test

Implementations live under `toolbox/fdc3-conformance/src/test/`:

- `basic/fdc3.basic.ts` — the sanity checks that run first and tell you the agent is connected.
- `advanced/*.ts` — one file per API area (`fdc3.open.ts`, `fdc3.user-channels.ts`,
  `fdc3.app-channels.ts`, `fdc3.findIntent.ts`, `fdc3.raiseIntent.ts`, `fdc3.getInfo.ts`,
  `fdc3.destructured-methods.ts`, and so on).
- `manual/fdc3.manual.ts` — tests that need a human (Step 6).
- `support/` — the shared control classes and helpers; `fdc3-conformance-utils.ts` sits one level
  up, next to the tests.

Put the test where its peers already are, and extend an existing support class rather than
inventing a parallel one. Each file exports either a single suite factory (`export default async () => { ... }`)
or a set of exported factories named after the short ID (`export const fdc3BasicCL1 = async () => ...`),
because `testSuite.ts` consumes them that way.

### The `(TestID)` prefix in the `it()` title

Every `it()` title must begin with the definition ID in parentheses:

```typescript
const acTestId =
  '(ACBasicUsage1) Should receive context when app a adds a listener and app B broadcasts to the same app channel';
it(acTestId, async () => {
  /* ... */
});
```

This is the only link between a green tick in the runner and a clause in the standard, and it is
also what the cleanup hooks key on (`this.currentTest!.title` is passed to the close helper, see
below), so the title must be the ID-bearing string. Naming the `const` after the ID, as the existing
files do, keeps the grep-ability intact.

The `describe()` name is a different thing: it groups the file's tests in the runner and does not
need to be a test ID (`describe('fdc3.open', ...)`, `describe('fdc3.appChannels', ...)`).

### Multi-app orchestration and the control channel

Conformance is inherently multi-app: the runner ("Test") drives, and mock apps launched by the
Desktop Agent perform their roles. Two mechanisms connect them.

The first is the ordinary API call under test — the runner calls `fdc3.open({ appId: 'ChannelsAppId' }, context)`
to launch a mock app and hand it work. The second is a private control channel, created with
`getOrCreateChannel` using the name in `toolbox/fdc3-conformance/src/constants.ts`
(`ControlChannel: 'app-control'`), over which the mock apps talk back. Mock apps call
`sendContextToTests()` (`src/mock/mock-functions.ts`) to broadcast a control context; the runner
waits for it. Most control context types are enumerated in `ControlContextType` in
`src/test/support/intent-support.ts` (`context-received`, `error`,
`context-listener-triggered`, and so on); the channel and open helpers additionally use literal
types such as `executionComplete` (the channel mock app's "I have finished the command list"
message) and `windowClosed` (the cleanup acknowledgement).

The channel tests show the full pattern. `ChannelControlImpl.openChannelApp()`
(`src/test/support/channels-support.ts`) opens `ChannelsAppId` with a `channelsAppContext` whose
`commands` array and `config` object carry the work list and the `testId`; the mock app in
`src/mock/channel.ts` listens for that context and runs it through `Fdc3CommandExecutor`
(`src/mock/channel-command.ts`), then signals `executionComplete` on the control channel if
`notifyAppAOnCompletion` was set.

Two rules fall out of this and both are easy to get wrong:

- Pass the test ID (usually the full `it()` title) into the mock app's `config.testId`, and use it
  consistently in the control contexts. This is what lets several tests run without their mock apps
  reading each other's messages, and what lets cleanup close only the windows this test opened.
- Register cleanup. `src/test/fdc3-conformance-utils.ts` exports `MockAppTracker` (used by the
  support classes) which counts the apps opened for a test and closes them via a `closeWindow`
  broadcast, waiting for the `windowClosed` acknowledgement with a retry; mock apps cooperate by
  calling `closeWindowOnCompletion(fdc3)` at startup. A test that skips this leaves windows behind
  and makes the next test flaky, which is why `afterEach` in the existing suites always calls the
  close helper.

Where a test needs to wait for a control context rather than assert immediately, use
`waitForContext` from `src/test/fdc3-conformance-utils.ts` rather than a bare listener; it applies
the package timeouts and supports the retry callback used for window closure.

### Assertions and failure messages

Conformance tests assert with Chai (`expect`/`assert`) from inside the test file or a support class,
and pass a `documentation` string as the assertion message. Those strings come from
`src/test/support/apiDocuments.ts`, which maps each API method to its published documentation URL:

```typescript
const documentation_UC = '\r\nDocumentation: ' + APIDocumentation.getUserChannels + '\r\nCause';
expect(channels, documentation).to.be.an('array');
```

Follow that pattern in new tests. It means a failure printed in a vendor's test run carries a link
to the clause they violated, which is the difference between an actionable bug report and "test
failed". Where an exception is caught rather than asserted on, `handleFail()` in `src/utils.ts`
appends the message and fails the test via Chai.

Timeouts come from `toolbox/fdc3-conformance/src/constants.ts`: `TestTimeout` (20s) applies to every
test, `WaitTime` (5s) is the wait for mock apps, `NoListenerTimeout` (120s) covers the "agent should
time out waiting for a listener it never gets" cases, and `WindowCloseWaitTime` covers cleanup.
Individual tests that legitimately run long override with `.timeout(constants.NoListenerTimeout + 2000)`,
as `AOpensBWithWrongContext` in `src/test/advanced/fdc3.open.ts` does; prefer that to bumping the
global timeout.

For app identity, do not compare appIds with `===` unless you mean to. An agent may return a
fully-qualified appId (`MockAppId@localhost`), so use `appIdMatches()` from `src/utils.ts` when
asserting that an identifier or `IntentResolution.source` refers to the app you targeted.

### A note on the two test systems in this repository

`AGENTS.md` describes Cucumber/Gherkin suites with `.feature` files, `{curly-brace}` step object
references (for example `{api}`, `{channel1}`) and the `matchData` helper for dot-notation
assertions such as `payload.context.type`. Those belong to the DACP protocol test suites in
`packages/fdc3-agent-proxy/test/` and `toolbox/fdc3-for-web/fdc3-web-impl/test/`, which consume
`matchData` from `@finos/cucumber-testing-steps`. They are **not** used in
`toolbox/fdc3-conformance/`, which has no feature files and no step definitions. There is no
`matchData` in this package: nested assertions are written out with Chai, for example
`expect(context.source.appId).to.equal(expected)` in the support classes. If you are looking at a
Cucumber step definition, you are in the wrong suite.

## Step 4 — Register the test

Implementation is not enough; an unregistered test never runs. `toolbox/fdc3-conformance/src/test/testSuite.ts`
is the registry:

1. Import the suite factory at the top of the file, alongside the existing imports.
2. Add an entry to `basicSuite` or `advancedSuite`, keyed by the short name that should appear in
   the runner's dropdown, mapping to an array containing the factory:

```typescript
const advancedSuite: testSet = {
  'fdc3.open': [fdc3Open],
  // ...
};
```

`allTests` and `packs` are derived from those two objects, so a single entry makes the test appear
both under "All" and under its "Individual Basic"/"Individual Advanced" group. Manual tests are
registered separately in `ambiguousTests`, which feeds `allManualTests` (Step 6).

The runner UI is served from `static/apps/app/index.html` and populated by `src/test/index.ts`,
which reads `getPackNames()` and `getPackMembers()`; there is nothing else to switch on.

## Step 5 — Mock apps and their AppD records

A test that needs a counterpart app needs four things, and a missing piece shows up as a mock app
that never appears or loads.

**The mock app source**, in `toolbox/fdc3-conformance/src/mock/`. Each mock app is a small module
that calls `getAgent()` and then registers the listeners and broadcasts its role requires — see
`src/mock/general.ts` (the counterpart the open tests launch as app B: it announces
`fdc3-conformance-opened`, checks its own `getInfo().appMetadata.appId` against `MockAppId`, then
reports `context-received` for `fdc3.instrument`) and `src/mock/basic.ts` (reports
`context-received` and answers `lTestingIntent`). Start with `closeWindowOnCompletion(fdc3)` so the
runner can tidy the window away.

**A bundle entry.** The mock apps are separate Vite entries: add your source to the `input` map in
`toolbox/fdc3-conformance/vite.config.ts`, which currently names `channel`, `general`, `metadata`,
`intent-a` … `intent-l`, `basic`, `open-a`, and the runner itself (`fdc3-compliance`). An entry that
is not in that map is never built.

**An HTML entry point**, `toolbox/fdc3-conformance/static/apps/<app>/index.html`, which loads the
bundle for that app: `<script type="module" src="../../lib/basic.js"></script>`. `npm run build`
copies `static/` into `dist/` and emits bundles into `dist/lib/`, which is why the path has two
`..` segments.

**An AppD record** in `toolbox/fdc3-conformance/static/directories/`. There are two files and both
need the record, because they serve different audiences:

- `website-conformance.json` points at `https://fdc3.finos.org/toolbox/fdc3-conformance/apps/...`
  and is the directory a vendor loads into their agent for a hosted or local run.
- `localhost-conformance.json` points at `http://localhost:3001/apps/...` and is the one the demo
  Desktop Agent loads during development (see `toolbox/fdc3-for-web/demo/src/client/da/dummy-desktop-agent.ts`).

Each record declares the app's `appId` (which the test code hard-codes — see the `IntentApp` enum in
`src/test/support/intent-support.ts` and the `openApp` map in `src/test/support/open-control.ts`),
its `details.url`, its icons, and, for intent participants, its
`interop.intents.listensFor` map. The listens-for declarations are load-bearing: the intent tests
assert that `findIntent` and `findIntentsByContext` return exactly the apps whose records declare a
given intent/context combination, so a missing or extra declaration changes the expected result.
The authoritative table of app → intents → context types is the "Setup" table at the top of
`website/docs/api/conformance/Intents-Tests.md`.

Test apps are usually hidden from the agent's own launcher with `"hostManifests": { "demo": { "visible": false } }`
so a reviewer does not have to scroll past twenty mock apps to find the runner.

For the record format itself — the AppD v2 fields, `hostManifests`, icons and interop blocks — use
the `fdc3-appd-authoring` skill; this skill assumes the record's content is already correct and only
tells you where the conformance copies live.

## Step 6 — Manual and interactive tests

Some requirements cannot be automated because they are user-interactive: resolving an ambiguous
intent (a chooser UI over apps E, F, G, H and I) and setting the current User Channel. Both are
described in the standard as manual tests — see "Resolving Ambiguous Intents" in
`Intents-Tests.md` and the "Event on channel changed" section of `User-Channel-Tests.md` — and both
are implemented in `toolbox/fdc3-conformance/src/test/manual/fdc3.manual.ts`.

Manual tests follow the same ID rule (`it(ResolveAmbiguousIntentTarget, ...)` where the title begins
with `(ResolveAmbiguousIntentTarget)`) but are registered in `ambiguousTests` rather than
`basicSuite`/`advancedSuite`, so they are reachable through `allManualTests` and
`executeManualTestsInBrowser(pack)`. They are run from a separate "Manual Tests" dropdown on the
runner page, which is populated from a **hard-coded option list** in
`toolbox/fdc3-conformance/static/apps/app/index.html`; the option text is used as the lookup key
(the `value` attribute is ignored), so a new manual test needs an `<option>` whose text exactly
matches the key in `ambiguousTests`. Each manual test also needs a definition bullet in the
standard stating what the user must do and what a pass looks like.

The runner displays the reasons these tests are manual ("Each of these tests will invoke the intent
resolver of the Desktop Agent…"), because the failure mode for a non-conformant agent is a chooser
that never appears or resolves to only one of several valid targets.

## Step 7 — Run it locally

From the repository root, `npm run dev` starts every toolbox project concurrently, including the
conformance runner. The conformance package's own scripts do the work:
`clean` → `build` (`tsc --noEmit` typecheck, `vite build`, copy `static/`, copy Mocha's CSS) →
`serve`, an `http-server` on port **3001**. The runner UI is then at
`http://localhost:3001/apps/app/index.html`.

The demo Desktop Agent runs on port 4000 and loads `http://localhost:3001/directories/localhost-conformance.json`
from `toolbox/fdc3-for-web/demo/src/client/da/dummy-desktop-agent.ts` when that service is up.
Launch the `FDC3 Conformance Framework` app (appId `Conformance1`), choose a pack from the dropdown,
and press Run. Failures render in red with the `documentation` link; passes render green.

You can also point any AppD-v2-capable agent at the hosted build instead of running from source; the
URLs are in `website/docs/api/conformance/Overview.md`. That is the right path for a vendor's own
certification run, but for developing tests, run from source so your changes are what executes.

To check only that your change compiles, `npm run typecheck` in `toolbox/fdc3-conformance` is enough
and is much faster than the full `npm run dev` cycle.

## Before you raise the PR

`CONTRIBUTING.md` states that all tests must be run locally before submitting a PR, and that
`toolbox/fdc3-for-web/demo` is expected to pass the FDC3 conformance framework prior to new FDC3
releases (not currently automated). In practice, that means: build the conformance package, run the
affected pack — and ideally "All" — against the demo agent from a clean build, and paste the result
into the PR. A test that was never observed passing is not evidence of anything.

The PR template also asks whether conformance test definitions are still correct and complete when a
change touches the standard, and this is where the definition-first order pays off: if you added a
MUST requirement, the reviewer will look for the definition and the implementation, in that order,
with the same ID.

## Checklist

- [ ] The requirement is MUST/MUST NOT (mandatory test), or SHOULD/MAY/`@experimental` (conditional test that skips when the feature is absent).
- [ ] A definition exists in the right file under `website/docs/api/conformance/`, with an app/step table and a unique ID that is not used anywhere else.
- [ ] The implementation lives in `src/test/basic/`, `src/test/advanced/`, or `src/test/manual/`, and its `it()` title starts with `(TestID)`.
- [ ] Support-class orchestration uses the `app-control` control channel, passes `testId`, and cleans up via `MockAppTracker`/`closeWindowOnCompletion`.
- [ ] Assertions carry a `documentation` string from `apiDocuments.ts`; app identity comparisons use `appIdMatches`.
- [ ] A new mock app has a source file in `src/mock/`, a Vite entry in `vite.config.ts`, an HTML entry in `static/apps/<app>/`, and records in both `website-conformance.json` and `localhost-conformance.json`.
- [ ] The suite factory is imported and registered in `src/test/testSuite.ts` (manual tests: `ambiguousTests` plus an `<option>` in `static/apps/app/index.html`).
- [ ] The affected pack was run locally against a Desktop Agent and the result is quoted in the PR.
