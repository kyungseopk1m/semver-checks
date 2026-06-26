// Honest accuracy probe — runs the locally-built CLI against real npm release
// pairs and classifies each outcome against the author's published bump (the
// oracle). It is the artifact behind the README's "Accuracy & Limitations"
// numbers: anyone can re-run it. Node built-ins only, no dependencies.
//
//   npm run build && node scripts/accuracy-probe.mjs
//
// Frozen scorecard (2026-06-26, semver-checks @ graded confidence):
//   analyzable 37/44 | exact 19 | stricter-than-published 9 | looser 9 | OOM 3 | ERROR 4
//   Of the 9 stricter rows, `--strict` (proven majors only) fires on 4 — real
//   breaks the author under-bumped (p-limit 6.1.0 + ky 1.14.0 added a required
//   property to an exported type, commander 12.1.0/14.0.2 removed/narrowed a
//   public member) — and demotes the other 5 to review-only heuristic majors
//   (equivalence rewrites, input-union widening, return-only generics).
//
// Each row: [package, oldVersion, newVersion, publishedBump, apiShape].
// shapes: pure=pure types, dual=ESM/CJS, esm=single ESM, esmOnly=modern ESM-only,
// ns=namespace/declaration-merging heavy, subpath=multi-subpath exports.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'semver-checks.js');
const TIMEOUT_MS = 150_000;
const CONCURRENCY = 2;

const PAIRS = [
  ['type-fest', '5.6.0', '5.7.0', 'minor', 'pure'],
  ['type-fest', '5.4.1', '5.4.2', 'patch', 'pure'],
  ['type-fest', '4.41.0', '5.0.0', 'major', 'pure'],
  ['utility-types', '3.10.0', '3.11.0', 'minor', 'pure'],
  ['utility-types', '3.6.0', '3.6.1', 'patch', 'pure'],
  ['utility-types', '2.1.0', '3.0.0', 'major', 'pure'],
  ['ts-toolbelt', '9.5.12', '9.5.13', 'patch', 'pure'],
  ['ts-toolbelt', '9.5.13', '9.6.0', 'minor', 'pure'],
  ['commander', '11.1.0', '12.0.0', 'major', 'dual'],
  ['commander', '12.0.0', '12.1.0', 'minor', 'dual'],
  ['commander', '14.0.1', '14.0.2', 'patch', 'dual'],
  ['clsx', '1.2.1', '2.0.0', 'major', 'dual'],
  ['clsx', '2.0.0', '2.1.0', 'minor', 'dual'],
  ['clsx', '2.1.0', '2.1.1', 'patch', 'dual'],
  ['tiny-invariant', '1.2.0', '1.3.0', 'minor', 'dual'],
  ['tiny-invariant', '1.3.2', '1.3.3', 'patch', 'dual'],
  ['uuid', '11.0.4', '11.1.0', 'minor', 'subpath'],
  ['uuid', '11.1.1', '12.0.0', 'major', 'subpath'],
  ['uuid', '13.0.2', '14.0.0', 'major', 'subpath'],
  ['nanoid', '5.0.9', '5.1.0', 'minor', 'esm'],
  ['nanoid', '5.1.15', '5.1.16', 'patch', 'esm'],
  ['mitt', '2.1.0', '3.0.0', 'major', 'esm'],
  ['mitt', '3.0.0', '3.0.1', 'patch', 'esm'],
  ['p-limit', '4.0.0', '5.0.0', 'major', 'esm'],
  ['p-limit', '6.0.0', '6.1.0', 'minor', 'esm'],
  ['escape-string-regexp', '4.0.0', '5.0.0', 'major', 'esm'],
  ['escape-string-regexp', '2.0.0', '3.0.0', 'major', 'esm'],
  ['ky', '1.13.0', '1.14.0', 'minor', 'esm'],
  ['ky', '1.14.2', '1.14.3', 'patch', 'esm'],
  ['ky', '1.14.3', '2.0.0', 'major', 'esm'],
  ['execa', '9.5.0', '9.6.0', 'minor', 'esm'],
  ['execa', '9.6.0', '9.6.1', 'patch', 'esm'],
  ['slugify', '1.6.5', '1.6.6', 'patch', 'esm'],
  ['slugify', '1.5.3', '1.6.0', 'minor', 'esm'],
  ['chalk', '4.1.2', '5.0.0', 'major', 'esmOnly'],
  ['chalk', '5.3.0', '5.4.0', 'minor', 'esmOnly'],
  ['chalk', '5.4.0', '5.4.1', 'patch', 'esmOnly'],
  ['zod', '4.4.0', '4.4.1', 'patch', 'ns'],
  ['zod', '4.4.1', '4.4.2', 'patch', 'ns'],
  ['yargs', '17.7.2', '17.7.3', 'patch', 'ns'],
  ['yargs', '17.7.3', '18.0.0', 'major', 'ns'],
  ['picocolors', '1.0.0', '1.0.1', 'patch', 'esm'],
  ['picocolors', '1.0.1', '1.1.0', 'minor', 'esm'],
  ['picocolors', '1.1.0', '1.1.1', 'patch', 'esm'],
];

const RANK = { patch: 0, minor: 1, major: 2 };

function runOne(pkg, oldV, newV) {
  return new Promise((resolve) => {
    const args = ['compare', `npm:${pkg}@${oldV}`, `npm:${pkg}@${newV}`, '--format', 'json'];
    const child = spawn('node', [CLI, ...args]);
    let out = '', err = '', killed = false;
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, out, err, killed }); });
  });
}

function classify(r, label) {
  const errl = (r.err || '').toLowerCase();
  if (r.killed) return { status: 'TIMEOUT' };
  if (errl.includes('heap out of memory') || errl.includes('allocation failure')) return { status: 'OOM' };
  if (r.code === 2 || !r.out.trim()) return { status: 'ERROR' };
  let json;
  try { json = JSON.parse(r.out); } catch { return { status: 'PARSEFAIL' }; }
  const rec = json.recommended;
  const verdict = rec === label ? 'exact' : RANK[rec] > RANK[label] ? 'stricter' : 'looser';
  // majorProven / majorReview split the major count by confidence: `--strict`
  // gates only on proven, so `gates` records whether the strict CI gate fires.
  const proven = json.summary?.majorProven ?? json.summary?.major ?? 0;
  const review = json.summary?.majorReview ?? 0;
  return { status: 'OK', recommended: rec, verdict, proven, review, gates: proven > 0 };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); } }));
  return out;
}

const results = await pool(PAIRS, CONCURRENCY, async ([pkg, o, nw, label, shape], idx) => {
  const c = classify(await runOne(pkg, o, nw), label);
  const conf = c.status === 'OK' && (c.proven || c.review) ? ` major{proven:${c.proven},review:${c.review}}` : '';
  console.error(`[${String(idx + 1).padStart(2)}/${PAIRS.length}] ${pkg} ${o}->${nw} (${shape}/${label}) => ${c.status}${c.recommended ? ` rec=${c.recommended} [${c.verdict}]` : ''}${conf}`);
  return { pkg, old: o, new: nw, label, shape, ...c };
});

const c = (f) => results.filter(f).length;
console.error('\n=== shape x outcome ===');
console.error('shape       n  exact strict loose OOM ERR');
for (const s of [...new Set(PAIRS.map((p) => p[4]))]) {
  const rows = results.filter((r) => r.shape === s);
  const k = (f) => String(rows.filter(f).length).padStart(s === 'pure' ? 5 : 5);
  console.error(`${s.padEnd(10)} ${String(rows.length).padStart(2)}  ${k((r) => r.verdict === 'exact')} ${String(rows.filter((r) => r.verdict === 'stricter').length).padStart(5)} ${String(rows.filter((r) => r.verdict === 'looser').length).padStart(5)} ${String(rows.filter((r) => r.status === 'OOM').length).padStart(3)} ${String(rows.filter((r) => r.status === 'ERROR').length).padStart(3)}`);
}
console.error(`\nanalyzable ${c((r) => r.status === 'OK')}/${PAIRS.length} | exact ${c((r) => r.verdict === 'exact')} | stricter ${c((r) => r.verdict === 'stricter')} | looser ${c((r) => r.verdict === 'looser')} | OOM ${c((r) => r.status === 'OOM')} | ERROR ${c((r) => r.status === 'ERROR')}`);

// Graded-confidence view: of the rows stricter than the published bump, how many
// the `--strict` gate still fires on (a proven major) vs. demotes to review-only
// (heuristic). The latter are the false positives graded confidence isolates from
// the gate; the former are real breaks the author under-bumped.
const stricter = results.filter((r) => r.verdict === 'stricter');
console.error(
  `\n--strict gate: fires on ${stricter.filter((r) => r.gates).length}/${stricter.length} stricter-than-published rows ` +
    `(${stricter.filter((r) => !r.gates).length} demoted to review-only). ` +
    `exact rows that still gate (proven major = real break, author under-bumped): ${results.filter((r) => r.verdict === 'exact' && r.gates).length}.`,
);
