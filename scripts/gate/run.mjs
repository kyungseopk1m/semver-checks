// Accuracy gate for `--strict`, run against the fixed corpus in corpus.json.
//
// The oracle is `tsc`, not the author's published bump. Every package has one
// hand-written consumer.ts; it is compiled against both sides of a pair, and a
// pair is a TRUE break iff the new side produces error lines the old side did
// not. Using the published bump instead would be circular - the tool exists
// because authors get the bump wrong.
//
// Three verdicts are collected per pair:
//   tool     - `--strict` fails when summary.majorProven > 0
//   any      - summary.major > 0, the ungated "did it notice at all" signal
//   baseline - naive-baseline.mjs, the 45-line control group
//
// Usage:
//   node scripts/gate/run.mjs                 build, measure, print, write results
//   node scripts/gate/run.mjs --label BEFORE  tag the run (goes in the JSON)
//   node scripts/gate/run.mjs --no-build      reuse the existing dist/
//   node scripts/gate/run.mjs --out x.json    where to write (default gate-results.json)
//
// tsc results are cached per package@version under the OS temp dir and survive
// across runs: they depend on the published package, never on this repo's code,
// so re-measuring after a fix only re-runs the tool.

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { comparePair } from './naive-baseline.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const BIN = path.join(REPO, 'bin', 'semver-checks.js');
const ORACLE_ROOT = path.join(os.tmpdir(), 'semver-checks-gate', 'oracle');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const LABEL = flag('--label', 'run');
const OUT = flag('--out', path.join(HERE, 'gate-results.json'));
const BUILD = !argv.includes('--no-build');

const TOOL_TIMEOUT_MS = 180_000;
const TOOL_CONCURRENCY = 4;
const ORACLE_CONCURRENCY = 6;

// The consumer is compiled the way a modern strict consumer would. `skipLibCheck`
// stays off so a package that ships broken types is not silently forgiven, and
// the config lives in the install dir - never in the repo, whose own tsconfig
// would otherwise capture the file.
const TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      strict: true,
      noEmit: true,
      module: 'nodenext',
      moduleResolution: 'nodenext',
      target: 'es2022',
      jsx: 'react-jsx',
      skipLibCheck: false,
    },
    files: ['consumer.ts'],
  },
  null,
  2,
);

const corpus = JSON.parse(fs.readFileSync(path.join(HERE, 'corpus.json'), 'utf8'));

// A pair is compiled against the package's main consumer plus any probes declared
// for that specific pair. Probes exist because a finding the oracle never touches
// is not evidence in either direction: when the tool flags a symbol the main
// consumer ignores, the honest move is to write a consumer that uses that symbol
// the ordinary way and let tsc answer.
const pairs = [];
for (const [pkg, cfg] of Object.entries(corpus.packages)) {
  for (const [old, nw] of cfg.pairs) {
    const consumers = [cfg.consumer, ...(cfg.probes?.[`${old}->${nw}`] ?? [])];
    pairs.push({ pkg, old, nw, cfg, consumers });
  }
}

function run(cmd, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, timeoutMs)
      : null;
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

async function pool(items, concurrency, worker) {
  const results = new Array(items.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (idx < items.length) {
        const i = idx++;
        results[i] = await worker(items[i], i);
      }
    }),
  );
  return results;
}

// ---------------------------------------------------------------- oracle

// Only the consumer's own diagnostics count. Errors raised inside the library's
// `.d.ts` files are the package's problem, not evidence that this consumer broke.
function consumerErrors(tscOut) {
  return new Set((tscOut.match(/^consumer\.ts\(\d+,\d+\): error TS\d+:.*/gm) || []).map((l) => l.trim()));
}

async function oracleFor(pkg, ver, consumer, cfg) {
  const dir = path.join(ORACLE_ROOT, `${pkg}@${ver}__${consumer}`.replace(/[@/]/g, '_'));
  const cacheFile = path.join(dir, 'result.json');
  if (fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), TSCONFIG);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'gate-oracle', private: true }));
  fs.copyFileSync(path.join(HERE, 'consumers', consumer), path.join(dir, 'consumer.ts'));

  const deps = [`${pkg}@${ver}`, 'typescript@5', '@types/node', ...(cfg.extraDeps ?? [])];
  const install = await run('npm', ['i', ...deps, '--silent', '--no-audit', '--no-fund'], dir, 600_000);
  const tsc = await run('npx', ['tsc', '-p', 'tsconfig.json'], dir, 600_000);
  const result = {
    spec: `${pkg}@${ver}`,
    consumer,
    installCode: install.code,
    installErr: install.stderr.slice(0, 400),
    tscCode: tsc.code,
    errors: [...consumerErrors(tsc.stdout)],
  };
  fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2));
  return result;
}

// ---------------------------------------------------------------- tool

async function toolFor({ pkg, old, nw }) {
  const r = await run(
    'node',
    [BIN, 'compare', `npm:${pkg}@${old}`, `npm:${pkg}@${nw}`, '--format', 'json'],
    REPO,
    TOOL_TIMEOUT_MS,
  );
  if (r.timedOut) return { outcome: 'timeout' };
  // Exit 2 is the tool refusing to answer (resolve/extract failure). That is a
  // non-answer, not a clean bill of health, so it is kept out of precision and
  // reported on its own line.
  if (r.code === 2) return { outcome: 'error', message: r.stderr.trim().split('\n').slice(-1)[0] };
  let parsed;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    return { outcome: 'parse-error', code: r.code };
  }
  // Which rules did the proven majors come from? This is what tells you whether
  // demoting a rule to review-only would cost recall.
  const provenKinds = {};
  for (const c of parsed.changes) {
    if (c.severity !== 'major' || c.confidence === 'heuristic') continue;
    provenKinds[c.kind] = (provenKinds[c.kind] ?? 0) + 1;
  }
  return {
    outcome: 'ok',
    majorProven: parsed.summary.majorProven,
    majorReview: parsed.summary.majorReview,
    major: parsed.summary.major,
    // The proven-only bump a declaration is graded against needs the minor
    // count too: majorProven decides major, and minor decides the rest.
    minor: parsed.summary.minor,
    recommended: parsed.recommended,
    provenKinds,
  };
}

// ---------------------------------------------------------------- scoring

function score(rows, fired) {
  const usable = rows.filter((r) => r.oracle !== 'inconclusive');
  const truths = usable.filter((r) => r.oracle === 'TRUE');
  const firedRows = usable.filter(fired);
  const tp = firedRows.filter((r) => r.oracle === 'TRUE').length;
  return {
    fired: firedRows.length,
    truePositives: tp,
    falsePositives: firedRows.length - tp,
    breaks: truths.length,
    missed: truths.length - tp,
    precision: firedRows.length ? tp / firedRows.length : null,
    recall: truths.length ? tp / truths.length : null,
  };
}

const pct = (v) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);

async function main() {
  if (BUILD) {
    console.log('building...');
    execFileSync('npm', ['run', 'build'], { cwd: REPO, stdio: 'inherit' });
  }

  const specs = [];
  const seen = new Set();
  for (const { pkg, old, nw, cfg, consumers } of pairs) {
    for (const v of [old, nw]) {
      for (const consumer of consumers) {
        const key = `${pkg}@${v}__${consumer}`;
        if (seen.has(key)) continue;
        seen.add(key);
        specs.push({ pkg, ver: v, consumer, cfg });
      }
    }
  }

  console.log(`oracle: ${specs.length} installs (cached across runs)`);
  const oracleResults = await pool(specs, ORACLE_CONCURRENCY, async (s) => {
    const r = await oracleFor(s.pkg, s.ver, s.consumer, s.cfg);
    console.log(`  ${r.spec} [${r.consumer}]: install=${r.installCode} tsc=${r.tscCode} consumerErrors=${r.errors.length}`);
    return r;
  });
  const bySpec = Object.fromEntries(oracleResults.map((r) => [`${r.spec}__${r.consumer}`, r]));

  console.log(`\ntool: ${pairs.length} pairs`);
  const toolResults = await pool(pairs, TOOL_CONCURRENCY, async (p) => {
    const t = await toolFor(p);
    console.log(`  ${p.pkg} ${p.old}->${p.nw}: ${t.outcome} proven=${t.majorProven ?? '-'} major=${t.major ?? '-'}`);
    return t;
  });

  console.log(`\nbaseline: ${pairs.length} pairs`);
  const baselineResults = pairs.map((p) => comparePair(p.pkg, p.old, p.nw));

  const rows = pairs.map((p, i) => {
    // Any consumer that gains an error makes the pair a real break; all of them
    // failing to install makes it inconclusive.
    let oracle = 'inconclusive';
    const newOnly = [];
    for (const consumer of p.consumers) {
      const oldR = bySpec[`${p.pkg}@${p.old}__${consumer}`];
      const newR = bySpec[`${p.pkg}@${p.nw}__${consumer}`];
      if (oldR.installCode !== 0 || newR.installCode !== 0) continue;
      const oldErrs = new Set(oldR.errors);
      const gained = newR.errors.filter((e) => !oldErrs.has(e)).map((e) => `[${consumer}] ${e}`);
      newOnly.push(...gained);
      if (oracle === 'inconclusive') oracle = 'FALSE';
      if (gained.length > 0) oracle = 'TRUE';
    }
    return {
      pkg: p.pkg,
      old: p.old,
      nw: p.nw,
      oracle,
      consumers: p.consumers,
      newOnlyErrors: newOnly,
      tool: toolResults[i],
      baseline: baselineResults[i] ? { major: baselineResults[i].major, removed: baselineResults[i].removed.length, arity: baselineResults[i].arity.length } : null,
    };
  });

  const strict = score(rows, (r) => r.tool.outcome === 'ok' && r.tool.majorProven > 0);
  const any = score(rows, (r) => r.tool.outcome === 'ok' && r.tool.major > 0);
  const baseline = score(rows, (r) => r.baseline?.major === true);
  const provenCounts = rows.filter((r) => r.tool.outcome === 'ok').map((r) => r.tool.majorProven);
  const maxProven = provenCounts.length ? Math.max(...provenCounts) : 0;
  const worst = rows.filter((r) => r.tool.outcome === 'ok' && r.tool.majorProven === maxProven)[0];

  const summary = {
    label: LABEL,
    pairs: rows.length,
    inconclusive: rows.filter((r) => r.oracle === 'inconclusive').length,
    toolErrors: rows.filter((r) => r.tool.outcome !== 'ok').length,
    breaks: strict.breaks,
    strict,
    any,
    baseline,
    maxProvenPerPair: maxProven,
    maxProvenPair: worst ? `${worst.pkg} ${worst.old}->${worst.nw}` : null,
  };

  console.log(`\n=== ${LABEL} ===`);
  console.log(`pairs ${summary.pairs}  inconclusive ${summary.inconclusive}  tool non-answers ${summary.toolErrors}  real breaks ${summary.breaks}`);
  console.log('gate            fired  TP  FP  missed  precision  recall');
  for (const [name, s] of [['--strict (proven)', strict], ['any confidence  ', any], ['naive baseline  ', baseline]]) {
    console.log(
      `${name} ${String(s.fired).padStart(5)} ${String(s.truePositives).padStart(3)} ${String(s.falsePositives).padStart(3)} ${String(s.missed).padStart(7)}  ${pct(s.precision).padStart(9)}  ${pct(s.recall).padStart(6)}`,
    );
  }
  console.log(`max proven majors in a single pair: ${maxProven}  (${summary.maxProvenPair})`);

  fs.writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 2));
  console.log(`\nwrote ${OUT}`);
}

main();
