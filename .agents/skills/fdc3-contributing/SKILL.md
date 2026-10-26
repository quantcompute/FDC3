---
name: fdc3-contributing
description: >-
  Contributor workflow for the FDC3 standard monorepo (finos/FDC3), taking a change from a fresh checkout to a
  mergeable pull request. Use when contributing to FDC3: setting up the checkout, choosing which npm workspace to
  edit, building and testing packages in dependency order, satisfying the test and coverage policy, meeting the
  ICLA/CCLA and Apache licence-header requirements, writing CHANGELOG.md entries, formatting with prettier and the
  husky pre-commit hook, editing the Docusaurus website or regenerating the context documentation, bumping the
  shared workspace version, or adding an agent skill under .agents/skills or a package skills directory.
license: Apache-2.0
metadata:
  repository: 'finos/FDC3'
  standard-license: 'Community-Spec-1.0'
  code-license: 'Apache-2.0'
  node-floor: '>=22'
---

# Contributing to the FDC3 monorepo

FDC3 is a FINOS standard, not a library, and this repository is both the specification and its reference
implementations. That shapes everything about contributing here: the Standard itself is the prose under
`website/docs/` plus the JSON Schemas in `packages/fdc3-schema/schemas/` and `packages/fdc3-context/schemas/`, the
TypeScript packages exist to implement and test that material, and a merged change becomes part of the next pre-draft
of the Standard through a Working Group vote.

The policy itself lives in three documents, and they are worth reading once in full:

- `CONTRIBUTING.md` — the contribution policy: issue types, the test policy (section 3.6), and the pull request
  workflow (section 4).
- `GOVERNANCE.md` — roles (Participants, Maintainers, Editors), consensus-based decision making, and appeals.
- `AGENTS.md` — the monorepo map: the module dependency graph, build and test conventions, the schema-to-type
  generation flow, and the list of files that must never be hand-edited.

This skill covers the part they leave implicit: the order in which the work has to happen, the exact commands that
work in this repository, and the failure symptoms that tell you which rule you have broken.

## 1. Get a checkout that builds

The Node floor is enforced in three places and they agree. `.nvmrc` and `.node-version` both pin `24.18.0`, the root
`package.json` declares `"engines": { "node": ">=22" }` (every published package repeats that floor), and CI
(`.github/workflows/coverage.yml`, `release.yml`, `depcheck.yml`) sets `node-version: 24.18.0`. Run `nvm use` before
anything else so your local toolchain matches what CI and the `engines` floor describe.

```bash
nvm use                     # 24.18.0 from .nvmrc
npm install                 # from the repository root, not from a package directory
```

The root install is the only install you need for the packages; it wires up all fourteen workspaces. The website is
not one of them and has its own install (see section 8).

Three settings in `.npmrc` are load-bearing and should not be "cleaned up":

- `legacy-peer-deps = true` — the workspaces have conflicting peer requirements (including toolchains that do not yet
  support TypeScript 7). Without this flag npm flattens incompatible versions and breaks runtime resolution.
- `include = optional` — `esbuild` is used by `tsx` for `packages/fdc3-schema` code generation; on CI images that omit
  optional dependencies the build otherwise fails with `@esbuild/linux-x64 could not be found`.
- `omit-lockfile-registry-resolved = true` — keeps the lockfile free of a mirrored registry URL.

`npm install` also runs the root `prepare` script, which is now:

```json
"prepare": "husky && skills-npm"
```

Two things happen there. `husky` installs the git hooks, and the pre-commit hook is what runs prettier over your
staged files (section 7). `skills-npm` then scans the installed packages for shipped agent skills and links them into
`.agents/skills/`. When you have just added or edited a skill of your own, this step is a no-op — the scan cache is
keyed on `package-lock.json` and it will print `Scanned … no skills found (from cache)`. See section 9 for the flag
that fixes it.

## 2. Know which workspace you are changing

The root `package.json` lists fourteen workspaces. Ten are published to npm and share one version
(`3.0.0-beta.1` at the time of writing); four are private developer tools.

| Workspace path                       | npm package                | Role                                                         |
| ------------------------------------ | -------------------------- | ------------------------------------------------------------ |
| `packages/fdc3-schema`               | `@qcomp/fdc3-schema`       | DACP / bridging JSON Schemas, generates the wire types       |
| `packages/fdc3-context`              | `@qcomp/fdc3-context`      | Context type JSON Schemas, generates `ContextTypes.ts`       |
| `packages/fdc3-standard`             | `@qcomp/fdc3-standard`     | The public TypeScript API interfaces and the AppD schema     |
| `packages/fdc3-agent-proxy`          | `@qcomp/fdc3-agent-proxy`  | Client-side DACP implementation                              |
| `packages/fdc3-security`             | `@qcomp/fdc3-security`     | Signed context / encrypted channel helpers (JWS, JWE)        |
| `toolbox/fdc3-for-web/fdc3-web-impl` | `@qcomp/fdc3-web-impl`     | Desktop-Agent-side DACP implementation                       |
| `packages/fdc3-get-agent`            | `@qcomp/fdc3-get-agent`    | `getAgent()` / `fdc3Ready()` and the web connection protocol |
| `packages/fdc3`                      | `@qcomp/fdc3`              | Roll-up package, the entry point apps import                 |
| `packages/fdc3-commonjs`             | `@qcomp/fdc3-commonjs`     | CommonJS backwards-compatibility roll-up                     |
| `toolbox/fdc3-example-apps`          | `@qcomp/fdc3-example-apps` | Runnable example apps                                        |
| `toolbox/fdc3-workbench`             | private                    | Interactive testing tool                                     |
| `toolbox/fdc3-conformance`           | private                    | Conformance test implementations                             |
| `toolbox/fdc3-for-web/reference-ui`  | private                    | Reference desktop UI                                         |
| `toolbox/fdc3-for-web/demo`          | private                    | Reference Desktop Agent                                      |

The core dependency graph is one-directional, and the workspaces array is written in dependency order:

```
fdc3-schema ──┐
fdc3-context ─┴─► fdc3-standard ──┬─► fdc3-agent-proxy ──┬─► fdc3-get-agent ──► fdc3 ──► fdc3-commonjs
                                  │                       ├─► fdc3-security
                                  │                       │
                                  └─► fdc3-web-impl ──────┘
                                                          └─► demo, fdc3-workbench, fdc3-conformance,
                                                              fdc3-example-apps
```

Why the order matters, mechanically: each package declares TypeScript project `references` to its dependencies and
`tsconfig.root.json` turns on `composite`, but every package's `build` script is plain `tsc`, not `tsc -b`, so those
references are not built for you. A consumer resolves `@qcomp/fdc3-standard` through the `node_modules/@qcomp/*`
workspace symlink to `dist/src/index.d.ts`, which only exists once that package has been built. Change a schema or an
interface and build only the consumer, and you get `TS2307: Cannot find module '@qcomp/fdc3-standard'` or, worse, a
build against stale declarations. The root script is safe because the workspaces array is already in dependency order:

```bash
npm run build            # --workspaces --if-present, in array order
npm run test
npm run lint
npm run clean            # removes dist/ and coverage/ everywhere
```

For a single package, `cd` into it. Most packages define the same three scripts:

```bash
cd packages/fdc3-agent-proxy && npm run build && npm test && npm run lint
cd toolbox/fdc3-for-web/fdc3-web-impl && npm test
```

Two wrinkles are worth knowing before you go looking for a missing script. `packages/fdc3` and
`packages/fdc3-commonjs` only have `clean` and `build` — that is deliberate, they are `import`/`export` roll-ups and
carry no tests or lint config. `toolbox/fdc3-for-web/demo` has no `build` at all; it runs with `tsx` via its `dev`
script. `npm run dev` from the root starts the example apps, conformance, workbench, reference UI and demo together.

Files that are generated and must never be edited by hand: `packages/fdc3-schema/generated/api/BrowserTypes.ts`,
`packages/fdc3-schema/generated/bridging/BridgingTypes.ts`, `packages/fdc3-context/generated/ContextTypes.ts`, and
everything under `website/docs/context/ref/`. They are committed, so a change to their source schema shows up in your
pull request as regenerated output — run `npm run build` and commit the result rather than editing the output.

When a change crosses the whole stack, the order in `AGENTS.md` ("Common Change Patterns") is the one reviewers will
check the PR against: schema, then the `fdc3-standard` interface, then the proxy and web-impl, then tests in both,
then `website/docs/api/`, then the changelog. Note the one manual link in that chain: the JSON Schemas define the wire
protocol and the `fdc3-standard` interfaces define the public API, and nothing generates one from the other, so both
sides have to be updated by hand.

## 3. Test policy and coverage

`CONTRIBUTING.md` section 3.6 is normative, and its first half is a list of modules where logic is not allowed to
appear at all:

- `packages/fdc3` and `packages/fdc3-commonjs` — "code should not be added here", only `import` / `export` in
  `index.ts`.
- `packages/fdc3-context` and `packages/fdc3-schema` — JSON Schemas plus the source code generated from them, nothing
  hand-written.
- `packages/fdc3-agent-proxy`, `packages/fdc3-get-agent`, `packages/fdc3-standard` and `fdc3-web-impl` — contributions
  must improve or maintain coverage at the current level.

If you find yourself wanting to put behaviour in `packages/fdc3`, the behaviour belongs in `fdc3-standard` or in one
of the implementations.

The rest of section 3.6 is the test policy proper: code should have tests, all tests must pass, all tests must be
meaningful and kept up to date, and they must be run locally before you open the PR. Coverage is reported on every
pull request: `.github/workflows/coverage.yml` triggers on `pull_request`, runs `npm ci`, `npm run lint`,
`npm run build` and `npm run test` on Node 24.18.0, and uploads to Codecov with `pull-requests: write`. That workflow
(plus the unused-dependency check in `depcheck.yml`) is what runs automatically on your pull request, so the useful
local pre-flight is exactly its shape:

```bash
npm run lint && npm run build && npm run test
```

Individual packages can report coverage locally with `npm run test:coverage` (`fdc3-agent-proxy`, `fdc3-get-agent`
and `fdc3-web-impl` define it; it is `vitest run --coverage`).

The two Cucumber suites (`fdc3-agent-proxy` and `fdc3-web-impl`) have their own conventions, all documented in
`AGENTS.md`: `.feature` files in `test/features/` with steps in `test/step-definitions/`, generic steps imported from
`@finos/cucumber-testing-steps`, and a sequential UUID generator in the test `ServerContext`. That last one is the
classic trap — adding a `sc.createUUID()` call in handler code shifts every subsequent expected UUID in the existing
tests, so those failures are expected and the expected values need updating, not the production code.

If your change adds a MUST or MUST NOT requirement to the Standard, the PR template asks whether the conformance
tests are still correct and complete. Test definitions live in `website/docs/api/conformance/`, implementations in
`toolbox/fdc3-conformance/src/test/` (registered in `testSuite.ts`), and every `it()` title is prefixed with the test
definition ID, for example `it('(UCBasicUsage1) …')`. `AGENTS.md` covers mock apps and AppD records for the cases that
need them.

## 4. Licence, CLA and review reality

Two licences apply, and it matters which one your change touches. The Standard itself ships under the Community
Specification License (`LICENSE.md`, SPDX `Community-Spec-1.0`); the reference code under Apache 2.0
(`LICENSE.spdx`). `NOTICES.md` carries both the Community Specification licence acceptance, withdrawal and exclusion
notices, and the third-party attribution notices.

Every contribution needs a contributor licence agreement in place before it can be merged. Commits from individuals
not covered by an executed ICLA, or by a CCLA that names them, are flagged and blocked automatically by the Linux
Foundation EasyCLA tool. The PR template has an explicit acknowledgement checkbox for this, and if you have not
contributed before you should expect an EasyCLA comment on your pull request shortly after you raise it. Employees
covered by a corporate CCLA are sometimes not individually named on it, which surfaces as a blocked check rather than
a clear error — email `help@finos.org` rather than guessing.

For new source files, the requirement is an Apache 2.0 header comment block that also carries your copyright line
(the template link is in `CONTRIBUTING.md` section 4.1). If your change pulls in a third-party dependency with
attribution or licence obligations, update `NOTICES.md` in the same PR.

Issues come first. `CONTRIBUTING.md` sections 1.1 and 2.3 are explicit that changes to the Standard usually need
discussion before the change is written, so propose it in an issue (or ask for it to be added to a Standard WG
meeting agenda) rather than opening a schema PR cold. `.github/ISSUE_TEMPLATE/`
has the templates: `---context_or_intent_proposal.md` (new contexts and intents, which is the one to use before
writing a schema), `---enhancement-request.md`, `---minor-issue.md`, `---question.md`, plus meeting templates for the
general, standard WG, maintainers, use-cases, web-browsers and identity-and-security meetings. Search for duplicates
first, and tag `Bug` or `Enhancement` as appropriate.

The pull request workflow in section 4 is short but has a few hard edges:

- Work in progress is welcome and should be prefixed `WIP: [title]`; remove both the `WIP` prefix and the label when
  it is ready for review.
- Preferred, not required: tie the PR to an issue and put `resolves #<issue number>` in the description.
- Show a proposed `CHANGELOG.md` update in the PR (section 5 below).
- Keep commits small and independent, keep the PR mergeable, minimise non-functional churn such as whitespace, and
  follow the existing code layout and docs tone.
- Approval means at least one FDC3 Maintainer, with `LGTM` added as a comment when they approve; `.github/CODEOWNERS`
  makes `@finos/fdc3-maintainers` the default reviewer. A "Comment" review is a question and does not count as
  approval; "Changes Requested" must be resolved first. Anyone may review, but the PR stays open until a Maintainer
  marks it approved.
- The `.github/pull_request_template.md` checklist is real work, not ceremony: it asks specifically about linked
  issues, the changelog, API changes (docs plus sources plus conformance tests plus schemas), whether code generation
  was run and its results checked in, and — for new context types and intents — the field type conventions,
  `BaseContext` composition, titles/descriptions, examples, and intent naming conventions.

## 5. Changelog discipline

`CHANGELOG.md` follows Keep a Changelog. All current work goes under `## [Unreleased]` in one of five subsections:
`### Added`, `### Changed`, `### Removed`, `### Deprecated`, `### Fixed`. Entries end in a link to the PR or issue,
in the existing style, e.g. `([#2204](https://github.com/finos/FDC3/pull/2204))`.

The rule that reviewers enforce, and which `AGENTS.md` states explicitly under "Files You Should Always Update", is
that each new entry is appended to the **bottom** of its subsection — never the top. Multiple agents or contributors
working in parallel otherwise reorder each other's entries and produce a merge conflict in a file that should merge
cleanly. If you are unsure where a change belongs, prefer the section that matches its effect on the Standard rather
than the mechanism: a clarification is `Changed`, a correction is `Fixed`.

When a release is cut, the changelog is updated as part of the website versioning procedure described in
`website/README.md` (step 5) — the `[Unreleased]` content is marked as the new version and a fresh `[Unreleased]`
section is added for the next one.

## 6. Formatting and the pre-commit hook

Prettier is configured in the root `package.json` — 120 column print width, single quotes, `es5` trailing commas,
`arrowParens: "avoid"`, `endOfLine: "auto"`, and the default 2-space indent. Individual packages repeat the same
`prettier` block, so there is no per-package divergence to discover.

`.husky/pre-commit` runs `npx lint-staged`, and the root `lint-staged` config is a single entry,
`"**/*": "prettier --write --ignore-unknown"`. So every commit rewrites the staged files in place. Two consequences
worth internalising: a file you commit may come back reformatted, and a large reformat of a file you only touched
incidentally will be visible in your diff and is exactly the kind of non-functional change section 4.1 asks you to
minimise.

Linting is separate and per package, via `npm run lint` at the root (`--workspaces --if-present`). Most of the package
scripts are `eslint src/`, but `fdc3-standard` and `fdc3-context` run `eslint src/ --fix`, and the two schema
packages run eslint plus `prettier --write` over their `generated/` output as part of their `lint` and `build`
scripts. Those `--fix` variants modify files, so run `npm run lint` before you commit and check `git status`
afterwards rather than assuming it was read-only.

When you author files under `.agents/skills/`, format and verify them the same way the repo does; `npx prettier
--check .agents/skills/<name>` and `npx --yes skills-ref@0.1.5 validate .agents/skills/<name>` are the two checks that
gate a skill change.

## 7. Keep the documentation honest

The website is a Docusaurus site in `website/`, and it is deliberately **not** a workspace. It installs and builds on
its own:

```bash
cd website
npm install
npm run build       # or: npm run start for a local preview
```

`website/package.json` wires generation into those commands so you do not have to remember it. `prestart` and
`prebuild` both copy the schemas and the AppD schema and run `node schema2Markdown.js`, which regenerates the context
reference pages under `website/docs/context/ref/`; `prebuild` goes further, running `parent-build` (a root
`npm install` plus `npm run build`) and copying in the workbench, reference UI and conformance builds. If you changed
a context schema in `packages/fdc3-context/schemas/context/`, that script is what turns it into docs.

What you must not edit:

- `website/versioned_docs/version-*/` and `website/versioned_sidebars/` — snapshots cut for each released Standard
  (currently `version-1.0` through `version-3.0`).
- `website/static/schemas/<version>/` — the matching schema snapshots (`1.0` … `3.0`, plus `next` for the pre-draft).
- `website/docs/context/ref/**` — generated by `website/schema2Markdown.js`; fix `schema2Markdown.js` or the source
  schema in both `packages/fdc3-context/schemas/context/` and `website/static/schemas/next/context/`, then re-run.

Everything under `website/docs/` is current work and in scope. The API reference pages in `website/docs/api/ref/`
mirror the interfaces in `packages/fdc3-standard/src/api/` (AGENTS.md carries the file-by-file mapping table), the
DACP wire protocol is documented in `website/docs/api/specs/desktopAgentCommunicationProtocol.md`, and the
conformance test definitions under `website/docs/api/conformance/` are part of the published Standard. Links to
files in `website/static` need the `pathname://` prefix so Docusaurus does not try to route them; `website/README.md`
explains why, along with the full release-time versioning procedure for maintainers.

## 8. Version management

All public workspaces carry the same version, and the root `package.json` version is the one that drives publishing.
`scripts/version-check.js` is the enforcement: it walks the workspaces, skips private packages, and fails with a list
of every public workspace whose version differs from the root. It runs standalone as `npm run version-check`, and it
is the last gate before publishing in `.github/workflows/release.yml` — the release workflow publishes nothing if the
versions disagree, because mismatched versions produce incorrect npm dist-tags.

To change the version, for example on a release branch:

```bash
git checkout -b release/v3.1
npm version <new-version> --include-workspace-root --workspaces
npm run syncpack        # fixes @qcomp/* dependency ranges, then runs version-check
npm up                  # refresh node_modules references
npm run build           # builds everything against the new version
```

`npm run syncpack` is defined as `npm exec syncpack -- fix --dependencies "@qcomp/*" && npm run version-check`, so
the dependency ranges and the verification happen together; do not run syncpack without expecting the check to run
too. The published packages depend on each other with exact pinned versions, so after a bump the workspace
dependencies must move with the root version or `version-check` fails.

Publishing itself is not manual: publishing a GitHub Release triggers `.github/workflows/release.yml`, which lints,
builds, tests, version-checks, packs every non-private workspace, and publishes the same tarballs to npmjs.org and
GitHub Packages. The dist-tag is derived from the version string — a hyphen (for example `3.0.0-beta.1`) implies the
`prerelease` tag, anything else `latest`. `README.md` documents the whole sequence, including the branch and PR
steps.

When the version bump affects skills that ship in packages — for example a skill that names the current FDC3 version
or package version — the follow-up is handled by the sibling `fdc3-version-bump` skill in `.agents/skills/`, which
also ships a `scripts/check-skill-versions.mjs` checker you can run from the repository root.

## 9. Skills that ship with the repo

Agent skills come in two flavours here, and the difference decides whether they ship to users:

- Contributor skills live in `.agents/skills/<name>/SKILL.md`. They are for people working on this repository and are
  never published; this skill is one of them.
- Package skills live in `<package>/skills/<name>/SKILL.md` and are shipped inside that npm package, so consumers get
  the tooling's own guidance at the version they installed.

`skills-npm.config.ts` tells the scanner how to find them: `source: 'node_modules'` (the `package.json` source would
only honour the root's own dependencies, and the workspace packages are not dependencies of the root, so every
per-package skill would be invisible), `include: ['@qcomp/*']` (without this, third-party packages' skills — dotenv
ships two — would be symlinked into `.agents/skills/`), and `recursive: true` for nested `node_modules` layouts.
`skills-npm` scans a package's `skills/` directory, `dist/skills/`, `.agents/skills/`, or a root `SKILL.md`, and
always links `.agents/skills` because it is the shared directory every agent using the universal layout reads.

The operational trap: the scan is cached in `node_modules/.skills-npm/cache.json` against the `package-lock.json`
hash, so after adding or editing a skill a plain `npm install` (or the `prepare` hook) prints
`Scanned … no skills found (from cache)` and does nothing. Force a full reload:

```bash
npx skills-npm --force          # ignore the cache and rescan
npx skills-npm --dry-run        # preview what would be linked, change nothing
```

Use `--agent` to pin the target agent (CI must do this; agent detection is otherwise environment-dependent). Do not
hand-create the symlinks that point into `node_modules`: `skills-npm` only ever replaces or cleans up links it
recognises, so a hand-made one is neither fixed nor removed. The links it does create are generated output and are
not tracked — `prepare` recreates them in `.agents/skills` (and, once an agent is detected, in that agent's own
project directory) on every install — so the only thing committed under `.agents/skills/` is the skill directories
that are actually authored here.

If you add a package skill, check that it can actually reach a consumer: npm tarballs contain only the paths a
package's `files` array names, so a new `skills/` directory needs `"skills"` added to that package's `files`. Every
published workspace currently lists `"dist"` and `"skills"` (plus `test/features` in `fdc3-agent-proxy`). `npm pack
--workspace <dir> --dry-run` shows what would be shipped without producing a tarball, and
`check-skill-versions.mjs --check` reports a `skills/` directory that is missing from `files`. Skills that describe a
versioned artefact should also be checked against the version bump path in section 8.

## 10. Before you push

Line up what the reviewers and CI will look at:

1. The relevant package builds and its tests pass locally — in dependency order if you touched more than one.
2. `npm run lint`, then `git status`, because several lint scripts run with `--fix`.
3. Generated output is regenerated and committed (`npm run build`), not hand-edited.
4. `CHANGELOG.md` has an entry under `[Unreleased]`, appended to the bottom of its subsection.
5. New source files carry the Apache 2.0 header and your copyright line; `NOTICES.md` is updated if a new
   third-party dependency requires it.
6. Documentation under `website/docs/` is in sync, and no file under `versioned_docs/`, `versioned_sidebars/` or
   `static/schemas/<version>/` was modified.
7. The PR description links its issue with `resolves #N` (preferred), and the title carries `WIP:` only while the
   work genuinely is in progress.
8. Version fields are untouched unless this is a version bump — and if it is, `npm run version-check` passes.
9. If you added or edited a skill, `npx skills-npm --force` has run and the resulting links are committed.

Common symptoms and what they mean:

| Symptom                                                        | Cause                                                                         |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `TS2307: Cannot find module '@qcomp/…'`                        | The dependency has no `dist/` — build it, or build from the root              |
| Build succeeds but types look stale                            | You built the consumer without rebuilding the changed dependency              |
| `no skills found (from cache)` after adding a skill            | Stale scan cache — run `npx skills-npm --force`                               |
| `version-check` error naming workspaces                        | Root version and workspace versions disagree — run `npm run syncpack`         |
| Unexpected UUIDs in `fdc3-agent-proxy` / `fdc3-web-impl` tests | A new `sc.createUUID()` shifted the sequential test UUIDs                     |
| Reformat-only diff on files you barely touched                 | The husky/lint-staged prettier pass ran; keep non-functional churn out of PRs |
