import { defineConfig } from 'skills-npm';

// FDC3 is an npm-workspaces monorepo, and that decides both settings below.
//
// `source: 'node_modules'` is required — not cosmetic. With the other value,
// `package.json`, skills-npm only honours packages listed in THIS package.json's
// dependencies, and the workspace packages (packages/*, toolbox/...) are not
// dependencies of the root, so every per-package skill is invisible.
// `node_modules` walks installed packages instead, which includes the
// `node_modules/@finos/*` workspace symlinks.
//   Verified 2026-10-09, skills-npm 4.0.0, with a probe skill in
//   packages/fdc3-standard/skills/: source=package.json -> 30 packages, 0 skills;
//   source=node_modules -> 877 packages, probe found.
//
// `include` is required for the same reason in reverse: `node_modules` honours
// every installed package, and third-party packages ship their own skills
// (dotenv ships two: dotenv, dotenvx). Without the filter, `npm install` would
// symlink vendor skills into .agents/skills. Restrict to first-party packages.
//
// `recursive` is kept for nested `node_modules` layouts; it is a no-op in the
// current flat npm-workspaces layout (877 packages scanned either way).
//
// Agents are left to detection on purpose — but skills-npm targets the single
// detected agent when it runs inside one, so CI must pin `--agent` explicitly.
export default defineConfig({
  source: 'node_modules',
  recursive: true,
  include: ['@finos/*'],
});
