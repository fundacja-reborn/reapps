#!/usr/bin/env node
/**
 * Dependabot alerts from the terminal, optionally compared with `pnpm audit`.
 *
 *   node scripts/dependabot-alerts.mjs                    # open alerts, one line each
 *   node scripts/dependabot-alerts.mjs --compare          # + diff against `pnpm audit`
 *   node scripts/dependabot-alerts.mjs --compare --audit-json=<file>
 *
 * Options:
 *   --state=<s>          alert state(s) to list, comma-separated
 *                        (open, dismissed, fixed, auto_dismissed). Default: open.
 *   --out=<file>         where the full alert JSON is saved. Default: tmp/dependabot-alerts.json.
 *   --compare            also run `pnpm audit --json` (whole tree and `--prod`) and print
 *                        which advisories only one of the two sources reports.
 *   --audit-json=<file>  use a saved `pnpm audit --json` output instead of running pnpm
 *                        (no prod/dev split then). For machines where pnpm cannot run.
 *
 * Why both sources: they disagree in both directions. pnpm audit reads the npm
 * registry's advisory data, Dependabot reads the GitHub Advisory Database, and the
 * same GHSA can carry different version ranges in each (a critical Capacitor
 * advisory was visible only in pnpm audit). Dependabot also ignores
 * `pnpm.overrides`, so an overridden package can stay "open" there. A clean-up is
 * done when `pnpm audit` is clean with no threshold AND the Dependabot list is
 * closed. The CI "Security audit" step reads the current advisory data, so a new
 * advisory on a package main already ships turns every open PR red: --compare
 * prints whether that step would pass right now.
 *
 * Auth: the path-scoped GitHub token for this repo, read with `git credential fill`
 * (the same token git push uses). It needs "Dependabot alerts: read". The token is
 * passed to curl on stdin (`-K -`), never in argv, so it does not show up in `ps`.
 * curl rather than Node fetch: fetch ignores HTTPS_PROXY, which sandboxed shells need.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const MARK = '\n@@curl-meta@@';

function parseArgs(argv) {
  const opts = { state: 'open', out: 'tmp/dependabot-alerts.json', compare: false, auditJson: null };
  for (const arg of argv) {
    if (arg === '--compare') opts.compare = true;
    else if (arg.startsWith('--state=')) opts.state = arg.slice(8);
    else if (arg.startsWith('--out=')) opts.out = arg.slice(6);
    else if (arg.startsWith('--audit-json=')) {
      opts.auditJson = arg.slice(13);
      opts.compare = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log('usage: node scripts/dependabot-alerts.mjs [--state=open] [--out=file] [--compare] [--audit-json=file]');
      process.exit(0);
    } else {
      console.error(`unknown option: ${arg}`);
      process.exit(2);
    }
  }
  return opts;
}

function git(args, input) {
  // No interactive fallback: without a stored token git must fail, not open an
  // askpass window (an editor's GIT_ASKPASS) or prompt on the terminal.
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  delete env.GIT_ASKPASS;
  delete env.SSH_ASKPASS;
  return execFileSync('git', ['-c', 'core.askPass=', ...args], {
    cwd: ROOT,
    input,
    env,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

/** owner/repo for the API, plus the remote path as git stores its credential. */
function repo() {
  const url = git(['remote', 'get-url', 'origin']).trim();
  const m = url.match(/github\.com[:/]+(([^/]+)\/(.+?)(?:\.git)?)$/);
  if (!m) throw new Error(`origin is not a GitHub remote: ${url}`);
  return { slug: `${m[2]}/${m[3]}`, credentialPath: m[1] };
}

let cachedToken = null;

function readToken(credentialPath) {
  if (cachedToken) return cachedToken;
  let out;
  try {
    out = git(
      ['-c', 'credential.useHttpPath=true', 'credential', 'fill'],
      `protocol=https\nhost=github.com\npath=${credentialPath}\n\n`
    );
  } catch {
    out = '';
  }
  const m = out.match(/^password=(.+)$/m);
  if (!m) {
    throw new Error(
      `no stored GitHub token for https://github.com/${credentialPath} (git credential, useHttpPath)`
    );
  }
  cachedToken = m[1];
  return cachedToken;
}

function apiGet(token, url) {
  const res = spawnSync(
    'curl',
    [
      '-sS',
      url,
      '-H', 'accept: application/vnd.github+json',
      '-H', 'x-github-api-version: 2022-11-28',
      '-H', 'user-agent: reapps-dependabot-alerts',
      '-K', '-',
      '-w', `${MARK}%{http_code} %header{link}`
    ],
    { input: `header = "authorization: Bearer ${token}"\n`, encoding: 'utf8', maxBuffer: 64 << 20 }
  );
  if (res.status !== 0) throw new Error(`curl failed: ${res.stderr || res.error}`);
  const at = res.stdout.lastIndexOf(MARK);
  const body = res.stdout.slice(0, at);
  const [status, ...link] = res.stdout.slice(at + MARK.length).split(' ');
  const next = link.join(' ').match(/<([^>]+)>;\s*rel="next"/);
  return { status: Number(status), body, next: next ? next[1] : null };
}

function fetchAlerts({ slug, credentialPath }, state) {
  const token = readToken(credentialPath);
  const alerts = [];
  let url = `https://api.github.com/repos/${slug}/dependabot/alerts?state=${encodeURIComponent(state)}&per_page=100`;
  while (url) {
    const res = apiGet(token, url);
    if (res.status !== 200) {
      let message = res.body.trim().slice(0, 300);
      try {
        message = JSON.parse(res.body).message ?? message;
      } catch {
        // not JSON, keep the raw text
      }
      const hint =
        res.status === 401 || res.status === 403
          ? ' (the token needs "Dependabot alerts: read" on this repository)'
          : '';
      throw new Error(`GitHub API HTTP ${res.status}: ${message}${hint}`);
    }
    alerts.push(...JSON.parse(res.body));
    url = res.next;
  }
  return alerts;
}

const severityRank = (s) => {
  const i = SEVERITIES.indexOf(s);
  return i === -1 ? SEVERITIES.length : i;
};
// pnpm audit says "moderate" where GitHub says "medium".
const normalizeSeverity = (s) => (s === 'moderate' ? 'medium' : s);

function printAlerts(alerts) {
  const sorted = [...alerts].sort(
    (a, b) =>
      severityRank(a.security_advisory.severity) - severityRank(b.security_advisory.severity) ||
      a.dependency.package.name.localeCompare(b.dependency.package.name) ||
      a.number - b.number
  );
  for (const a of sorted) {
    const d = a.dependency;
    const v = a.security_vulnerability;
    const fixed = v.first_patched_version?.identifier ?? 'none';
    const state = a.state === 'open' ? '' : ` {${a.state}}`;
    console.log(
      `#${a.number} [${a.security_advisory.severity}] ${d.package.name} ` +
        `(${d.manifest_path}, ${d.scope ?? '?'}, ${d.relationship ?? '?'})${state} ` +
        `${a.security_advisory.ghsa_id} ${v.vulnerable_version_range} -> ${fixed} | ${a.security_advisory.summary}`
    );
  }
  const packages = new Set(alerts.map((a) => a.dependency.package.name));
  console.log(`\n${alerts.length} alerts, ${packages.size} packages`);
}

function runAudit(prod) {
  const args = ['audit', '--json', ...(prod ? ['--prod'] : [])];
  const res = spawnSync('pnpm', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  // pnpm audit exits 1 when it finds advisories; only unparseable output is a failure.
  try {
    return JSON.parse(res.stdout);
  } catch {
    throw new Error(
      `pnpm ${args.join(' ')} gave no JSON (exit ${res.status}): ${(res.stderr || res.stdout || String(res.error)).trim().slice(0, 400)}\n` +
        'Run it yourself and pass the saved output with --audit-json=<file>.'
    );
  }
}

/** Map GHSA id -> advisory summary from a `pnpm audit --json` report. */
function auditAdvisories(report) {
  const map = new Map();
  for (const adv of Object.values(report?.advisories ?? {})) {
    const id = adv.github_advisory_id || `npm:${adv.id}`;
    const versions = new Set((adv.findings ?? []).map((f) => f.version));
    map.set(id, {
      pkg: adv.module_name,
      severity: normalizeSeverity(adv.severity),
      versions: [...versions].join(', '),
      patched: adv.patched_versions
    });
  }
  return map;
}

function compare(alerts, dismissedAlerts, auditAll, auditProd) {
  // GHSA -> dismissal reason, so a deliberately dismissed alert is not reported as
  // something Dependabot missed.
  const dismissed = new Map(
    dismissedAlerts.map((a) => [a.security_advisory.ghsa_id, a.dismissed_reason ?? 'dismissed'])
  );
  const dependabot = new Map();
  for (const a of alerts.filter((x) => x.state === 'open')) {
    const id = a.security_advisory.ghsa_id;
    const entry = dependabot.get(id) ?? {
      pkg: a.dependency.package.name,
      severity: a.security_advisory.severity,
      numbers: [],
      fixed: a.security_vulnerability.first_patched_version?.identifier ?? 'none'
    };
    entry.numbers.push(`#${a.number}`);
    dependabot.set(id, entry);
  }

  const bySeverity = (a, b) =>
    severityRank(a[1].severity) - severityRank(b[1].severity) || a[1].pkg.localeCompare(b[1].pkg);
  const prodTag = (id) => (auditProd ? (auditProd.has(id) ? ' {prod}' : ' {dev}') : '');
  const section = (title, rows) => {
    console.log(`\n${title} (${rows.length})`);
    if (!rows.length) console.log('  -');
    for (const line of rows) console.log(`  ${line}`);
  };

  const both = [];
  const onlyDependabot = [];
  for (const [id, d] of [...dependabot].sort(bySeverity)) {
    const audit = auditAll.get(id);
    const alertsText = `alerts ${d.numbers.join(' ')}`;
    if (audit) {
      both.push(`[${d.severity}] ${d.pkg} ${id}${prodTag(id)} ${alertsText}; installed ${audit.versions} -> ${audit.patched}`);
    } else {
      onlyDependabot.push(`[${d.severity}] ${d.pkg} ${id} ${alertsText}; fixed in ${d.fixed}`);
    }
  }
  const onlyAudit = [...auditAll]
    .filter(([id]) => !dependabot.has(id))
    .sort(bySeverity)
    .map(([id, a]) => {
      const note = dismissed.has(id) ? ` (dismissed in Dependabot: ${dismissed.get(id)})` : '';
      return `[${a.severity}] ${a.pkg} ${id}${prodTag(id)} installed ${a.versions} -> ${a.patched}${note}`;
    });

  section('In both', both);
  section('Only in Dependabot (often a pnpm override Dependabot cannot see, or a direct pin to align)', onlyDependabot);
  section('Only in pnpm audit', onlyAudit);

  // Mirror of the CI "Security audit" step (.github/workflows/ci.yml):
  //   pnpm audit --audit-level moderate --prod  &&  pnpm audit --audit-level high
  const atLeast = (map, level) => [...map.values()].filter((a) => severityRank(a.severity) <= severityRank(level));
  const highAll = atLeast(auditAll, 'high');
  console.log('\nCI "Security audit" step right now:');
  if (auditProd) {
    const moderateProd = atLeast(auditProd, 'medium');
    console.log(`  pnpm audit --audit-level moderate --prod: ${moderateProd.length ? `FAIL (${moderateProd.map((a) => a.pkg).join(', ')})` : 'pass'}`);
  } else {
    console.log('  pnpm audit --audit-level moderate --prod: unknown (saved report has no prod/dev split)');
  }
  console.log(`  pnpm audit --audit-level high:            ${highAll.length ? `FAIL (${highAll.map((a) => a.pkg).join(', ')})` : 'pass'}`);
  console.log(`  pnpm audit with no threshold:             ${auditAll.size ? `${auditAll.size} advisories left` : 'clean'}`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const target = repo();
  const { slug } = target;
  const alerts = fetchAlerts(target, opts.state);

  const out = resolve(ROOT, opts.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(alerts, null, 2)}\n`);

  console.log(`Dependabot alerts for ${slug} (state=${opts.state}), full JSON in ${opts.out}\n`);
  printAlerts(alerts);

  if (opts.compare) {
    const auditAll = auditAdvisories(
      opts.auditJson ? JSON.parse(readFileSync(resolve(opts.auditJson), 'utf8')) : runAudit(false)
    );
    const auditProd = opts.auditJson ? null : auditAdvisories(runAudit(true));
    const dismissed = opts.state.split(',').includes('dismissed')
      ? alerts.filter((a) => a.state === 'dismissed')
      : fetchAlerts(target, 'dismissed');
    compare(alerts, dismissed, auditAll, auditProd);
  }
}

try {
  main();
} catch (err) {
  console.error(`dependabot-alerts: ${err.message}`);
  process.exit(1);
}
