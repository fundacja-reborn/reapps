#!/usr/bin/env node
// Release wrapper for the Nx monorepo.
//
// nx release skips package.json files marked "private": true and never touches
// the workspace-root package.json. In this repo the root + apps + @reborn/i18n
// are all private, so a plain nx release leaves them stale — and
// apps/*/vite.config.ts injects __APP_VERSION__ from the root manifest, so the
// UI version freezes at the old number.
//
// This script runs nx release in two phases and syncs the missing manifests in
// between, so the final release commit carries a coherent version across the
// whole workspace.
import { releaseChangelog, releaseVersion } from 'nx/release/index.js';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);

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
const specifier = specifierArg ? specifierArg.split('=')[1] : undefined;

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
