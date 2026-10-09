/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright FINOS FDC3 contributors - see NOTICE file
 */

/**
 * Checks the version each package-shipped skill records about itself against the version of the package that
 * ships it, and reports the two packaging mistakes that go with it: a skill name claimed twice, and a
 * `skills/` directory left out of the package's `files` array.
 *
 * Run from the repository root:
 *
 *   node .agents/skills/fdc3-version-bump/scripts/check-skill-versions.mjs --check
 *   node .agents/skills/fdc3-version-bump/scripts/check-skill-versions.mjs --suggest
 *
 * `--suggest` is the default: it always exits 0, and for every stale skill it prints the recent changes under
 * the package's `src/` directory plus the exact frontmatter line to change. `--check` prints the same findings
 * compactly and exits 1 when anything is stale, missing, colliding or left out of `files`.
 *
 * The script is read-only: it never writes to the repository, and the only process it starts is `git log`.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const USAGE = 'Usage: node .agents/skills/fdc3-version-bump/scripts/check-skill-versions.mjs [--check|--suggest]';

const SKILLS_DIR = 'skills';
const SKILL_FILE = 'SKILL.md';
const VERSION_KEY = 'fdc3-package-version';
const PACKAGE_KEY = 'fdc3-package';
const CONTRIBUTOR_SKILLS_DIR = path.join('.agents', 'skills');

const cwd = process.cwd();

main();

function main() {
  const mode = parseMode(process.argv.slice(2));
  if (!mode) return;

  const repo = scanRepo();
  if (!repo) return;

  if (repo.skills.length === 0) {
    printNoPackageSkills(repo);
    return;
  }

  const problems = findProblems(repo);
  if (mode === '--check') printCheck(repo, problems);
  else printSuggest(repo, problems);
}

function parseMode(args) {
  if (args.length === 0) return '--suggest';
  if (args.length === 1 && (args[0] === '--check' || args[0] === '--suggest')) return args[0];
  console.error(`check-skill-versions: unrecognised argument(s): ${args.join(' ') || '(none)'}`);
  console.error(USAGE);
  process.exitCode = 2;
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------------------------------------

function scanRepo() {
  const rootFile = path.join(cwd, 'package.json');
  if (!fs.existsSync(rootFile)) {
    console.error(`check-skill-versions: ${rootFile} not found - run this script from the repository root.`);
    process.exitCode = 2;
    return null;
  }

  const root = readJson(rootFile);
  const workspaces = Array.isArray(root.workspaces)
    ? root.workspaces
    : Array.isArray(root.workspaces?.packages)
      ? root.workspaces.packages
      : [];

  const notes = [];
  for (const entry of workspaces) {
    if (entry.includes('*')) {
      notes.push(`workspace pattern '${entry}' contains a wildcard and was skipped; only literal paths are scanned.`);
    }
  }

  const packages = [];
  const skills = [];

  for (const dir of workspaces) {
    if (dir.includes('*')) continue;

    const skillsDir = path.join(cwd, dir, SKILLS_DIR);
    if (!isDirectory(skillsDir)) continue;

    const manifestFile = path.join(cwd, dir, 'package.json');
    if (!fs.existsSync(manifestFile)) {
      notes.push(`${dir}/${SKILLS_DIR}/ exists but ${dir}/package.json does not; the skills there were skipped.`);
      continue;
    }

    const manifest = readJson(manifestFile);
    const packageName = manifest.name ?? dir;
    const packageVersion = manifest.version ?? '(no version)';
    packages.push({ dir, name: packageName, version: packageVersion, listsSkills: listsSkillsDir(manifest.files) });

    for (const skillDir of directories(skillsDir)) {
      const file = path.join(skillsDir, skillDir, SKILL_FILE);
      if (!fs.existsSync(file)) continue;

      const skill = readSkillFile(file);
      skills.push({
        file: displayPath(file),
        dir: skillDir,
        name: skill.name?.value ?? null,
        packageDir: dir,
        packageName,
        packageVersion,
        declaredPackage: skill.package?.value ?? null,
        recorded: skill.version?.value ?? null,
        recordedLine: skill.version ? skill.version.line + 1 : null,
        recordedLineText: skill.version?.lineText ?? null,
      });
    }
  }

  return { workspacesScanned: workspaces.length, packages, skills, notes };
}

/** Splits a SKILL.md into its frontmatter and the version-relevant fields recorded there. */
function readSkillFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const frontmatter = block ? block[1].replace(/\r\n/g, '\n') : '';

  return {
    name: frontmatterField(frontmatter, 'name'),
    package: frontmatterField(frontmatter, PACKAGE_KEY),
    version: frontmatterField(frontmatter, VERSION_KEY),
  };
}

/**
 * Reads one frontmatter key, tolerating indentation (so it matches inside `metadata:` too), surrounding
 * whitespace, single/double quotes and a trailing comment. Returns the value and where it was found.
 */
function frontmatterField(frontmatter, key) {
  const pattern = new RegExp(`^[ \\t]*${key}[ \\t]*:[ \\t]*(?:"([^"]*)"|'([^']*)'|([^\\s#]+))`, 'm');
  const match = pattern.exec(frontmatter);
  if (!match) return null;

  const lines = frontmatter.split('\n');
  const line = frontmatter.slice(0, match.index).split('\n').length;
  return { value: (match[1] ?? match[2] ?? match[3] ?? '').trim(), line, lineText: lines[line - 1] ?? '' };
}

function listsSkillsDir(files) {
  if (!Array.isArray(files)) return false;
  return files.some(entry => typeof entry === 'string' && entry.replace(/\/+$/, '') === SKILLS_DIR);
}

/**
 * Names declared by the contributor skills that are not shipped inside any package. Symlinked entries are
 * skipped on purpose: skills-npm mirrors packaged skills into `.agents/skills/<name>`, and counting a mirror as
 * a second claim on the name would report every packaged skill as colliding with itself.
 */
function contributorSkills() {
  const dir = path.join(cwd, CONTRIBUTOR_SKILLS_DIR);
  if (!isDirectory(dir)) return [];

  return directories(dir)
    .map(name => path.join(dir, name, SKILL_FILE))
    .filter(file => fs.existsSync(file))
    .map(file => ({ file: displayPath(file), name: readSkillFile(file).name?.value ?? null }));
}

// ---------------------------------------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------------------------------------

function findProblems(repo) {
  const stale = repo.skills.filter(skill => skill.recorded !== null && skill.recorded !== skill.packageVersion);
  const missing = repo.skills.filter(skill => skill.recorded === null);

  const byName = new Map();
  const claims = [...contributorSkills(), ...repo.skills.filter(skill => skill.name !== null)];
  for (const claim of claims) {
    byName.set(claim.name, [...(byName.get(claim.name) ?? []), claim.file]);
  }
  const collisions = [...byName.entries()].filter(([, files]) => files.length > 1);

  const files = repo.packages.filter(pkg => !pkg.listsSkills).map(pkg => pkg.dir);

  return { stale, missing, collisions, files };
}

/** Recent commits touching the package's `src/` - the changes a stale skill most likely failed to describe. */
function recentChanges(packageDir) {
  const target = `${packageDir}/src`;
  const result = spawnSync('git', ['log', '--oneline', '-n', '15', '--', target], { cwd, encoding: 'utf8' });

  if (result.error || result.status !== 0) {
    return { target, lines: [], reason: `git history is unavailable here (run inside a checkout of this repo)` };
  }

  const lines = (result.stdout ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  return { target, lines, reason: lines.length === 0 ? `no commits touch ${target}` : null };
}

// ---------------------------------------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------------------------------------

function printNoPackageSkills(repo) {
  console.log('no package skills found');
  console.log(
    `  Scanned ${repo.workspacesScanned} workspace(s) from the root package.json "workspaces"; none contains a ` +
      `${SKILLS_DIR}/<name>/${SKILL_FILE}.`
  );
  if (repo.packages.length > 0) {
    console.log(
      `  ${repo.packages.length} workspace(s) have a ${SKILLS_DIR}/ directory, but no ${SKILL_FILE} directly beneath it.`
    );
  }
  console.log(
    `  Contributor skills in ${CONTRIBUTOR_SKILLS_DIR}/ are not shipped inside a package, so they record no ${VERSION_KEY}.`
  );
  console.log('  Nothing to check.');
}

function printCheck(repo, problems) {
  console.log('FDC3 package skill version check');
  console.log(summaryLine(repo));
  console.log();

  for (const skill of repo.skills) printSkillLine(skill);
  printNotes(repo);

  const total = problems.stale.length + problems.missing.length + problems.collisions.length + problems.files.length;
  if (total === 0) {
    console.log();
    console.log("check passed: every package skill records its package's current version.");
    return;
  }

  console.log();
  console.log('problems:');
  for (const skill of problems.stale) {
    console.log(`  [stale] ${skill.file}: records ${skill.recorded}, ${skill.packageName} is ${skill.packageVersion}`);
  }
  for (const skill of problems.missing) {
    console.log(
      `  [missing] ${skill.file}: no ${VERSION_KEY} in the frontmatter (${skill.packageName} is ${skill.packageVersion})`
    );
  }
  printOtherFindings(problems);

  console.log();
  console.log(
    `check failed: ${total} problem(s) - ${problems.stale.length} stale, ${problems.missing.length} missing, ` +
      `${problems.collisions.length} duplicate name(s), ${problems.files.length} ${SKILLS_DIR}/ dir(s) missing from "files".`
  );
  process.exitCode = 1;
}

function printSuggest(repo, problems) {
  console.log('FDC3 package skill version suggestions (read-only)');
  console.log(summaryLine(repo));
  console.log();

  for (const skill of repo.skills) printSkillLine(skill);
  printNotes(repo);
  console.log();

  if (problems.stale.length === 0 && problems.missing.length === 0) {
    console.log("nothing to suggest: every package skill records its package's current version.");
  }

  for (const skill of problems.stale) printStaleSuggestion(skill);
  for (const skill of problems.missing) printMissingSuggestion(skill);

  if (problems.collisions.length > 0 || problems.files.length > 0) {
    console.log('other findings (not fixed by editing a version in a frontmatter):');
    printOtherFindings(problems);
    console.log();
  }

  console.log('No files were changed: this mode only suggests. Apply the edits above, then re-run with --check.');
}

function printStaleSuggestion(skill) {
  console.log(`stale: ${skill.file}`);
  console.log(`  records ${VERSION_KEY} ${skill.recorded}`);
  console.log(`  ${skill.packageName} is ${skill.packageVersion}`);

  const history = recentChanges(skill.packageDir);
  console.log(`  recent changes under ${history.target}:`);
  if (history.lines.length === 0) console.log(`    (${history.reason})`);
  else for (const line of history.lines) console.log(`    ${line}`);

  const replacement = rewriteVersionLine(skill.recordedLineText, skill.packageVersion);
  console.log(`  frontmatter line ${skill.recordedLine} currently reads:`);
  console.log(`    ${skill.recordedLineText.trim()}`);
  console.log("  change it to (the line's existing indentation is part of the replacement):");
  console.log(`    ${replacement ?? `${VERSION_KEY}: '${skill.packageVersion}'`}`);
  console.log();
}

function printMissingSuggestion(skill) {
  console.log(`missing: ${skill.file}`);
  console.log(`  no ${VERSION_KEY} in the frontmatter; ${skill.packageName} is ${skill.packageVersion}`);
  console.log(`  add to the frontmatter, inside the metadata: block when the skill already has one:`);
  console.log(`    ${VERSION_KEY}: '${skill.packageVersion}'`);
  console.log(`    ${PACKAGE_KEY}: '${skill.packageName}'`);
  console.log();
}

/** Rewrites the version line in place, keeping its indentation, quote style and trailing comment. */
function rewriteVersionLine(lineText, newVersion) {
  if (!lineText) return null;
  const match = /^([ \t]*)fdc3-package-version([ \t]*):[ \t]*("[^"]*"|'[^']*'|[^\s#]+)([ \t]*(?:#.*)?)$/.exec(lineText);
  if (!match) return null;

  const [, indent, gap, raw, tail] = match;
  const quote = raw.startsWith('"') ? '"' : raw.startsWith("'") ? "'" : '';
  const comment = tail && tail.trim() ? ` ${tail.trim()}` : '';
  return `${indent}${VERSION_KEY}${gap}: ${quote}${newVersion}${quote}${comment}`;
}

function printSkillLine(skill) {
  if (skill.recorded === null) {
    console.log(`  missing  ${skill.file}  (no ${VERSION_KEY}; ${skill.packageName} is ${skill.packageVersion})`);
  } else if (skill.recorded !== skill.packageVersion) {
    console.log(
      `  stale    ${skill.file}  (records ${skill.recorded}; ${skill.packageName} is ${skill.packageVersion})`
    );
  } else {
    console.log(`  ok       ${skill.file}  (${skill.packageName} ${skill.packageVersion})`);
  }
}

function printNotes(repo) {
  const notes = [];
  for (const skill of repo.skills) {
    if (skill.declaredPackage !== null && skill.declaredPackage !== skill.packageName) {
      notes.push(
        `  note     ${skill.file}  records ${PACKAGE_KEY} '${skill.declaredPackage}', but is shipped by ${skill.packageName}`
      );
    }
  }
  for (const note of repo.notes) notes.push(`  note     ${note}`);
  if (notes.length === 0) return;

  console.log();
  for (const note of notes) console.log(note);
}

function printOtherFindings(problems) {
  for (const [name, files] of problems.collisions) {
    console.log(`  [collision] skill name '${name}' is declared by ${files.length} files:`);
    for (const file of files) console.log(`      ${file}`);
  }
  for (const dir of problems.files) {
    console.log(
      `  [files] ${dir}/${SKILLS_DIR}/ exists but "${SKILLS_DIR}" is not listed in ${dir}/package.json "files"`
    );
  }
}

function summaryLine(repo) {
  const counts = { ok: 0, stale: 0, missing: 0 };
  for (const skill of repo.skills) {
    if (skill.recorded === null) counts.missing++;
    else if (skill.recorded === skill.packageVersion) counts.ok++;
    else counts.stale++;
  }
  return (
    `${repo.workspacesScanned} workspace(s); ${repo.packages.length} with a ${SKILLS_DIR}/ directory; ` +
    `${repo.skills.length} package skill(s): ${counts.ok} ok, ${counts.stale} stale, ${counts.missing} missing`
  );
}

// ---------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function isDirectory(dir) {
  return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
}

function directories(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory()) // symlinks are not followed; see contributorSkills()
    .map(entry => entry.name)
    .sort();
}

function displayPath(file) {
  return path.relative(cwd, file).split(path.sep).join('/');
}
