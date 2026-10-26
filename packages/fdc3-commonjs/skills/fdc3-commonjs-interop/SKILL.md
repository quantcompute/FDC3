---
name: fdc3-commonjs-interop
description: >-
  Use when consuming FDC3 from a toolchain that cannot use ESM — `require()` in a Jest test with no
  ESM transform, an Electron main process, an older bundler, or plain CommonJS entry points — through
  the `@qcomp/fdc3-commonjs` package. Covers its one-line implementation and how `dist/` is produced,
  the `exports` map exactly as written and what each condition resolves to, why `import` here does not
  get real ESM, the shape of `require('@qcomp/fdc3-commonjs')` and named-versus-default interop,
  bundler CJS interop and tree-shaking limits versus `@qcomp/fdc3`, and the duplicate-dependency cost
  of installing both packages. Not for the ESM package itself or app connection code (see
  `fdc3-app-integration`), not for authoring App Directory records (see `fdc3-appd-authoring`), and
  not for changing the API (see `fdc3-schema-change`).
license: Apache-2.0
metadata:
  fdc3-package: '@qcomp/fdc3-commonjs'
  fdc3-package-version: '3.0.0-beta.1'
---

# Consuming FDC3 through `@qcomp/fdc3-commonjs`

This skill ships inside the `@qcomp/fdc3-commonjs` package tarball and describes the version it ships
with — `3.0.0-beta.1`. The `metadata.fdc3-package-version` above is the record of which version that
is: when the monorepo bumps the shared version, this file has to be reviewed, and the
`fdc3-version-bump` skill's `scripts/check-skill-versions.mjs` is what reports it as stale.

Everything below is drawn from the sources in this repository, not from general knowledge of FDC3.
Where the published documentation and the implementation disagree, the implementation is what runs
and the disagreement is called out.

## What the package is

`@qcomp/fdc3-commonjs` is the same FDC3 API as `@qcomp/fdc3`, compiled to CommonJS. It has **no API
of its own**: `packages/fdc3-commonjs/src/index.ts` is a single line —

```ts
export * from '@qcomp/fdc3';
```

Everything an application can do with `@qcomp/fdc3` it can do with this package, with identical names
and identical TypeScript types, because the types are the same package's. The package exists only
because `@qcomp/fdc3` is ESM-only (`packages/fdc3/package.json:15` sets `"type": "module"`; the
README at `packages/fdc3/README.md:5` states the split and dates it to version 2.2.0). An application
that must stay CommonJS installs this package instead. The package's own README leads with the same
point as a warning (`packages/fdc3-commonjs/README.md:5-7`): CommonJS is no longer the recommended
module system and `@qcomp/fdc3` is preferred where it can be used.

The consuming toolchains this is built for are the ones that cannot run ESM without a transform:
Jest without an ESM transform, an Electron main process, older bundlers, and plain `require()` code.
`package.json` declares `"engines": { "node": ">=22" }` and publishes `sideEffects: false`, but see
the interop section below for what `sideEffects` does and does not buy a CommonJS consumer.

## How `dist/` is produced

The package is **not** a TypeScript compilation like `@qcomp/fdc3` (`packages/fdc3/package.json:22-25`
builds with `tsc`). `packages/fdc3-commonjs/package.json:24-27` defines only `clean` (`npx rimraf dist`)
and `build` (`npx rollup -c rollup.config.mjs`), and `rollup.config.mjs` runs **two** rollup passes:

| Pass | Input          | Output            | Produces                                          |
| ---- | -------------- | ----------------- | ------------------------------------------------- |
| 1    | `src/index.ts` | `dist/index.cjs`  | the bundled CommonJS runtime                      |
| 2    | `src/index.ts` | `dist/index.d.ts` | rolled-up type declarations (`rollup-plugin-dts`) |

Two properties of the config matter to a consumer:

- **The runtime is bundled, not delegated.** `rollup.config.mjs:25-32` applies `nodeResolve()` and
  `json()` with **no `external` list**, so `@qcomp/fdc3` and its transitive packages are resolved out
  of `node_modules` and inlined into the single `dist/index.cjs` file. The emitted file is
  self-contained; `@qcomp/fdc3` is not `require()`d at runtime.
- **The types are inlined, not delegated.** The declaration pass uses `dts({ respectExternal: true })`
  (`rollup.config.mjs:37`), which means "don't auto-externalize `node_modules`" (`rollup-plugin-dts`
  README:58; the plugin marks a `node_modules` import external only when `respectExternal` is false,
  `dist/rollup-plugin-dts.mjs:3281-3284`). The declaration pass therefore flattens `@qcomp/fdc3`'s
  declarations into `dist/index.d.ts` instead of leaving an `export * from '@qcomp/fdc3'` reference.
  `@qcomp/fdc3` is still listed as a **dependency** (`packages/fdc3-commonjs/package.json:28-30`)
  because the build's declaration pass consumes it; the emitted `.d.ts` references the package
  nowhere.

The runtime output options (`rollup.config.mjs:16-23`) are `format: 'cjs'`, `exports: 'named'`,
`esModule: false`, `freeze: false`, `sourcemap: true`. Because the whole bundle is generated from
`src/index.ts`, which re-exports exactly one dependency pinned at `3.0.0-beta.1`, this package tracks
`@qcomp/fdc3` exactly and **cannot be a different version**: the inline copy is built from the same
source the ESM package ships. A version bump has to move both the `@qcomp/fdc3` pin and this
package's own `version` together, or the bundle and the declared dependency disagree.

## The `exports` map, exactly as written

`packages/fdc3-commonjs/package.json:13-17`:

```json
"exports": {
  "types": "./dist/index.d.ts",
  "require": "./dist/index.cjs",
  "import": "./dist/index.cjs"
}
```

Read the conditions literally, because the consequences are not symmetrical:

| Condition            | Resolves to         | Consequence                                                                                                                           |
| -------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `types` (TypeScript) | `./dist/index.d.ts` | TS with `moduleResolution: node16`/`bundler`/`nodenext` reads the rolled-up declarations, in which `@qcomp/fdc3`'s types are inlined. |
| `require` (Node CJS) | `./dist/index.cjs`  | `require('@qcomp/fdc3-commonjs')` loads the bundled CommonJS file. This is the intended path.                                         |
| `import` (Node ESM)  | `./dist/index.cjs`  | **`import` also gets the CommonJS file** — it does not get real ESM.                                                                  |

The `import` condition pointing at the same `.cjs` file is the important detail. It is not an
oversight: it is the fix recorded in `CHANGELOG.md:145` (issue #1694), which reads "Fixed the
`fdc3-commonjs` build to include `d.ts` files and corrects the config for easier consumption in
different environments." A consumer that reaches this package through a static `import`
or through a bundler that prefers the `import` condition still receives CommonJS; Node then loads it
as CJS and applies CJS-to-ESM interop. There is no ESM build of this package to tree-shake.

Two gaps in the map are worth knowing before you rely on it:

- There is **no `default` condition** and **no top-level `main` or `types` field**
  (`packages/fdc3-commonjs/package.json` has no `"main"`, unlike `packages/fdc3/package.json:16-17`).
  Resolution depends entirely on the `exports` map. A very old resolver that does not understand the
  `exports` field — which is exactly the kind of legacy toolchain this package targets — will fail to
  find an entry point at all and report "cannot find module". If that happens, the CommonJS escape
  hatch is not to keep digging at this package; it is to configure your tool to read `exports`, or to
  bundle `@qcomp/fdc3` with an ESM-aware step.

## Interop caveats

### The shape of `require('@qcomp/fdc3-commonjs')`

The bundle is generated with `exports: 'named'` and `esModule: false`, so it assigns each export onto
`exports` directly and adds **no `__esModule` marker** and no `Object.freeze` wrapper. The emitted
shape is, in essence:

```js
'use strict';
// …bundled @qcomp/fdc3 code…
exports.getAgent = getAgent;
exports.AgentError = void 0;
// …one assignment per export…
```

(Verified by running the installed rollup 4.64.1 against a throwaway input with this package's exact
output options: it emits `exports.<name> = <name>` lines and, with `esModule: false`, no
`Object.defineProperty(exports, '__esModule', …)`.) Consequences:

- `const fdc3 = require('@qcomp/fdc3-commonjs')` yields a **plain object of named exports** of the
  runtime values: `fdc3.getAgent`, `fdc3.AgentError`, and so on. Types such as `DesktopAgent`,
  `Channel` and `PrivateChannel` are interfaces and are erased at compile time, so they have no
  runtime export — `fdc3.DesktopAgent` is `undefined`. Destructuring works normally for values:
  `const { getAgent, AgentError } = require('@qcomp/fdc3-commonjs')`.
- Because there is no `__esModule` marker, a bundler's default-import interop treats the whole
  `module.exports` object as the default. `import fdc3 from '@qcomp/fdc3-commonjs'` therefore yields
  that object — the same object `require` returns — not a synthetic `default` binding. The package
  defines no default export of its own (`src/index.ts:1` is `export *`), so a default import only
  ever means "the namespace".

### Named versus default imports

Prefer named imports. `import { getAgent } from '@qcomp/fdc3-commonjs'` and
`const { getAgent } = require('@qcomp/fdc3-commonjs')` both work. Relying on a default import is
relying on interop, not on a declared default export, and it will read differently under Node ESM
interop than under some bundlers' CJS handling.

### CJS-to-ESM interop for bundlers

When a bundler resolves the `import` condition and finds a `.cjs` file, it treats the module as
CommonJS. It cannot perform tree-shaking across it, and it synthesises named exports through interop
rather than from a static ESM graph. The `"sideEffects": false` flag in
`packages/fdc3-commonjs/package.json:19` is honoured by webpack's module-graph analysis but does not
change the fact that the file is a single bundled artifact: nothing inside it can be dropped. If
tree-shaking and a minimal bundle matter, that is a reason to use `@qcomp/fdc3`, not this package.

### Tree-shaking versus the ESM package

`@qcomp/fdc3` ships `dist/src/index.js` as ESM with `"type": "module"` and `sideEffects: false`
(`packages/fdc3/package.json:14-15`), so an ESM-aware bundler can drop unused parts of the API. This
package ships one `dist/index.cjs` containing the entire API. A consumer that only calls `getAgent`
and `broadcast` still pays for the whole surface — the context types, the schema/bridging types, the
proxy, the connection machinery — because it is one file.

### The cost of installing both packages

`@qcomp/fdc3-commonjs` declares `@qcomp/fdc3` as a **dependency** (pinned `3.0.0-beta.1`,
`packages/fdc3-commonjs/package.json:28-30`), so installing this package installs `@qcomp/fdc3` too,
because the build's declaration pass needs it. An application that installs _both_ packages therefore holds the API twice: once as
the ESM `@qcomp/fdc3` package (for any ESM entry) and once inlined inside `dist/index.cjs` (for the
CommonJS entry). The two copies are the same code at the same version, but they are separate module
instances with separate module-scope state. Do not import part of your app from `@qcomp/fdc3` and
part from `@qcomp/fdc3-commonjs` and expect shared state — for example the cached `getAgent()`
promise lives per module instance. Pick one entry point for the application.

The two pins (this package's `version` and its `@qcomp/fdc3` dependency) are exact, so the copy
cannot silently drift to a mismatched version; but it also means `@qcomp/fdc3-commonjs` will always
pull its matching `@qcomp/fdc3` and cannot be pointed at a different one.

## Decision guide

Use `@qcomp/fdc3` unless you have a concrete reason not to. The concrete reasons to use this package
instead are the ones the package exists for:

- **Jest (or another runner) without an ESM transform**, where a `require` of the API in a CJS test
  file is the path of least resistance.
- **An Electron main process**, which runs CommonJS by default.
- **An older bundler** that does not understand `exports`/ESM well enough to consume `@qcomp/fdc3`.
- **Plain `require()` code** that is not worth converting to ESM.

If none of those apply, prefer `@qcomp/fdc3` for the ESM graph, tree-shaking, and a single copy of
the API. Note also the roadmap the repository states twice: `README.md:99` says the CommonJS roll-up
"May not be provided in future versions of FDC3", and `packages/fdc3-commonjs/README.md:7` says it is
"provided for compatibility with older projects that use CommonJS". Treat it as a migration aid, not
a long-term target.

## What is and is not in this package

API-wise nothing is missing relative to the roll-up: `export * from '@qcomp/fdc3'` carries every
export, value and type, from `getAgent`/`fdc3Ready` through `DesktopAgent`, `Channel`,
`PrivateChannel`, the `AgentError`/`ResolveError`/`ResultError` etc. enumerations, the context types,
and the schema/bridging types. What differs is packaging, not surface:

|                       | `@qcomp/fdc3`                                                | `@qcomp/fdc3-commonjs`       |
| --------------------- | ------------------------------------------------------------ | ---------------------------- |
| Module format         | ESM (`"type": "module"`)                                     | CommonJS (`dist/index.cjs`)  |
| Build                 | `tsc`                                                        | `rollup` (two passes)        |
| Runtime layout        | separate files under `dist/src/`, re-exporting four packages | one bundled `dist/index.cjs` |
| `import` gets         | real ESM                                                     | the CJS file, via interop    |
| Tree-shaking          | possible                                                     | not possible                 |
| Entry points declared | `main` + `types`                                             | `exports` map only           |

The one consumer-facing thing to watch is not a missing export but the **README usage example**: like
the `@qcomp/fdc3` README, `packages/fdc3-commonjs/README.md:25` shows `const fdc3 =
fdc3CommonJs.getAgent();` followed by `fdc3.raiseIntent(...)`. `getAgent()` returns a
`Promise<DesktopAgent>`; without `await` every method call on `fdc3` fails at runtime. Treat
`const fdc3 = await getAgent()` as the only correct form. The connection semantics, parameters, error
enumerations and failure modes are identical to `@qcomp/fdc3` and are documented in the
`fdc3-app-integration` skill.

## Where the detail lives

- `packages/fdc3-commonjs/package.json` — the `exports` map, `sideEffects`, `"files": ["dist", "skills"]`, the
  `@qcomp/fdc3` dependency pin, and the `clean`/`build` scripts.
- `packages/fdc3-commonjs/src/index.ts` — the entire implementation: one re-export.
- `packages/fdc3-commonjs/rollup.config.mjs` — both rollup passes, the output options (`esModule`,
  `exports`, `freeze`), and the `dts` `respectExternal` setting.
- `packages/fdc3-commonjs/README.md` — the package's own warning, install and usage notes.
- `packages/fdc3/package.json` and `packages/fdc3/README.md` — the ESM-only statement this package
  exists to work around, and the `type: module` / `main` / `types` fields it contrasts with.
- `CHANGELOG.md:145` — the fix (#1694) that produced the current `exports`/`d.ts` configuration.
- `AGENTS.md:38`, `README.md:98-99`, `CONTRIBUTING.md:89,91` — the package's role as a roll-up, and
  the rule that no code is added to `packages/fdc3` or `packages/fdc3-commonjs` beyond `import`/`export`.
- `website/docs/` — contains **no CommonJS guidance** at all (searched: no match for "CommonJS"),
  so the only published CommonJS instructions are the two package READMEs above.
