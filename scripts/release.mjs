#!/usr/bin/env node
// Release wrapper for the Nx monorepo.
//
// Two reasons this script exists instead of calling `nx release` directly:
//
// 1. Private manifest sync. nx release skips package.json files marked
//    "private": true and never touches the workspace-root package.json.
//    In this repo the root + apps + @reborn/i18n are all private, so a
//    plain nx release leaves them stale — and apps/*/vite.config.ts injects
//    __APP_VERSION__ from the root manifest, so the UI version freezes
//    at the old number.
//
// 2. Whole-repo conventional commits detection. nx release's built-in
//    conventionalCommits mode bumps each project only when commits touched
//    that project's files. In this monorepo the product ships from apps/**
//    (which are private: true and therefore excluded from the release group),
//    so `fix(auth): ...` that only edits apps/** would produce no bump.
//    We instead scan the entire git history since the last tag and compute
//    a single specifier for the whole fixed-version release group.
//
// Flow:
//   1. Determine specifier (explicit --specifier=… wins; otherwise scan commits).
//   2. If nothing releasable → exit 0.
//   3. releaseVersion() with that specifier (gitCommit/Tag=false, stageChanges).
//   4. Sync the four private manifests to the same version, git add them.
//   5. releaseChangelog() — one commit + tag covering public + private bumps.
import { releaseChangelog, releaseVersion } from 'nx/release/index.js';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath (not url.pathname) so spaces in the repo path are decoded
// from %20 to real spaces — otherwise cwd points to a nonexistent dir and
// every spawned git call fails with ENOENT on paths like "Projekty Dev".
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const PRIVATE_MANIFESTS = [
	'package.json',
	'apps/reborn-task/package.json',
	'apps/reborn-notes/package.json',
	'packages/i18n/package.json'
];

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const firstRelease = argv.includes('--first-release');
const verbose = argv.includes('--verbose');
const specifierArg = argv.find((a) => a.startsWith('--specifier='));
const explicitSpecifier = specifierArg ? specifierArg.split('=')[1] : undefined;

const VALID_SPECIFIERS = new Set(['major', 'minor', 'patch']);
if (explicitSpecifier && !VALID_SPECIFIERS.has(explicitSpecifier)) {
	console.error(`[release] Invalid --specifier=${explicitSpecifier}. Expected: major | minor | patch.`);
	process.exit(1);
}

function git(args) {
	return execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8' }).trim();
}

function getLastReleaseTag() {
	try {
		const tags = git(['tag', '--list', 'v*', '--sort=-v:refname'])
			.split('\n')
			.filter(Boolean);
		return tags[0] ?? null;
	} catch {
		return null;
	}
}

// Matches: type(scope)!: description  OR  type: description
const CONVENTIONAL_RE = /^(?<type>[a-z]+)(?:\([^)]+\))?(?<breaking>!)?:\s/;
const BREAKING_BODY_RE = /^BREAKING CHANGE: /m;
const BUMP_RANK = { patch: 1, minor: 2, major: 3 };

function computeSpecifierFromCommits() {
	const lastTag = getLastReleaseTag();
	const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
	// %B = raw body (subject + body), NUL-separate commits for safe splitting
	const raw = execFileSync('git', ['log', '--no-merges', '--format=%B%x00', range], {
		cwd: ROOT,
		encoding: 'utf-8'
	});
	const commits = raw.split('\0').map((c) => c.trim()).filter(Boolean);

	let highest = null;
	const bump = (level) => {
		if (!highest || BUMP_RANK[level] > BUMP_RANK[highest]) highest = level;
	};

	for (const commit of commits) {
		const subject = commit.split('\n', 1)[0];
		const match = subject.match(CONVENTIONAL_RE);
		if (!match) continue;

		const { type, breaking } = match.groups;
		if (breaking || BREAKING_BODY_RE.test(commit)) {
			bump('major');
			continue;
		}
		if (type === 'feat') bump('minor');
		else if (type === 'fix' || type === 'perf') bump('patch');
		// docs/chore/refactor/test/ci/style/build → no bump
	}

	return highest;
}

const specifier = explicitSpecifier ?? (firstRelease ? undefined : computeSpecifierFromCommits());

if (!firstRelease && !specifier) {
	console.log('\n[release] No feat/fix/perf commits since last tag — nothing to release.');
	process.exit(0);
}

console.log(
	`\n[release] specifier: ${specifier ?? '(first-release)'}${
		explicitSpecifier ? ' [explicit]' : specifier ? ' [auto from commits]' : ''
	}`
);

const { workspaceVersion, projectsVersionData } = await releaseVersion({
	dryRun,
	firstRelease,
	verbose,
	...(specifier ? { specifier } : {}),
	gitCommit: false,
	gitTag: false,
	stageChanges: true
});

if (!workspaceVersion) {
	console.log('\n[release] No workspace version bump — nothing to sync.');
	process.exit(0);
}

const syncedFiles = [];
for (const relPath of PRIVATE_MANIFESTS) {
	const absPath = resolve(ROOT, relPath);
	const raw = await readFile(absPath, 'utf-8');
	const pkg = JSON.parse(raw);
	if (pkg.version === workspaceVersion) continue;

	const previous = pkg.version;
	pkg.version = workspaceVersion;
	const trailingNewline = raw.endsWith('\n') ? '\n' : '';
	if (!dryRun) {
		await writeFile(absPath, JSON.stringify(pkg, null, 2) + trailingNewline);
	}
	syncedFiles.push(relPath);
	console.log(
		`[release] ${dryRun ? '[dry-run] would sync' : 'synced'} ${relPath}: ${previous} → ${workspaceVersion}`
	);
}

if (!dryRun && syncedFiles.length > 0) {
	execFileSync('git', ['add', '--', ...syncedFiles], { stdio: 'inherit', cwd: ROOT });
}

await releaseChangelog({
	dryRun,
	firstRelease,
	verbose,
	version: workspaceVersion,
	versionData: projectsVersionData,
	gitCommit: true,
	gitTag: true,
	stageChanges: true
});
