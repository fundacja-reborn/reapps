#!/usr/bin/env node
/**
 * One command from a checkout to an uploadable, verified Android App Bundle.
 *
 * Mirrors the manual runbook (guideline 62 §2 + "Weryfikacja artefaktu po
 * buildzie") and adds the two steps that are easiest to get wrong by hand:
 *
 *   1. the monotonic versionCode bump Play requires on every upload, and
 *   2. reading the finished AAB back instead of trusting the sources it was
 *      built from - the shipped `_app/env.js`, the manifest inside the bundle
 *      and the signing certificate, not the files on disk.
 *
 * versionCode policy (idempotent): bump only when the working tree value equals
 * the value committed in HEAD. A pending, uncommitted bump is reused as-is, so
 * re-running after a failed build does not skip numbers. Committing it is left
 * to a PR - `main` is protected and build.gradle is tracked.
 *
 * Never reads android/keystore.properties: signing is proven from the artifact
 * (keytool), so the secret file is only ever touched by gradle itself.
 *
 * Usage: node scripts/build-native-aab.mjs [options]   (run from anywhere)
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @capacitor/cli 8 refuses to run on anything older. */
const MIN_NODE_MAJOR = 22;

/** The upload certificate the AAB must carry (Play App Signing re-signs later). */
const EXPECTED_SIGNER_CN = 'CN=Fundacja Reborn';

const HELP = `
Build a signed, verified Android App Bundle for a Capacitor shell in this repo.

  node scripts/build-native-aab.mjs [options]

Options
  --app=<name>          Nx project holding the native shell (default: reborn-notes)
  --target=<name>       Nx target for the web bundle (default: build-native-prod)
  --keep-version        Leave versionCode alone (the bump is already committed or pending)
  --version-code=<n>    Use an explicit versionCode instead of the automatic bump
  --ios                 Also run \`cap sync ios\` and print the Xcode archive step
  --skip-build          Verify the AAB that is already on disk, build nothing
  --allow-unsigned      Continue when android/keystore.properties is missing
  --dry-run             Print the resolved plan and change nothing
  -h, --help            This text

Examples
  node scripts/build-native-aab.mjs                    # bump, build, verify
  node scripts/build-native-aab.mjs --keep-version     # build the version already in git
  node scripts/build-native-aab.mjs --skip-build       # re-verify the last AAB
`;

// ---------------------------------------------------------------- arguments

const parseArgs = (argv) => {
	const opts = {
		app: 'reborn-notes',
		target: 'build-native-prod',
		keepVersion: false,
		versionCode: null,
		ios: false,
		skipBuild: false,
		allowUnsigned: false,
		dryRun: false
	};
	for (const arg of argv) {
		const [flag, value] = arg.split('=');
		switch (flag) {
			case '-h':
			case '--help':
				console.log(HELP);
				process.exit(0);
				break;
			case '--app':
				opts.app = value;
				break;
			case '--target':
				opts.target = value;
				break;
			case '--keep-version':
				opts.keepVersion = true;
				break;
			case '--version-code':
				opts.versionCode = Number.parseInt(value, 10);
				break;
			case '--ios':
				opts.ios = true;
				break;
			case '--skip-build':
				opts.skipBuild = true;
				break;
			case '--allow-unsigned':
				opts.allowUnsigned = true;
				break;
			case '--dry-run':
				opts.dryRun = true;
				break;
			default:
				die(`unknown option: ${arg}\n${HELP}`);
		}
		if ((flag === '--app' || flag === '--target' || flag === '--version-code') && !value) {
			die(`${flag} needs a value, e.g. ${flag}=...`);
		}
	}
	if (opts.versionCode !== null && !Number.isInteger(opts.versionCode)) {
		die('--version-code needs an integer');
	}
	return opts;
};

// ------------------------------------------------------------------ output

let checksPassed = 0;
const failures = [];
const warnings = [];

const step = (title) => console.log(`\n==> ${title}`);
const info = (msg) => console.log(`    ${msg}`);
const pass = (msg) => {
	checksPassed += 1;
	console.log(`    ok    ${msg}`);
};
const check = (condition, msg, detail) => {
	if (condition) {
		pass(msg);
		return true;
	}
	failures.push(msg);
	console.log(`    FAIL  ${msg}${detail ? `\n          ${detail}` : ''}`);
	return false;
};
const warn = (msg) => {
	warnings.push(msg);
	console.log(`    warn  ${msg}`);
};
const die = (msg) => {
	console.error(`\nbuild-native-aab: ${msg}`);
	process.exit(1);
};

// ------------------------------------------------------------- process glue

const run = (cmd, args, cwd, extraEnv = {}) => {
	info(`$ ${cmd} ${args.join(' ')}${cwd === REPO_ROOT ? '' : `   (in ${relative(REPO_ROOT, cwd)})`}`);
	// A release build must never inherit the emulator cleartext switch.
	const env = { ...process.env, ...extraEnv };
	delete env.CAP_DEV_CLEARTEXT;
	const result = spawnSync(cmd, args, { cwd, env, stdio: 'inherit' });
	if (result.error) die(`${cmd} could not be started: ${result.error.message}`);
	if (result.status !== 0) die(`${cmd} ${args.join(' ')} exited with ${result.status}`);
};

const capture = (cmd, args, cwd = REPO_ROOT) => {
	const result = spawnSync(cmd, args, { cwd, maxBuffer: 512 * 1024 * 1024 });
	return { status: result.status, stdout: result.stdout ?? Buffer.alloc(0) };
};

// ------------------------------------------------------------ versionCode io

const VERSION_CODE_RE = /^(\s*versionCode\s+)(\d+)\s*$/m;
const VERSION_NAME_RE = /^\s*versionName\s+"([^"]+)"\s*$/m;

const readVersionCode = (text, source) => {
	const match = text.match(VERSION_CODE_RE);
	if (!match) die(`could not find a versionCode line in ${source}`);
	return Number.parseInt(match[2], 10);
};

const readVersionName = (text) => text.match(VERSION_NAME_RE)?.[1] ?? '?';

/**
 * Idempotent against HEAD: bump once per pending PR, never twice for the same
 * unreleased number.
 */
const resolveVersionCode = (gradlePath, opts) => {
	const worktreeText = readFileSync(gradlePath, 'utf8');
	const worktree = readVersionCode(worktreeText, 'build.gradle');
	const gitPath = relative(REPO_ROOT, gradlePath);
	const head = capture('git', ['show', `HEAD:${gitPath}`]);
	const committed =
		head.status === 0 ? readVersionCode(head.stdout.toString('utf8'), `HEAD:${gitPath}`) : null;

	if (committed === null) warn('could not read build.gradle from HEAD - treating the tree as truth');
	info(`versionCode in tree: ${worktree}${committed === null ? '' : `, in HEAD: ${committed}`}`);

	if (opts.versionCode !== null) {
		// Floor is the highest code we know about, not just the committed one: a
		// pending bump in the tree may already have been uploaded, and Play only
		// ever accepts a higher code than it has seen.
		const floor = Math.max(committed ?? 0, worktree);
		if (opts.versionCode < floor) {
			die(
				`--version-code=${opts.versionCode} is below ${floor} (HEAD has ${committed ?? '?'}, the working tree has ${worktree}).\n` +
					'Play needs a monotonic code, so this would produce a bundle it refuses. Use --keep-version to\n' +
					'rebuild the current one, or edit build.gradle by hand if you really mean to go backwards.'
			);
		}
		return { from: worktree, to: opts.versionCode, reason: 'explicit --version-code' };
	}
	if (opts.keepVersion) {
		return { from: worktree, to: worktree, reason: '--keep-version' };
	}
	if (committed !== null && worktree < committed) {
		die(
			`the tree (${worktree}) is behind HEAD (${committed}) - the working copy of build.gradle looks stale`
		);
	}
	if (committed !== null && worktree > committed) {
		return {
			from: worktree,
			to: worktree,
			reason: `pending bump, uncommitted (HEAD has ${committed})`
		};
	}
	return { from: worktree, to: worktree + 1, reason: 'tree matches HEAD, so this build needs a new code' };
};

const writeVersionCode = (gradlePath, code) => {
	const text = readFileSync(gradlePath, 'utf8');
	writeFileSync(gradlePath, text.replace(VERSION_CODE_RE, `$1${code}`), 'utf8');
};

// -------------------------------------------------------- artifact readers

/**
 * Reads one attribute out of the protobuf-encoded manifest inside an AAB.
 * XmlAttribute keeps the source string in field 3 right after the name in
 * field 2, so `12 <len> name` is followed by `1a <len> value`. Returns null
 * when the layout does not match, so a check reports "unverified" instead of
 * silently passing.
 */
const manifestAttr = (manifest, name) => {
	const needle = Buffer.concat([Buffer.from([0x12, name.length]), Buffer.from(name, 'utf8')]);
	let at = 0;
	while ((at = manifest.indexOf(needle, at)) !== -1) {
		const after = at + needle.length;
		if (manifest[after] === 0x1a) {
			const len = manifest[after + 1];
			if (len > 0 && len < 0x80) return manifest.subarray(after + 2, after + 2 + len).toString('utf8');
		}
		at = after;
	}
	return null;
};

const entry = (aab, path) => {
	const out = capture('unzip', ['-p', aab, path]);
	return out.status === 0 && out.stdout.length > 0 ? out.stdout : null;
};

const jsEnvValue = (text, key) => text.match(new RegExp(`${key}\\s*:\\s*"([^"]*)"`))?.[1] ?? null;

const humanSize = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

// ------------------------------------------------------------------- main

const opts = parseArgs(process.argv.slice(2));

const appDir = join(REPO_ROOT, 'apps', opts.app);
const androidDir = join(appDir, 'android');
const gradlePath = join(androidDir, 'app', 'build.gradle');
const projectJsonPath = join(appDir, 'project.json');
const aabPath = join(androidDir, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');

step('Preflight');

if (!existsSync(gradlePath)) die(`no Android shell at ${relative(REPO_ROOT, androidDir)}`);
if (!existsSync(projectJsonPath)) die(`no ${relative(REPO_ROOT, projectJsonPath)}`);

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
if (nodeMajor < MIN_NODE_MAJOR) {
	die(
		`Node ${process.versions.node} is too old for @capacitor/cli (needs >= ${MIN_NODE_MAJOR}).\n` +
			'Run `nvm use` in this shell first (.nvmrc pins the version) and try again.'
	);
}
info(`node ${process.versions.node}`);

const project = JSON.parse(readFileSync(projectJsonPath, 'utf8'));
const targetCommand = project.targets?.[opts.target]?.options?.command;
if (!targetCommand) die(`project ${opts.app} has no target "${opts.target}"`);

/** Expected public env, read from the very nx target we are about to run. */
const expectedEnv = Object.fromEntries(
	[...targetCommand.matchAll(/\b(PUBLIC_[A-Z0-9_]+)=(\S*)/g)].map((m) => [m[1], m[2]])
);
/** A dev-shaped host is only a leak when the chosen target did not ask for it. */
const pinnedValues = Object.values(expectedEnv).join(' ');
const isExpectedHost = (needle) => pinnedValues.includes(needle);
info(`target ${opts.target} -> ${Object.entries(expectedEnv).map(([k, v]) => `${k}=${v}`).join(' ') || '(no PUBLIC_* pinned)'}`);

if (process.env.CAP_DEV_CLEARTEXT) {
	warn('CAP_DEV_CLEARTEXT is set in this shell - it will be stripped for the sync (release is HTTPS-only)');
}

if (!existsSync(join(androidDir, 'keystore.properties'))) {
	const msg = 'android/keystore.properties is missing - the AAB would be unsigned and Play would reject it (guideline 62 §3)';
	if (opts.allowUnsigned) warn(msg);
	else die(`${msg}\nPass --allow-unsigned to build anyway.`);
}

const lockPath = join(REPO_ROOT, 'pnpm-lock.yaml');
const modulesPath = join(REPO_ROOT, 'node_modules', '.modules.yaml');
if (existsSync(lockPath) && existsSync(modulesPath)) {
	if (statSync(lockPath).mtimeMs > statSync(modulesPath).mtimeMs) {
		warn('pnpm-lock.yaml is newer than node_modules - run `pnpm install` before building');
	}
}

const dirty = capture('git', ['status', '--porcelain']).stdout.toString('utf8').trimEnd();
if (dirty) {
	info('working tree is not clean:');
	for (const line of dirty.split('\n')) info(` ${line}`);
}

// --------------------------------------------------------------- version

step('Version');

const version = resolveVersionCode(gradlePath, opts);
info(`${version.from} -> ${version.to}   (${version.reason})`);
const versionName = readVersionName(readFileSync(gradlePath, 'utf8'));

if (opts.dryRun) {
	step('Dry run, stopping here');
	info(`would build ${opts.app} with versionName ${versionName}, versionCode ${version.to}`);
	info(`would run: pnpm nx ${opts.target} ${opts.app}`);
	info(`would run: npx cap sync android${opts.ios ? ' && npx cap sync ios' : ''}`);
	info('would run: ./gradlew bundleRelease, then verify the AAB');
	process.exit(0);
}

if (version.to !== version.from) {
	writeVersionCode(gradlePath, version.to);
	info(`build.gradle updated (uncommitted)`);
}

// ----------------------------------------------------------------- build

const startedAt = Date.now();

if (opts.skipBuild) {
	step('Build skipped (--skip-build)');
} else {
	step('Web bundle');
	run('pnpm', ['nx', opts.target, opts.app], REPO_ROOT);

	step('Capacitor sync');
	run('npx', ['cap', 'sync', 'android'], appDir);
	if (opts.ios) run('npx', ['cap', 'sync', 'ios'], appDir);

	step('Gradle bundleRelease');
	run('./gradlew', ['bundleRelease'], androidDir);
}

// ---------------------------------------------------------------- verify

step('Verify the artifact');

if (!existsSync(aabPath)) die(`no AAB at ${relative(REPO_ROOT, aabPath)}`);
const aabStat = statSync(aabPath);
info(`${relative(REPO_ROOT, aabPath)} (${humanSize(aabStat.size)})`);
if (!opts.skipBuild) {
	check(
		aabStat.mtimeMs >= startedAt,
		'AAB was written by this run',
		`mtime ${new Date(aabStat.mtimeMs).toISOString()} predates the build`
	);
}

const manifest = entry(aabPath, 'base/manifest/AndroidManifest.xml');
if (!manifest) {
	check(false, 'manifest readable from the AAB');
} else {
	const builtCode = manifestAttr(manifest, 'versionCode');
	const builtName = manifestAttr(manifest, 'versionName');
	const cleartext = manifestAttr(manifest, 'usesCleartextTraffic');
	check(builtCode === String(version.to), `manifest versionCode is ${version.to}`, `found ${builtCode}`);
	check(builtName === versionName, `manifest versionName is ${versionName}`, `found ${builtName}`);
	check(cleartext === 'false', 'usesCleartextTraffic is false', `found ${cleartext}`);
}

const shippedEnv = entry(aabPath, 'base/assets/public/_app/env.js')?.toString('utf8') ?? null;
if (!shippedEnv) {
	check(false, '_app/env.js readable from the AAB');
} else {
	for (const [key, expected] of Object.entries(expectedEnv)) {
		const actual = jsEnvValue(shippedEnv, key);
		const shown = expected === '' ? '(empty)' : expected;
		check(actual === expected, `${key} is ${shown}`, `found ${actual === null ? 'nothing' : actual}`);
	}
	// Anything dev-shaped in the shipped public env means a local .env leaked
	// into the store build (this is how PUBLIC_SITE_URL=localhost:4300 got out).
	// Hosts the target pins on purpose - the emulator and staging targets - are
	// not leaks, so they are skipped rather than reported.
	for (const smell of ['localhost', '127.0.0.1', '10.0.2.2', 'staging.']) {
		if (isExpectedHost(smell)) continue;
		check(!shippedEnv.includes(smell), `no "${smell}" in the shipped public env`, shippedEnv.trim());
	}
}

const assets = capture('unzip', ['-p', aabPath, 'base/assets/public/*']);
if (assets.status !== 0) warn('could not stream base/assets/public/* for the leak scan');
else {
	for (const smell of ['staging.reapps.eu', '10.0.2.2']) {
		if (isExpectedHost(smell)) continue;
		check(!assets.stdout.includes(smell), `no "${smell}" anywhere in the shipped web assets`);
	}
}

let signer = null;
let fingerprint = null;
const cert = capture('keytool', ['-J-Duser.language=en', '-printcert', '-jarfile', aabPath]);
const certText = cert.stdout.toString('utf8');
if (cert.status !== 0 || !certText.includes('CN=')) {
	check(opts.allowUnsigned, 'AAB is signed', 'keytool found no certificate - the bundle is unsigned');
} else {
	signer = certText.match(/^\s*(?:Owner|Właściciel|Propriétaire|Eigentümer|Propietario):\s*(.+)$/m)?.[1]?.trim() ?? null;
	fingerprint = certText.match(/SHA-?256:\s*((?:[0-9A-F]{2}:){31}[0-9A-F]{2})/)?.[1] ?? null;
	check(certText.includes(EXPECTED_SIGNER_CN), `signed with ${EXPECTED_SIGNER_CN}`, signer ?? 'owner line not parsed');
}

// --------------------------------------------------------------- summary

step('Summary');
info(`app           ${opts.app} (${opts.target})`);
info(`version       ${versionName} (build ${version.to})`);
info(`artifact      ${relative(REPO_ROOT, aabPath)} (${humanSize(aabStat.size)})`);
if (signer) info(`signer        ${signer}`);
if (fingerprint) info(`upload SHA-256 ${fingerprint}`);
info(`checks        ${checksPassed} passed, ${failures.length} failed, ${warnings.length} warning(s)`);

if (failures.length > 0) {
	console.log('\nFailed checks:');
	for (const f of failures) console.log(`  - ${f}`);
	console.log('\nDo NOT upload this bundle.');
	process.exit(1);
}

console.log('\nNext steps');
console.log('  1. Play Console -> Internal testing -> upload the AAB above.');
if (version.to !== version.from || version.reason.startsWith('pending')) {
	const branch = `chore/${opts.app.replace(/^reborn-/, '')}-versioncode-${version.to}`;
	console.log('  2. Land the versionCode bump (main is protected, so it goes through a PR):');
	console.log(`       git checkout -b ${branch}`);
	console.log(`       git add ${relative(REPO_ROOT, gradlePath)}`);
	console.log(
		`       git commit -m "chore(android): bump ${opts.app.replace(/^reborn-/, '')} versionCode to ${version.to} for internal testing"`
	);
}
if (opts.ios) {
	console.log('  3. iOS: Xcode -> Product -> Archive -> Distribute App (App Store Connect).');
}
console.log('  Smoke checklist: guideline 62 §9.');
