#!/usr/bin/env node
// Release wrapper for the Nx monorepo.
//
// Two reasons this script exists instead of calling `nx release` directly:
//
// 1. Private manifest sync. nx release skips package.json files marked
//    "private": true and never touches the workspace-root package.json.
//    In this repo the root + apps + @reborn/i18n are all private, so a
//    plain nx release leaves them stale - and apps/*/vite.config.ts injects
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
//   5. releaseChangelog() - one commit + tag covering public + private bumps.
import { releaseChangelog, releaseVersion } from 'nx/release/index.js';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath (not url.pathname) so spaces in the repo path are decoded
// from %20 to real spaces - otherwise cwd points to a nonexistent dir and
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

// nx.json configures `createRelease: "github"`, so nx calls the GitHub REST API
// and reads its token from GITHUB_TOKEN/GH_TOKEN only. With neither set it falls
// back to ~/.config/gh/hosts.yml; when the gh session is missing or expired that
// file parses to undefined and nx crashes ("Cannot read properties of undefined
// (reading 'github.com')") - even in --dry-run, which still inits the client to
// preview the changelog.
//
// Per ~/.claude/CLAUDE.md this machine does NOT depend on `gh` (its keychain/
// trustd path is unreliable under the Claude sandbox and its token expires). The
// canonical token lives in the macOS keychain and is retrievable with the same
// `git credential` call that `git push` and gh-helper.mjs use (per-repo via
// useHttpPath, converting the SSH remote to https form). Source it there and
// never touch gh. The token is never logged.
function ensureGithubToken() {
	if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) return;
	try {
		const remote = git(['remote', 'get-url', 'origin']);
		const u = new URL(remote.replace(/^git@([^:]+):/, 'https://$1/'));
		const input = `protocol=https\nhost=${u.host}\npath=${u.pathname.replace(/^\//, '')}\n\n`;
		const out = execFileSync('git', ['-c', 'credential.useHttpPath=true', 'credential', 'fill'], {
			cwd: ROOT,
			input,
			encoding: 'utf-8'
		});
		const token = out.match(/^password=(.+)$/m)?.[1];
		if (token) {
			process.env.GH_TOKEN = token;
			console.log('[release] Sourced GitHub token from git credential (keychain).');
			return;
		}
		console.warn(`[release] git credential returned no token for ${u.host}.`);
	} catch (err) {
		console.warn(
			'[release] Could not source a GitHub token from git credential. GitHub ' +
				'Release creation and changelog PR links may fail. Set GITHUB_TOKEN/GH_TOKEN ' +
				'manually if needed.' + (verbose ? `\n${err}` : '')
		);
	}
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
	console.log('\n[release] No feat/fix/perf commits since last tag - nothing to release.');
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
	console.log('\n[release] No workspace version bump - nothing to sync.');
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

// nx inits the GitHub client (and may hit the API for changelog PR/author data)
// in dry-run too, so source a real token in both modes - a placeholder would 401.
ensureGithubToken();

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
