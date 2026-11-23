#!/usr/bin/env node
/**
 * One command from a checkout to a verified Mac App Store package of the
 * re/notes desktop app (Tauri shell in apps/reborn-notes/src-tauri).
 *
 * The macOS counterpart of build-native-aab.mjs. It does the steps that are
 * easiest to get wrong by hand and then reads the finished artifact back
 * instead of trusting the sources it was built from:
 *
 *   1. the CFBundleVersion bump App Store Connect requires on every upload,
 *   2. the web bundle against the production API, the universal binary with
 *      the store overlay (tauri.appstore.conf.json), the provisioning profile
 *      embedded and the app signed with the Apple Distribution certificate,
 *   3. the installer package (productbuild, Mac Installer Distribution),
 *   4. checks on the result: Info.plist, signature and team, the exact set of
 *      entitlements, the embedded profile, both architectures, the API origin
 *      compiled into the binary, the installer signature.
 *
 * Variants:
 *   appstore      (default) the package to upload (Transporter).
 *   dev-sandbox   a debug .app with the store's sandbox and keychain under the
 *                 development identifier, signed with a development profile,
 *                 for a smoke test of the sandbox before an upload. No package.
 *
 * CFBundleVersion policy (idempotent, as versionCode in the AAB script): bump
 * only when the working tree value equals the one committed in HEAD; a pending
 * uncommitted bump is reused. Committing it goes through a PR (main is
 * protected, tauri.conf.json is tracked).
 *
 * Signing material stays in the keychain and in ~/reborn-keys: the script
 * reads the provisioning profile (not a secret) and only names the signing
 * identities; it never exports a key. Runs in a terminal of the Mac that holds
 * them (the session sandbox sees no signing identity).
 *
 * Usage: node scripts/build-desktop-mas.mjs [options]   (run from anywhere)
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSupportedLocales } from './supported-locales.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_DIR = join(REPO_ROOT, 'apps', 'reborn-notes');
const TAURI_DIR = join(APP_DIR, 'src-tauri');
const BASE_CONFIG = join(TAURI_DIR, 'tauri.conf.json');

/** Team of Fundacja Reborn: the iOS app and the App Store Connect record. */
const TEAM_ID = '9ML434R9RK';

/** The API origin of the store build, also the only HTTP capability it gets. */
const PRODUCTION_API = 'https://reapps.eu/notes/api';

/** Strings that must not be in a store binary (dev origins, dev identifier, devtools). */
const FORBIDDEN_IN_BINARY = [
	'http://localhost/notes/api',
	'staging.reapps.eu',
	'10.0.2.2',
	'eu.reapps.notes.dev',
	'developerExtrasEnabled'
];

const VARIANTS = {
	appstore: {
		overlay: 'tauri.appstore.conf.json',
		entitlements: 'macos/appstore.entitlements',
		identifier: 'eu.reapps.notes',
		productName: 're-notes',
		displayName: 're/notes',
		nxTarget: 'build-desktop-prod',
		apiBase: PRODUCTION_API,
		profile: join(homedir(), 'reborn-keys', 're-notes-macos-appstore.provisionprofile'),
		profileEnv: 'REBORN_MAS_PROFILE',
		// The CN of a distribution certificate names the team.
		identity: new RegExp(`^Apple Distribution: .+ \\(${TEAM_ID}\\)$`),
		installer: new RegExp(
			`^(?:3rd Party Mac Developer Installer|Mac Installer Distribution): .+ \\(${TEAM_ID}\\)$`
		),
		cargoTarget: 'universal-apple-darwin',
		profileName: 'release',
		archs: ['arm64', 'x86_64'],
		distribution: true
	},
	'dev-sandbox': {
		overlay: 'tauri.dev-sandbox.conf.json',
		entitlements: 'macos/dev-sandbox.entitlements',
		identifier: 'eu.reapps.notes.dev',
		productName: 're-notes-dev',
		displayName: 're/notes dev',
		nxTarget: 'build-desktop-local',
		apiBase: 'http://localhost/notes/api',
		profile: join(homedir(), 'reborn-keys', 're-notes-macos-dev.provisionprofile'),
		profileEnv: 'REBORN_DEV_PROFILE',
		// The CN of a development certificate names the person, not the team:
		// the identity is given explicitly and the team checked after signing.
		identity: null,
		installer: null,
		cargoTarget: null,
		profileName: 'debug',
		archs: null,
		distribution: false
	}
};

const HELP = `
Build and verify the Mac App Store package of the re/notes desktop app.

  node scripts/build-desktop-mas.mjs [options]

Options
  --variant=<name>      appstore (default) or dev-sandbox
  --profile=<path>      provisioning profile (default: $REBORN_MAS_PROFILE or
                        ~/reborn-keys/re-notes-macos-appstore.provisionprofile;
                        dev-sandbox: $REBORN_DEV_PROFILE or
                        ~/reborn-keys/re-notes-macos-dev.provisionprofile)
  --identity=<name>     signing identity (default for appstore: the one
                        "Apple Distribution: ... (${TEAM_ID})" in the keychain;
                        dev-sandbox: $APPLE_SIGNING_IDENTITY, an Apple
                        Development certificate of team ${TEAM_ID})
  --keep-version        Leave CFBundleVersion alone (the first upload, or a rebuild)
  --build-number=<n>    Use an explicit CFBundleVersion instead of the automatic bump
  --skip-build          Verify what is already on disk, build nothing
  --dry-run             Print the resolved plan and change nothing
  -h, --help            This text

Examples
  node scripts/build-desktop-mas.mjs --keep-version        # first upload: build 1
  node scripts/build-desktop-mas.mjs                       # bump, build, sign, package, verify
  node scripts/build-desktop-mas.mjs --skip-build          # re-verify the last package
  APPLE_SIGNING_IDENTITY="Apple Development: ..." \\
    node scripts/build-desktop-mas.mjs --variant=dev-sandbox
`;

// ---------------------------------------------------------------- arguments

const parseArgs = (argv) => {
	const opts = {
		variant: 'appstore',
		profile: null,
		identity: null,
		keepVersion: false,
		buildNumber: null,
		skipBuild: false,
		dryRun: false
	};
	for (const arg of argv) {
		const eq = arg.indexOf('=');
		const flag = eq === -1 ? arg : arg.slice(0, eq);
		const value = eq === -1 ? undefined : arg.slice(eq + 1);
		switch (flag) {
			case '-h':
			case '--help':
				console.log(HELP);
				process.exit(0);
				break;
			case '--variant':
				opts.variant = value;
				break;
			case '--profile':
				opts.profile = value;
				break;
			case '--identity':
				opts.identity = value;
				break;
			case '--keep-version':
				opts.keepVersion = true;
				break;
			case '--build-number':
				opts.buildNumber = Number.parseInt(value ?? '', 10);
				break;
			case '--skip-build':
				opts.skipBuild = true;
				break;
			case '--dry-run':
				opts.dryRun = true;
				break;
			default:
				die(`unknown option: ${arg}\n${HELP}`);
		}
		const needsValue = ['--variant', '--profile', '--identity', '--build-number'];
		if (needsValue.includes(flag) && !value) die(`${flag} needs a value, e.g. ${flag}=...`);
	}
	if (!VARIANTS[opts.variant]) die(`unknown variant "${opts.variant}" (appstore, dev-sandbox)`);
	if (opts.buildNumber !== null && !(Number.isInteger(opts.buildNumber) && opts.buildNumber > 0)) {
		die('--build-number needs a positive integer');
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
function die(msg) {
	console.error(`\nbuild-desktop-mas: ${msg}`);
	process.exit(1);
}

// ------------------------------------------------------------- process glue

/** The build must never notarize (App Store builds are not notarized) or pick up CI keys. */
const buildEnv = (extra) => {
	const env = { ...process.env, ...extra };
	for (const key of [
		'APPLE_ID',
		'APPLE_PASSWORD',
		'APPLE_API_KEY',
		'APPLE_API_ISSUER',
		'APPLE_API_KEY_PATH',
		'APPLE_CERTIFICATE',
		'APPLE_CERTIFICATE_PASSWORD',
		'TAURI_CONFIG'
	]) {
		delete env[key];
	}
	return env;
};

const run = (cmd, args, cwd, extraEnv = {}) => {
	info(`$ ${cmd} ${args.join(' ')}${cwd === REPO_ROOT ? '' : `   (in ${relative(REPO_ROOT, cwd)})`}`);
	const result = spawnSync(cmd, args, { cwd, env: buildEnv(extraEnv), stdio: 'inherit' });
	if (result.error) die(`${cmd} could not be started: ${result.error.message}`);
	if (result.status !== 0) die(`${cmd} ${args.join(' ')} exited with ${result.status}`);
};

const capture = (cmd, args, cwd = REPO_ROOT) => {
	const result = spawnSync(cmd, args, { cwd, maxBuffer: 512 * 1024 * 1024 });
	return {
		status: result.error ? null : result.status,
		stdout: result.stdout ?? Buffer.alloc(0),
		stderr: result.stderr?.toString('utf8') ?? ''
	};
};

/** A plist file or plist text (XML or binary) as a JS value, via plutil. */
const plistToJson = (input) => {
	const fromFile = typeof input === 'string';
	const result = spawnSync('plutil', ['-convert', 'json', '-o', '-', fromFile ? input : '-'], {
		input: fromFile ? undefined : input,
		maxBuffer: 64 * 1024 * 1024
	});
	if (result.status !== 0) return null;
	try {
		return JSON.parse(result.stdout.toString('utf8'));
	} catch {
		return null;
	}
};

/** The XML plist inside a CMS-signed provisioning profile. */
const decodeProfile = (path) => {
	const decoded = capture('security', ['cms', '-D', '-i', path]);
	return decoded.status === 0 ? plistToJson(decoded.stdout) : null;
};

/**
 * The entitlements a signed executable carries, read from its code signature:
 * the XML entitlements blob (magic 0xfade7171) of every architecture slice.
 * Not `codesign -d --entitlements - --xml`: on macOS 27 it reports "invalid
 * entitlements blob" even for correctly signed store apps. Null when the
 * slices disagree or carry none.
 */
const signedEntitlements = (executable) => {
	const binary = readFileSync(executable);
	const magic = Buffer.from([0xfa, 0xde, 0x71, 0x71]);
	const blobs = [];
	for (let at = binary.indexOf(magic); at !== -1; at = binary.indexOf(magic, at + 4)) {
		const length = binary.readUInt32BE(at + 4);
		if (length <= 8 || at + length > binary.length) continue;
		const xml = binary.subarray(at + 8, at + length);
		if (xml.includes('<plist')) blobs.push(xml.toString('utf8'));
	}
	if (blobs.length === 0 || blobs.some((blob) => blob !== blobs[0])) return null;
	return plistToJson(Buffer.from(blobs[0], 'utf8'));
};

/** Valid identities whose name matches, from `security find-identity`. */
const findIdentities = (policyArgs, pattern) => {
	const out = capture('security', ['find-identity', '-v', ...policyArgs]).stdout.toString('utf8');
	return [...out.matchAll(/^\s*\d+\) [0-9A-F]{40} "([^"]+)"/gm)]
		.map((m) => m[1])
		.filter((name) => pattern.test(name));
};

const sameJson = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
const sortKeys = (value) =>
	Array.isArray(value)
		? value.map(sortKeys)
		: value && typeof value === 'object'
			? Object.fromEntries(
					Object.keys(value)
						.sort()
						.map((key) => [key, sortKeys(value[key])])
				)
			: value;

const humanSize = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

// ----------------------------------------------------- CFBundleVersion io

const BUNDLE_VERSION_RE = /("bundleVersion"\s*:\s*")(\d+)(")/;

const readBuildNumber = (text, source) => {
	const match = text.match(BUNDLE_VERSION_RE);
	if (!match) die(`could not find bundle > macOS > bundleVersion in ${source}`);
	return Number.parseInt(match[2], 10);
};

/** Idempotent against HEAD: one bump per pending PR, never two for the same build. */
const resolveBuildNumber = (opts) => {
	const worktree = readBuildNumber(readFileSync(BASE_CONFIG, 'utf8'), 'tauri.conf.json');
	const head = capture('git', ['show', `HEAD:${relative(REPO_ROOT, BASE_CONFIG)}`]);
	const committed = head.status === 0 ? readBuildNumber(head.stdout.toString('utf8'), 'HEAD') : null;
	if (committed === null) warn('could not read tauri.conf.json from HEAD - treating the tree as truth');
	info(`CFBundleVersion in tree: ${worktree}${committed === null ? '' : `, in HEAD: ${committed}`}`);

	if (opts.buildNumber !== null) {
		const floor = Math.max(committed ?? 0, worktree);
		if (opts.buildNumber < floor) {
			die(
				`--build-number=${opts.buildNumber} is below ${floor}. App Store Connect only takes a higher\n` +
					'build than it has seen for this version. Use --keep-version to rebuild the current one.'
			);
		}
		return { from: worktree, to: opts.buildNumber, reason: 'explicit --build-number' };
	}
	if (opts.keepVersion) return { from: worktree, to: worktree, reason: '--keep-version' };
	if (committed !== null && worktree < committed) {
		die(`the tree (${worktree}) is behind HEAD (${committed}) - tauri.conf.json looks stale`);
	}
	if (committed !== null && worktree > committed) {
		return { from: worktree, to: worktree, reason: `pending bump, uncommitted (HEAD has ${committed})` };
	}
	return { from: worktree, to: worktree + 1, reason: 'tree matches HEAD, so this build needs a new number' };
};

const writeBuildNumber = (build) => {
	const text = readFileSync(BASE_CONFIG, 'utf8');
	writeFileSync(BASE_CONFIG, text.replace(BUNDLE_VERSION_RE, `$1${build}$3`), 'utf8');
};

// ------------------------------------------------------------------- main

const opts = parseArgs(process.argv.slice(2));
const variant = VARIANTS[opts.variant];

const baseConfig = JSON.parse(readFileSync(BASE_CONFIG, 'utf8'));
const marketingVersion = baseConfig.version;
const minimumSystem = baseConfig.bundle?.macOS?.minimumSystemVersion;
const targetDir = process.env.CARGO_TARGET_DIR
	? resolve(TAURI_DIR, process.env.CARGO_TARGET_DIR)
	: join(TAURI_DIR, 'target');
const outDir = join(targetDir, ...(variant.cargoTarget ? [variant.cargoTarget] : []), variant.profileName, 'bundle');
const appPath = join(outDir, 'macos', `${variant.productName}.app`);
const binaryPath = join(appPath, 'Contents', 'MacOS', 'reborn-notes-desktop');

step(`Preflight (${opts.variant})`);

if (process.platform !== 'darwin') die('this builds a macOS app: run it on a Mac');
info(`node ${process.versions.node}, ${opts.variant} -> ${relative(REPO_ROOT, appPath)}`);

const tauriCli = capture('cargo', ['tauri', '--version']);
const tauriVersion = tauriCli.stdout.toString('utf8').trim();
if (!opts.skipBuild && !/^tauri-cli 2\./.test(tauriVersion)) {
	die(`cargo tauri 2.x not found (got "${tauriVersion || tauriCli.stderr.trim()}"); see the D0 runbook`);
}
if (tauriVersion) info(tauriVersion);

if (variant.cargoTarget && !opts.skipBuild) {
	const installed = capture('rustup', ['target', 'list', '--installed']).stdout.toString('utf8');
	for (const target of ['aarch64-apple-darwin', 'x86_64-apple-darwin']) {
		if (!installed.includes(target)) {
			const msg = `Rust target ${target} is missing for the universal binary:\n  rustup target add ${target}`;
			if (opts.dryRun) warn(msg);
			else die(msg);
		}
	}
}

// Provisioning profile: the team, the App ID and the kind must match the variant.
const profilePath = resolve(opts.profile ?? process.env[variant.profileEnv] ?? variant.profile);
if (!existsSync(profilePath)) {
	die(
		`no provisioning profile at ${profilePath}\n` +
			`Download it from https://developer.apple.com/account/resources/profiles/list and pass --profile=<path>\n` +
			`(or set ${variant.profileEnv}). Guideline 86 lists the steps.`
	);
}
const profile = decodeProfile(profilePath);
if (!profile) die(`could not decode the provisioning profile ${profilePath} (security cms -D)`);
const appIdentifier = `${TEAM_ID}.${variant.identifier}`;
const profileEntitlements = profile.Entitlements ?? {};
const expires = new Date(profile.ExpirationDate);
const daysLeft = Math.floor((expires.getTime() - Date.now()) / 86_400_000);
info(`profile "${profile.Name}" (${relative(homedir(), profilePath)}), expires ${expires.toISOString().slice(0, 10)}`);
check(
	(profile.TeamIdentifier ?? []).includes(TEAM_ID),
	`profile belongs to team ${TEAM_ID}`,
	`found ${JSON.stringify(profile.TeamIdentifier)}`
);
check(
	profileEntitlements['com.apple.application-identifier'] === appIdentifier,
	`profile is for ${appIdentifier}`,
	`found ${profileEntitlements['com.apple.application-identifier']}`
);
check((profile.Platform ?? []).includes('OSX'), 'profile is a macOS profile', `platforms ${JSON.stringify(profile.Platform)}`);
check(
	variant.distribution ? !profile.ProvisionedDevices : Array.isArray(profile.ProvisionedDevices),
	variant.distribution ? 'profile is a Mac App Store profile (no device list)' : 'profile is a development profile',
	variant.distribution ? 'it lists devices: a development profile' : 'no device list: a distribution profile'
);
check(daysLeft > 0, 'profile has not expired', `expired ${expires.toISOString()}`);
if (daysLeft > 0 && daysLeft < 30) warn(`profile expires in ${daysLeft} days - renew it before the next release`);

// Signing identities: named, never exported.
let identity = opts.identity ?? (variant.distribution ? null : process.env.APPLE_SIGNING_IDENTITY ?? null);
if (!identity && variant.identity) {
	const found = findIdentities(['-p', 'codesigning'], variant.identity);
	if (found.length !== 1) {
		die(
			`expected exactly one "Apple Distribution: ... (${TEAM_ID})" identity in the keychain, found ${found.length}` +
				(found.length ? `:\n  ${found.join('\n  ')}\nPass --identity=<name>.` : '.\nCreate it first (guideline 86, step 1).')
		);
	}
	identity = found[0];
}
if (!identity) die('no signing identity: pass --identity=<name> or set APPLE_SIGNING_IDENTITY');
info(`signing identity: ${identity}`);

let installerIdentity = null;
if (variant.installer) {
	const found = findIdentities([], variant.installer);
	if (found.length !== 1) {
		die(
			`expected exactly one Mac Installer Distribution identity of team ${TEAM_ID}, found ${found.length}` +
				(found.length ? `:\n  ${found.join('\n  ')}` : '.\nCreate it first (guideline 86, step 1).')
		);
	}
	installerIdentity = found[0];
	info(`installer identity: ${installerIdentity}`);
}

if (failures.length > 0) die('the provisioning profile does not fit this build (see FAIL above)');

const dirty = capture('git', ['status', '--porcelain']).stdout.toString('utf8').trimEnd();
if (dirty) {
	info('working tree is not clean:');
	for (const line of dirty.split('\n')) info(` ${line}`);
}

// --------------------------------------------------------------- version

step('Version');

const currentBuild = () => readBuildNumber(readFileSync(BASE_CONFIG, 'utf8'), 'tauri.conf.json');
const version =
	variant.distribution && !opts.skipBuild
		? resolveBuildNumber(opts)
		: {
				from: currentBuild(),
				to: currentBuild(),
				reason: opts.skipBuild ? '--skip-build, verifying what is on disk' : 'development build, no bump'
			};
info(`${marketingVersion} (${version.from}) -> ${marketingVersion} (${version.to})   (${version.reason})`);

const pkgPath = join(outDir, `${variant.productName}-${marketingVersion}-${version.to}.pkg`);
const profileOverlay = JSON.stringify({
	bundle: { macOS: { files: { 'embedded.provisionprofile': profilePath } } }
});
const tauriArgs = [
	'tauri',
	'build',
	'--bundles',
	'app',
	...(variant.cargoTarget ? ['--target', variant.cargoTarget] : ['--debug']),
	'--config',
	variant.overlay,
	'--config',
	profileOverlay
];

if (opts.dryRun) {
	step('Dry run, stopping here');
	info(`would build ${variant.identifier} ${marketingVersion} (${version.to})`);
	info(`would run: pnpm nx ${variant.nxTarget} reborn-notes`);
	info(`would run: APPLE_SIGNING_IDENTITY="${identity}" cargo ${tauriArgs.join(' ')}`);
	if (installerIdentity) info(`would run: productbuild --sign "${installerIdentity}" -> ${relative(REPO_ROOT, pkgPath)}`);
	info('would verify the result');
	process.exit(0);
}

if (version.to !== version.from) {
	writeBuildNumber(version.to);
	info('tauri.conf.json updated (uncommitted)');
}

// ----------------------------------------------------------------- build

const startedAt = Date.now();

if (opts.skipBuild) {
	step('Build skipped (--skip-build)');
} else {
	step('Web bundle');
	run('pnpm', ['nx', variant.nxTarget, 'reborn-notes'], REPO_ROOT);

	step('Shell: compile, bundle, sign');
	run('cargo', tauriArgs, TAURI_DIR, { APPLE_SIGNING_IDENTITY: identity });

	if (installerIdentity) {
		step('Installer package');
		run(
			'xcrun',
			['productbuild', '--sign', installerIdentity, '--component', appPath, '/Applications', pkgPath],
			REPO_ROOT
		);
	}
}

// ---------------------------------------------------------------- verify

step('Verify the artifact');

if (!existsSync(appPath)) die(`no app at ${relative(REPO_ROOT, appPath)}`);
if (!opts.skipBuild) {
	check(statSync(binaryPath).mtimeMs >= startedAt, 'app was written by this run');
}

// The web bundle Tauri compressed into the binary is the one this run built.
const envJs = join(APP_DIR, 'build-desktop', '_app', 'env.js');
const shippedEnv = existsSync(envJs) ? readFileSync(envJs, 'utf8') : '';
check(
	shippedEnv.includes(`PUBLIC_API_BASE_URL:"${variant.apiBase}"`),
	`web bundle talks to ${variant.apiBase}`,
	shippedEnv.trim() || 'build-desktop/_app/env.js missing'
);

const plist = plistToJson(join(appPath, 'Contents', 'Info.plist')) ?? {};
check(plist.CFBundleIdentifier === variant.identifier, `CFBundleIdentifier is ${variant.identifier}`, `found ${plist.CFBundleIdentifier}`);
check(plist.CFBundleShortVersionString === marketingVersion, `CFBundleShortVersionString is ${marketingVersion}`, `found ${plist.CFBundleShortVersionString}`);
check(plist.CFBundleVersion === String(version.to), `CFBundleVersion is ${version.to}`, `found ${plist.CFBundleVersion}`);
// The visible name: Info.plist keeps the file name (macOS only shows a
// localized name when it matches the file), every app language names it.
check(plist.CFBundleDisplayName === variant.productName, `CFBundleDisplayName is ${variant.productName}`, `found ${plist.CFBundleDisplayName}`);
check(plist.CFBundleName === variant.productName, `CFBundleName is ${variant.productName}`, `found ${plist.CFBundleName}`);
check(plist.LSHasLocalizedDisplayName === true, 'LSHasLocalizedDisplayName is true', `found ${plist.LSHasLocalizedDisplayName}`);
const unnamed = readSupportedLocales().filter((locale) => {
	const strings = plistToJson(join(appPath, 'Contents', 'Resources', `${locale}.lproj`, 'InfoPlist.strings'));
	return strings?.CFBundleDisplayName !== variant.displayName || strings?.CFBundleName !== variant.displayName;
});
check(
	unnamed.length === 0,
	`every app language names it ${variant.displayName} (InfoPlist.strings)`,
	`wrong or missing in ${unnamed.join(', ')}`
);
check(plist.LSMinimumSystemVersion === minimumSystem, `LSMinimumSystemVersion is ${minimumSystem}`, `found ${plist.LSMinimumSystemVersion}`);
check(plist.ITSAppUsesNonExemptEncryption === false, 'ITSAppUsesNonExemptEncryption is false', `found ${plist.ITSAppUsesNonExemptEncryption}`);
check(
	plist.LSApplicationCategoryType === 'public.app-category.productivity',
	'category is Productivity',
	`found ${plist.LSApplicationCategoryType}`
);

const verify = capture('codesign', ['--verify', '--strict', '--deep', appPath]);
check(verify.status === 0, 'signature verifies (codesign --strict --deep)', verify.stderr.trim());

const details = capture('codesign', ['-dv', appPath]).stderr;
const team = details.match(/^TeamIdentifier=(.+)$/m)?.[1];
check(team === TEAM_ID, `signed by team ${TEAM_ID}`, `found ${team ?? 'no team (ad hoc?)'}`);
check(
	/flags=.*runtime/.test(details),
	'hardened runtime is on',
	details.match(/^CodeDirectory.*$/m)?.[0]
);
const requirement = capture('codesign', ['-d', '-r-', appPath]).stdout.toString('utf8');
check(
	requirement.includes(`identifier "${variant.identifier}"`),
	`designated requirement names ${variant.identifier}`,
	requirement.trim()
);
if (variant.distribution) {
	check(requirement.includes('Apple Distribution'), 'signed with the Apple Distribution certificate', requirement.trim());
}

// Entitlements: exactly the file in the repo, nothing the profile would also allow.
const entitlements = signedEntitlements(binaryPath);
const expectedEntitlements = plistToJson(join(TAURI_DIR, variant.entitlements));
check(
	entitlements !== null && sameJson(entitlements, expectedEntitlements),
	`entitlements are exactly ${variant.entitlements}`,
	JSON.stringify(entitlements)
);
check(
	!entitlements?.['com.apple.security.get-task-allow'],
	'no get-task-allow (not debuggable)'
);
for (const [key, value] of Object.entries(expectedEntitlements ?? {})) {
	if (key.startsWith('com.apple.security.')) continue;
	const allowed = profileEntitlements[key];
	const ok = Array.isArray(value)
		? value.every((item) => (allowed ?? []).some((pattern) => pattern === item || (pattern.endsWith('*') && item.startsWith(pattern.slice(0, -1)))))
		: allowed === value;
	check(ok, `profile allows ${key}`, `profile has ${JSON.stringify(allowed)}`);
}

const embedded = join(appPath, 'Contents', 'embedded.provisionprofile');
check(
	existsSync(embedded) && readFileSync(embedded).equals(readFileSync(profilePath)),
	'the profile is embedded (Contents/embedded.provisionprofile)'
);

if (variant.archs) {
	const archs = capture('lipo', ['-archs', binaryPath]).stdout.toString('utf8').trim().split(/\s+/).sort();
	check(sameJson(archs, variant.archs), `binary is universal (${variant.archs.join(', ')})`, `found ${archs.join(', ')}`);
}

if (variant.distribution) {
	const binary = readFileSync(binaryPath);
	check(binary.includes(`${PRODUCTION_API}/*`), `HTTP capability is ${PRODUCTION_API}/* only`);
	for (const needle of FORBIDDEN_IN_BINARY) {
		check(!binary.includes(needle), `no "${needle}" in the binary`);
	}

	if (!existsSync(pkgPath)) die(`no package at ${relative(REPO_ROOT, pkgPath)}`);
	const pkgSignature = capture('pkgutil', ['--check-signature', pkgPath]).stdout.toString('utf8');
	check(
		installerIdentity !== null && pkgSignature.includes(installerIdentity),
		'package is signed with the installer certificate',
		pkgSignature.trim()
	);
}

// --------------------------------------------------------------- summary

step('Summary');
info(`variant       ${opts.variant} (${variant.identifier})`);
info(`version       ${marketingVersion} (build ${version.to})`);
info(`app           ${relative(REPO_ROOT, appPath)}`);
if (variant.distribution && existsSync(pkgPath)) {
	info(`package       ${relative(REPO_ROOT, pkgPath)} (${humanSize(statSync(pkgPath).size)})`);
}
info(`checks        ${checksPassed} passed, ${failures.length} failed, ${warnings.length} warning(s)`);

if (failures.length > 0) {
	console.log('\nFailed checks:');
	for (const f of failures) console.log(`  - ${f}`);
	console.log(variant.distribution ? '\nDo NOT upload this package.' : '\nThis build does not match the store build.');
	process.exit(1);
}

console.log('\nNext steps');
if (variant.distribution) {
	console.log('  1. Transporter -> drop the package above -> Deliver (TestFlight for macOS after processing).');
	if (version.to !== version.from || version.reason.startsWith('pending')) {
		console.log('  2. Land the CFBundleVersion bump (main is protected, so it goes through a PR):');
		console.log(`       git checkout -b chore/notes-macos-build-${version.to}`);
		console.log(`       git add ${relative(REPO_ROOT, BASE_CONFIG)}`);
		console.log(`       git commit -m "chore(notes): bump the macOS build to ${version.to} for TestFlight"`);
	}
	console.log('  Note: build-desktop/ now holds the production web bundle. Before the next development');
	console.log('  build (cargo tauri build --debug / cargo tauri dev) run: pnpm nx build-desktop-local reborn-notes');
} else {
	console.log(`  open "${appPath}"`);
}
console.log('  Smoke checklist: guideline 86.');
