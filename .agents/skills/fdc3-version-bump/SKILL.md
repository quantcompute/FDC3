---
name: fdc3-version-bump
description: >-
  Bump the shared FDC3 monorepo version across every workspace and keep the skills those packages ship in step
  with it. Use when cutting a release, when running `npm version <v> --workspaces`, `npm run syncpack` or
  `npm run version-check`, when a package skill's `metadata.fdc3-package-version` may be stale after a version
  bump, or when adding, renaming or moving a skill under a package's `skills/` directory. Covers running
  `.agents/skills/fdc3-version-bump/scripts/check-skill-versions.mjs` in `--check` and `--suggest` mode to find
  stale or missing skill versions, duplicate skill names, and `skills/` directories missing from a package's
  `files` array.
license: Apache-2.0
---

# Bumping the shared version, and keeping package skills honest

Every workspace in this repository carries the same version number, and that number is the only thing that
decides what a release publishes. Skills shipped inside a package inherit that number by association: a skill
living in `packages/fdc3-standard/skills/` is meant to travel inside the `@finos/fdc3-standard` tarball — it
does only when the package's `files` array lists it — so the copy a consumer's agent reads is the copy that was
current when the package was published. No build step connects the two.

This skill covers both halves of that job: performing the bump, and finding the skills whose recorded version
has fallen behind the package that ships them. The checker is a review aid, not a gate — nothing in this
repository runs it for you, so the person or agent running it is the trigger.

## The versioning contract

`scripts/version-check.js` reads the root `package.json` version and fails if any **non-private** workspace
declares a different one. Private workspaces (`toolbox/fdc3-workbench`, `toolbox/fdc3-for-web/reference-ui`,
`toolbox/fdc3-conformance`, `toolbox/fdc3-for-web/demo`) are exempt because they are never published, so they
may lag without breaking anything. The same check runs in the publish workflow before a single package leaves
the machine.

That single number decides the npm dist-tag: `.github/workflows/release.yml` reads the root version when a
GitHub Release is published and publishes every tarball with the `prerelease` tag if the version contains a
hyphen, or `latest` if it does not. A mismatch between root and workspace versions is therefore not cosmetic —
`npm run version-check` exists because a stale workspace version used to publish packages under the wrong tag.

A **package skill** takes on a second obligation. Because it is shipped, it must record which version of the
package its guidance describes, in its own frontmatter:

```yaml
---
name: fix-intent-handler
description: How to add an intent handler to the reference web implementation...
metadata:
  fdc3-package: '@finos/fdc3-web-impl'
  fdc3-package-version: '3.0.0-beta.1'
---
```

`metadata` is the agentskills.io extension point, and both values are plain strings, so quote them. Note the
distinction that trips people up: `name` is the **skill's** name (it must equal the skill's directory name),
while `fdc3-package` is the **npm package** that ships it, exactly as it appears in that package's
`package.json`. Contributor skills under `.agents/skills/` are not shipped inside any package and record no
version — do not add one to them.

The recorded version is the only place this is written down. When a consumer's agent loads
`node_modules/@finos/<pkg>/skills/<name>/SKILL.md`, the frontmatter is what tells it whether that guidance was
written against the package it has installed. `skills-npm-lock.json` records the installed package version
too, but nothing compares the two: a skill whose content predates an API change reads exactly like a skill that
is current until a human notices.

## What makes a skill go stale

A version bump is mechanical — `npm version` rewrites `package.json` files and nothing else — so no step in it
asks anyone to reread the skills that ship with the package. Between two releases a package can gain an
exported type, rename a Cucumber step, or move a file that a skill cites, and the skill keeps describing the
old world while the tarball advertises the new version.

That is why the checker reports the recent changes under the package's `src/` directory next to each stale
skill in `--suggest` mode: the question a reviewer has to answer is not "does the line differ" but "does this
skill's prose still describe what the package now does". Sometimes the answer is that only the recorded version
needs to move; sometimes the skill body needs the same edit the package just got.

## Bumping the version

The canonical sequence lives in `README.md` ("Releasing FDC3 to NPM"), on a `release/vX.Y` branch:

```bash
npm version <new-version> --include-workspace-root --workspaces
npm run syncpack
npm up
npm run build
npm run version-check
```

`npm run syncpack` (root `package.json`) runs `syncpack fix --dependencies "@finos/*"` and then
`npm run version-check`, so it both rewrites the intra-monorepo `@finos/*` dependency ranges and verifies that
root and workspace versions agree. `npm run version-check` can be run on its own at any time; it prints
`All public workspace versions match root: <version>` when it passes.

`AGENTS.md` shows the shorter `npm version <new-version> --workspaces` without `--include-workspace-root`. Do
not use that form on its own: it leaves the root `package.json` on the old version, and `version-check` then
fails because every public workspace is compared against the root. (The version in `AGENTS.md`'s own prose is
also just a snapshot — read the root `package.json` for the real one.)

The bump must land **before** the GitHub Release is published, because publishing is what triggers
`.github/workflows/release.yml`, and that workflow lint-checks, builds, tests, runs `version-check`, then packs
and publishes. A version you bump afterwards is already in consumers' hands.

## Checking the skills that shipped with the old version

The checker lives in this skill and is run from the repository root:

```bash
node .agents/skills/fdc3-version-bump/scripts/check-skill-versions.mjs --check     # exit 1 if anything is wrong
node .agents/skills/fdc3-version-bump/scripts/check-skill-versions.mjs --suggest   # the default; always exits 0
```

It reads the workspace list from the root `package.json`, looks for a `skills/` directory in each workspace,
and matches every `<pkg>/skills/<name>/SKILL.md` against `<pkg>/package.json`. It resolves everything relative
to the current working directory, so run it from the repository root — anywhere else it stops with exit code 2
and tells you `package.json` was not found. It only reads: it spawns one `git log` per stale skill and never
writes to the repository. When collecting names for the collision check it looks at real directories only —
the symlinks `skills-npm` places in `.agents/skills/` are mirrors of packaged skills, not second claims on the
name.

`--check` prints one line per package skill plus a `problems:` section, and exits `1` when anything is stale,
missing, colliding or unpackaged. That makes it usable as a pre-release gate or in a review checklist; wire it
wherever you like, but note that this repository does not wire it anywhere today.

`--suggest` is what you want while editing. For every stale skill it prints the recorded version, the package's
current version, the last 15 commits that touched `<pkg>/src` (`git log --oneline -n 15 -- <pkg>/src`, reported
as unavailable when you are not inside a checkout), and the exact frontmatter line to change — with its existing
indentation, quote style and any trailing comment preserved. For a skill that records nothing it prints the
`metadata` lines to add. It never exits non-zero on findings.

### Reading the findings

| Finding     | What it means                                                                                                                                                                                                    | What to do                                                                                                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ok`        | The recorded version equals the package version.                                                                                                                                                                 | Nothing.                                                                                                                                                                                                         |
| `stale`     | The skill records a different version than the package ships.                                                                                                                                                    | Read the `src` history the suggester printed, fix the skill body if the package moved under it, then change the one frontmatter line.                                                                            |
| `missing`   | The frontmatter has no `fdc3-package-version` (or no frontmatter at all).                                                                                                                                        | Add `fdc3-package-version` and `fdc3-package` to `metadata`. A skill with no frontmatter is broken beyond versioning — validate it.                                                                              |
| `collision` | Two `SKILL.md` files declare the same `name`, in two packages or between a package and `.agents/skills/`.                                                                                                        | Rename one. Names are the identity `skills-npm` installs by, and its conflict rules never overwrite a real directory and skip tied contenders with a warning, so one of the two simply disappears for consumers. |
| `files`     | A package has a `skills/` directory but does not list `"skills"` in its `files` array.                                                                                                                           | Add `"skills"` to the array. `npm pack` ships only what `files` names (plus the npm defaults), so this skill is invisible in the published tarball no matter how good it is.                                     |
| `note`      | Cosmetic inconsistency the checker will not fail on: `fdc3-package` names a different package than the one shipping the skill, or a workspace entry in the root `workspaces` list is a wildcard and was skipped. | Fix the `fdc3-package` value, or ignore the wildcard note if you know the list is literal.                                                                                                                       |

Two shapes of finding deserve a second look before you "fix" them by editing a version:

- A `collision` is usually a naming accident, not a versioning one. Prefer a name that names the package's job
  (`fix-intent-handler`, `author-fdc3-standard`) over a generic one a sibling package would also pick.
- A `files` problem is invisible locally — `npm pack --workspace <dir>` is the honest way to confirm the skill
  is inside the tarball (`npm pack` lists `skills/<name>/SKILL.md` in its output when it is).

## Adding a skill to a package

Contributor skills in `.agents/skills/` and package skills in `<pkg>/skills/` are the same format but different
artifacts; only the second is published. When you add, rename or move one:

1. Put it at `<pkg>/skills/<skill-name>/SKILL.md`, with the frontmatter `name` equal to `<skill-name>`.
2. Add `"skills"` to `<pkg>/package.json` `files`, or the release workflow's `npm pack --workspace` step will
   silently drop it.
3. Record `metadata.fdc3-package-version` (the package's current version) and `metadata.fdc3-package` (its npm
   name).
4. Run `npx skills-npm --force` from the repository root. A plain `npm install`/`prepare` reports
   `no skills found (from cache)` and does nothing, because the scan cache is keyed on `package-lock.json`;
   `--force` re-scans and rewrites `skills-npm-lock.json` with the skill and the installed package version.
5. Run `node .agents/skills/fdc3-version-bump/scripts/check-skill-versions.mjs --check` and expect exit 0.
6. Shape and frontmatter are checked by the agentskills.io validator, not by the version script:
   `npx --yes skills-ref@0.1.5 validate <pkg>/skills/<skill-name>`.

Renaming a skill is a consumer-visible change even though nothing in the code imports it: the name is what
`skills-npm` symlinks into a consumer's `.agents/skills/`, and `skills-npm-lock.json` in this repository keys on
it too. If the old name was ever published, expect a stale symlink somewhere until the next install.

## What this skill deliberately does not do

- It does not run the bump for you. `npm version` writes to every workspace `package.json`; that is a release
  action, not a review action.
- It does not fail a build. There is no CI job and no git hook running the checker; if the version goes stale
  again, the next person running this skill is the safety net.
- It does not judge whether a skill's prose is still accurate. Only the `src` history hint narrows that down to
  a handful of commits you still have to read.
