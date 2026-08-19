// Scores the declaration gate: not "what bump is this", which run.mjs measures,
// but "does the bump this release declared hold up".
//
// Every pair in the corpus is a real published release, so the bump its author
// declared is sitting in the two version strings. The oracle is the same one
// run.mjs uses: a consumer program that stopped compiling against the new
// version. A release that broke a consumer while declaring anything short of a
// major understated itself, and that is what this gate is supposed to fire on.
//
// Two verdicts, and only one of them has an oracle here. A `mismatch` says a
// proven break went undeclared, and a consumer that stopped compiling is exactly
// that claim, so it scores. A `review` says the declaration sits under what the
// analysis argues for, on evidence that is either an addition or a major it
// could not prove. Neither of those stops a consumer compiling, so the break
// oracle is silent on them by construction. Those rows are counted and listed
// for audit, never folded into a precision number they cannot support.
//
// What is live and what is cached: the declaration is read through the built
// detectDeclaredBump, and the verdict through the built judgeDeclaration, so
// both run for real on every row. The per-pair analysis (majorProven, minor) is
// replayed out of a run.mjs result file rather than recomputed, because it is
// the same 75 npm resolutions run.mjs already paid for. Re-run run.mjs whenever
// the classifier changes; this script only re-runs when the verdict changes.
//
//   node scripts/gate/run.mjs --out scripts/gate/gate-after.json
//   node scripts/gate/phase-c.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDeclaration } from '../../dist/mjs/declared.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IN = process.argv[2] ?? path.join(HERE, 'gate-after.json');
const OUT = process.argv[3] ?? path.join(HERE, 'phase-c-results.json');

// The truth side parses versions on its own rather than importing the tool's
// parser. Sharing it would let one bug agree with itself and score as correct.
function fields(version) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// Did the version number itself announce a break? A caret range is what decides
// that: `^1.2.3` refuses a new major, and `^0.5.0` refuses a new minor, so under
// 0.x the minor field is where a break is announced. This is a fact about npm
// ranges, not about anything the tool computed.
function announcedBreak(oldVersion, newVersion) {
  const a = fields(oldVersion);
  const b = fields(newVersion);
  if (!a || !b) return false;
  if (a[0] !== b[0]) return true;
  if (a[0] !== 0) return false;
  if (a[1] !== b[1]) return true;
  // `^0.0.5` matches nothing else at all, so at 0.0.x even the patch field
  // announces a break.
  return a[1] === 0 && a[2] !== b[2];
}

// Runs the real declaration path against a repository that has no changesets,
// so the package.json reading and the 0.x handling are both in the measurement
// rather than reimplemented beside it.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'semver-checks-phase-c-'));
let seq = 0;
function declarationFor(pkg, old, nw, summary) {
  const pair = path.join(scratch, String(seq++));
  const oldDir = path.join(pair, 'old');
  const newDir = path.join(pair, 'new');
  fs.mkdirSync(oldDir, { recursive: true });
  fs.mkdirSync(newDir, { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'package.json'), JSON.stringify({ name: pkg, version: old }));
  fs.writeFileSync(path.join(newDir, 'package.json'), JSON.stringify({ name: pkg, version: nw }));
  return resolveDeclaration(oldDir, newDir, 'auto', summary);
}

const { summary: gateSummary, rows } = JSON.parse(fs.readFileSync(IN, 'utf8'));

const scored = [];
for (const r of rows) {
  if (r.oracle === 'inconclusive' || r.tool.outcome !== 'ok') {
    scored.push({ ...r, skipped: r.oracle === 'inconclusive' ? 'inconclusive' : r.tool.outcome });
    continue;
  }
  if (r.tool.minor === undefined) {
    throw new Error(
      `${IN} has no minor count on ${r.pkg} ${r.old}->${r.nw}. Re-run run.mjs: the declaration gate needs it to tell a required minor from a required patch.`,
    );
  }

  const d = declarationFor(r.pkg, r.old, r.nw, {
    major: r.tool.major,
    minor: r.tool.minor,
    patch: 0,
    majorProven: r.tool.majorProven,
    majorReview: r.tool.majorReview,
  });
  if (!d) throw new Error(`could not read a declared bump for ${r.pkg} ${r.old}->${r.nw}`);

  // The release broke a consumer and its version number did not announce it.
  // That is an understated bump, and it is the only thing this gate is allowed
  // to count as a truth.
  const understated = r.oracle === 'TRUE' && !announcedBreak(r.old, r.nw);

  scored.push({
    pkg: r.pkg,
    old: r.old,
    nw: r.nw,
    oracle: r.oracle,
    declared: d.declared,
    required: d.required,
    suggested: d.suggested,
    verdict: d.verdict,
    minor: r.tool.minor,
    majorReview: r.tool.majorReview,
    understated,
    provenKinds: r.tool.provenKinds,
  });
}

const usable = scored.filter((r) => !r.skipped);
const truths = usable.filter((r) => r.understated);
const fired = usable.filter((r) => r.verdict === 'mismatch');
const tp = fired.filter((r) => r.understated);
const missed = truths.filter((r) => r.verdict !== 'mismatch');
const fp = fired.filter((r) => !r.understated);

// Reported, never gated, and not scoreable against a break oracle.
const review = usable.filter((r) => r.verdict === 'review');

// A break the version number already announced, which under 0.x is a moved
// minor field. The gate stays quiet on these on purpose: the release declared
// the break, so there is no mismatch to report, and counting them would make
// this number measure the accuracy gate over again.
const declaredBreaks = usable.filter((r) => r.oracle === 'TRUE' && !r.understated);

const summary = {
  source: path.relative(process.cwd(), IN),
  pairs: usable.length,
  skipped: scored.length - usable.length,
  breaks: usable.filter((r) => r.oracle === 'TRUE').length,
  understated: truths.length,
  declaredBreaks: declaredBreaks.length,
  fired: fired.length,
  truePositives: tp.length,
  falsePositives: fp.length,
  missed: missed.length,
  precision: fired.length ? tp.length / fired.length : null,
  recall: truths.length ? tp.length / truths.length : null,
  reviewed: review.length,
};

const pct = (v) => (v === null ? '  n/a' : `${(v * 100).toFixed(1)}%`);

console.log(`\ndeclaration gate over ${summary.source}`);
console.log(`pairs ${summary.pairs}  skipped ${summary.skipped}  real breaks ${summary.breaks}`);
console.log(`  of those breaks: ${summary.understated} went undeclared, ${summary.declaredBreaks} were declared by the version numbers`);
console.log(
  `\nmismatch (gates, exit 1)   fired ${summary.fired}  TP ${summary.truePositives}  FP ${summary.falsePositives}  missed ${summary.missed}  precision ${pct(summary.precision)}  recall ${pct(summary.recall)}`,
);
console.log(
  `review   (reported, exit 0)  fired ${summary.reviewed}  (not scored: neither an addition nor an unproven break stops a consumer compiling)`,
);

if (fp.length) {
  console.log('\nmismatch false positives (gate called a proven break, tsc kept compiling):');
  for (const r of fp) console.log(`  ${r.pkg} ${r.old}->${r.nw}  declared ${r.declared}, required ${r.required}`);
}
if (missed.length) {
  console.log('\nmissed (release broke a consumer without declaring it, gate stayed quiet):');
  for (const r of missed) console.log(`  ${r.pkg} ${r.old}->${r.nw}  declared ${r.declared}, required ${r.required}`);
}
if (review.length) {
  console.log('\nreview notes (the declaration sits under what the analysis argues for), audit these by hand:');
  for (const r of review) console.log(`  ${r.pkg} ${r.old}->${r.nw}  declared ${r.declared}, argues for ${r.suggested} (${r.minor} addition(s), ${r.majorReview} unproven break(s))`);
}

const declaredBreakRows = declaredBreaks.filter((r) => r.verdict !== 'mismatch');
if (declaredBreakRows.length) {
  console.log('\nbreaks the version numbers already announced (correctly not reported):');
  for (const r of declaredBreakRows) console.log(`  ${r.pkg} ${r.old}->${r.nw}  declared ${r.declared}`);
}

fs.rmSync(scratch, { recursive: true, force: true });
fs.writeFileSync(OUT, JSON.stringify({ summary, gateSummary, rows: scored }, null, 2));
console.log(`\nwrote ${path.relative(process.cwd(), OUT)}`);
