#!/usr/bin/env node
// PR-based release wrapper for the Nx monorepo.
//
// `main` is protected (no direct pushes; PR + required CI check). So the release
// version bump cannot be pushed straight to main like `nx release` wants. This
// wrapper splits a release into two phases:
//
//   pnpm release            Phase 1. Compute the bump from conventional commits
//                           since the last tag, write the new versions + a
//                           CHANGELOG entry, commit them on a `release/vX`
//                           branch, push it, and open a PR. No tag, no push to
//                           main, no GitHub Release yet.
//   <review + merge the PR> The release PR goes through CI + review like any
//                           other change and lands the bump on main.
//   pnpm release:finalize   Phase 2. Tag main's HEAD as vX, push the tag, and
//                           create the GitHub Release from the CHANGELOG entry.
//
// Why a wrapper at all (besides PR routing):
//   1. Private manifest sync. nx release skips `"private": true` package.json
//      files (root + apps + @reborn/i18n) and never touches the workspace-root
//      manifest, yet apps/*/vite.config.ts injects __APP_VERSION__ from the root
//      manifest, so we sync those four by hand to the workspace version.
//   2. Whole-repo conventional-commits detection. The product ships from apps/**
//      (private, excluded from the release group), so a `fix(...)` touching only
//      apps/** would yield no bump under nx's per-project detection. We instead
//      scan the whole history since the last tag and compute one specifier.
//
// GitHub token: from the macOS keychain via `git credential` (the same source as
// `git push` and gh-helper.mjs), never `gh`. See ~/.claude/CLAUDE.md.
import { releaseChangelog, releaseVersion } from 'nx/release/index.js';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// In a sandbox (e.g. Claude Code) the network is tunneled through a proxy
// (HTTPS_PROXY). Node's fetch (undici) ignores it by default and tries a direct
// connect, which the sandbox blocks (EPERM) - both for our GitHub API calls and
// nx's changelog client. Route fetch through the proxy when one is set; a no-op
// outside a sandbox. Must run before any fetch (nx's client is created later).
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) {
	try {
		const { setGlobalDispatcher, EnvHttpProxyAgent } = await import('undici');
		setGlobalDispatcher(new EnvHttpProxyAgent());
	} catch {
		// undici not resolvable - fetch stays direct (fine outside a sandbox)
	}
}

// fileURLToPath (not url.pathname) so spaces in the repo path are decoded from
// %20 to real spaces - otherwise cwd points to a nonexistent dir and every
// spawned git call fails with ENOENT on paths like "Projekty Dev".
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const PRIVATE_MANIFESTS = [
	'package.json',
	'apps/reborn-task/package.json',
	'apps/reborn-notes/package.json',
	'packages/i18n/package.json'
];

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const finalize = argv.includes('--finalize');
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

// owner/repo from the origin remote (handles both git@ and https forms).
function repoSlug() {
	const url = git(['remote', 'get-url', 'origin']);
	const m = url.match(/github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?$/);
	if (!m) throw new Error('[release] Could not parse owner/repo from origin: ' + url);
	return { owner: m[1], repo: m[2] };
}

// GitHub token from the macOS keychain via `git credential` (per-repo, the same
// source as `git push` and gh-helper.mjs). Never `gh`, never logged.
function githubToken() {
	const url = git(['remote', 'get-url', 'origin']);
	const u = new URL(url.replace(/^git@([^:]+):/, 'https://$1/'));
	const input = `protocol=https\nhost=${u.host}\npath=${u.pathname.replace(/^\//, '')}\n\n`;
	const out = execFileSync('git', ['-c', 'credential.useHttpPath=true', 'credential', 'fill'], {
		cwd: ROOT,
		input,
		encoding: 'utf-8'
	});
	const m = out.match(/^password=(.+)$/m);
	if (!m) throw new Error('[release] git credential returned no token (is the keychain unlocked?).');
	return m[1];
}

async function gh(token, method, path, body) {
	const res = await fetch(`https://api.github.com${path}`, {
		method,
		headers: {
			authorization: `Bearer ${token}`,
			accept: 'application/vnd.github+json',
			'content-type': 'application/json',
			'user-agent': 'reapps-release-script'
		},
		body: body ? JSON.stringify(body) : undefined
	});
	const json = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Error(
			`[release] GitHub ${method} ${path} -> ${res.status}: ${json.message || ''} ${JSON.stringify(json.errors || '')}`
		);
	}
	return json;
}

// The CHANGELOG body for a version: the lines under "## x.y.z (date)" up to the
// next "## " heading.
async function changelogSection(version) {
	const lines = (await readFile(resolve(ROOT, 'CHANGELOG.md'), 'utf-8')).split('\n');
	const start = lines.findIndex((l) => l === `## ${version}` || l.startsWith(`## ${version} `));
	if (start === -1) return '';
	let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
	if (end === -1) end = lines.length;
	return lines.slice(start + 1, end).join('\n').trim();
}

function getLastReleaseTag() {
	try {
		const tags = git(['tag', '--list', 'v*', '--sort=-v:refname']).split('\n').filter(Boolean);
		return tags[0] ?? null;
	} catch {
		return null;
	}
}

// ===================================================================
// Phase 2: finalize a merged release PR (tag + push tag + GitHub Release).
// ===================================================================
if (finalize) {
	const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
	if (branch !== 'main') {
		console.error(`[release] --finalize must run on main (currently on "${branch}"). Merge the release PR, then run it from main.`);
		process.exit(1);
	}
	git(['fetch', 'origin', 'main', '--tags']);
	try {
		git(['merge', '--ff-only', 'origin/main']);
	} catch {
		// not fast-forwardable - handled by the divergence check below
	}
	if (git(['rev-parse', 'HEAD']) !== git(['rev-parse', 'origin/main'])) {
		console.error('[release] Local main is not in sync with origin/main. Pull the merged release PR first (git pull --ff-only).');
		process.exit(1);
	}

	const version = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf-8')).version;
	const tag = `v${version}`;

	if (git(['tag', '--list', tag])) {
		console.error(`[release] Tag ${tag} already exists locally - already finalized?`);
		process.exit(1);
	}
	if (git(['ls-remote', '--tags', 'origin', tag])) {
		console.error(`[release] Tag ${tag} already exists on origin - ${tag} is already released.`);
		process.exit(1);
	}

	const head = git(['rev-parse', '--short', 'HEAD']);
	console.log(`\n[release] Finalizing ${tag} on ${head}.`);
	if (dryRun) {
		console.log(`[release] [dry-run] would: git tag -a ${tag}; git push origin ${tag}; create GitHub Release from CHANGELOG.`);
		process.exit(0);
	}

	git(['tag', '-a', tag, '-m', tag, 'HEAD']);
	git(['push', 'origin', tag]);
	console.log(`[release] Tagged and pushed ${tag}.`);

	const token = githubToken();
	const { owner, repo } = repoSlug();
	const body = await changelogSection(version);
	const release = await gh(token, 'POST', `/repos/${owner}/${repo}/releases`, {
		tag_name: tag,
		name: tag,
		body,
		draft: false,
		prerelease: false
	});
	console.log(`[release] GitHub Release created: ${release.html_url}`);
	process.exit(0);
}

// ===================================================================
// Phase 1: open a release PR (bump + changelog on a release/vX branch).
// ===================================================================
const startBranch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
if (!dryRun && startBranch !== 'main') {
	console.error(`[release] Run releases from main (currently on "${startBranch}").`);
	process.exit(1);
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
		// docs/chore/refactor/test/ci/style/build -> no bump
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
		`[release] ${dryRun ? '[dry-run] would sync' : 'synced'} ${relPath}: ${previous} -> ${workspaceVersion}`
	);
}

if (!dryRun && syncedFiles.length > 0) {
	execFileSync('git', ['add', '--', ...syncedFiles], { stdio: 'inherit', cwd: ROOT });
}

// Move the staged bump onto a release branch so main is never written to
// directly. The staged changes follow the checkout (the branch starts at main's
// HEAD, so there is no conflict); releaseChangelog then commits them there.
const releaseBranch = `release/v${workspaceVersion}`;
if (!dryRun) {
	const localExists = git(['branch', '--list', releaseBranch]);
	const remoteExists = git(['ls-remote', '--heads', 'origin', releaseBranch]);
	if (localExists || remoteExists) {
		console.error(`[release] Branch ${releaseBranch} already exists - finish or delete the in-flight release first.`);
		process.exit(1);
	}
	git(['checkout', '-b', releaseBranch]);
}

// nx initialises a GitHub client while GENERATING the changelog (to resolve PR
// references) even with createRelease:false, so it needs a token in the env -
// otherwise it falls back to the (missing/expired) gh CLI config and crashes.
// We also need the token to push the branch and open the PR. Source it from the
// keychain up front (see githubToken() / ~/.claude/CLAUDE.md).
let token;
try {
	token = githubToken();
	process.env.GH_TOKEN = token;
} catch (err) {
	console.error('[release] Could not source a GitHub token from git credential (is the keychain unlocked?).' + (verbose ? `\n${err}` : ''));
	process.exit(1);
}

// gitTag/gitPush/createRelease all off: the tag, push to main and GitHub Release
// happen in `--finalize` after the PR merges.
await releaseChangelog({
	dryRun,
	firstRelease,
	verbose,
	version: workspaceVersion,
	versionData: projectsVersionData,
	gitCommit: true,
	gitTag: false,
	gitPush: false,
	createRelease: false,
	stageChanges: true
});

if (dryRun) {
	console.log(
		`\n[release] [dry-run] would push ${releaseBranch} and open a PR to main, then 'pnpm release:finalize' after merge.`
	);
	process.exit(0);
}

execFileSync('git', ['push', '-u', 'origin', releaseBranch], { stdio: 'inherit', cwd: ROOT });

const { owner, repo } = repoSlug();
const pr = await gh(token, 'POST', `/repos/${owner}/${repo}/pulls`, {
	title: `chore(release): v${workspaceVersion}`,
	head: releaseBranch,
	base: 'main',
	body:
		`Release v${workspaceVersion}. Version bump + CHANGELOG, routed through a PR ` +
		`because main is protected (no direct pushes).\n\n` +
		`After this merges, run \`pnpm release:finalize\` on main to tag v${workspaceVersion} ` +
		`and create the GitHub Release.\n\n` +
		`Generated by scripts/release.mjs.`
});

// Leave the working copy back on a clean main; the bump lives on the PR branch.
git(['checkout', 'main']);

console.log(`\n[release] Release PR opened: ${pr.html_url}`);
console.log('[release] After it is reviewed and merged, run: pnpm release:finalize');
