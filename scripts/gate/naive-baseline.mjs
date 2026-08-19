// A deliberately stupid semver baseline, kept as the control group for the
// accuracy gate: exported-name set + required-parameter counts, parsed straight
// off the shipped `.d.ts` files. No type resolution, no assignability, no
// variance, no confidence grading.
//
// It exists to answer one question about the ~4,700 lines of type analysis in
// `src/`: does that analysis buy anything this does not already get? If the
// gate corpus cannot show the tool beating this, the analysis is not earning
// its keep.
//
// Usage (standalone, prints one line per pair and writes JSON):
//   node scripts/gate/naive-baseline.mjs hono@4.12.18..4.12.19 commander
//     "pkg@old..new" - that single pair
//     "pkg"          - the last 20 stable versions, as adjacent pairs
//   OUT=path.json    - where to write the results (default naive-baseline.json)
//
// Also imported by `run.mjs`, which calls `surface()`/`verdict()` directly.

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ts = createRequire(import.meta.url)('typescript');
const CACHE = path.join(os.tmpdir(), 'semver-checks-gate', 'pkgcache');

// npm pack + untar into a shared cache. Returns the package root, or null when
// the version does not exist / the registry call fails.
export function fetchPkg(pkg, ver) {
  const dir = path.join(CACHE, `${pkg.replace(/[@/]/g, '_')}@${ver}`);
  const pd = path.join(dir, 'package');
  if (fs.existsSync(pd)) return pd;
  fs.mkdirSync(dir, { recursive: true });
  try {
    execFileSync('npm', ['pack', `${pkg}@${ver}`, '--silent'], { cwd: dir, stdio: 'ignore' });
  } catch {
    return null;
  }
  const tgz = fs.readdirSync(dir).find((f) => f.endsWith('.tgz'));
  if (!tgz) return null;
  execFileSync('tar', ['-xzf', tgz], { cwd: dir });
  return fs.existsSync(pd) ? pd : null;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') walk(p, out);
    } else if (/\.d\.[cm]?ts$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

// -> { names: Set<string>, req: Map<string, number> }
// `req` is the smallest required-parameter count seen for that name, so a
// package that declares overloads keeps its most permissive arity.
export function surface(root) {
  const names = new Set();
  const req = new Map();
  const bump = (n, c) => req.set(n, Math.min(req.get(n) ?? Infinity, c));
  const count = (ps) => ps.filter((p) => !p.questionToken && !p.dotDotDotToken && !p.initializer).length;

  for (const file of walk(root)) {
    let sf;
    try {
      sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    } catch {
      continue;
    }
    const exported = (n) => !!(ts.getCombinedModifierFlags(n) & ts.ModifierFlags.Export);
    ts.forEachChild(sf, function visit(n) {
      if (ts.isModuleDeclaration(n) && n.body) return ts.forEachChild(n.body, visit);
      if (ts.isExportDeclaration(n) && n.exportClause && ts.isNamedExports(n.exportClause))
        return n.exportClause.elements.forEach((s) => names.add(s.name.text));
      if (ts.isVariableStatement(n) && exported(n))
        return n.declarationList.declarations.forEach((d) => ts.isIdentifier(d.name) && names.add(d.name.text));
      if (!n.name || !ts.isIdentifier(n.name) || !exported(n)) return;
      const nm = n.name.text;
      names.add(nm);
      if (ts.isFunctionDeclaration(n)) bump(nm, count(n.parameters));
      if (ts.isClassDeclaration(n))
        for (const m of n.members) {
          if (m.name && ts.isIdentifier(m.name)) names.add(`${nm}.${m.name.text}`);
          if (ts.isMethodDeclaration(m) && m.name && ts.isIdentifier(m.name)) bump(`${nm}.${m.name.text}`, count(m.parameters));
          if (ts.isConstructorDeclaration(m)) bump(`${nm}.constructor`, count(m.parameters));
        }
      if (ts.isInterfaceDeclaration(n))
        for (const m of n.members) {
          if (m.name && ts.isIdentifier(m.name)) names.add(`${nm}.${m.name.text}`);
          if (ts.isMethodSignature(m) && m.name && ts.isIdentifier(m.name)) bump(`${nm}.${m.name.text}`, count(m.parameters));
        }
    });
  }
  return { names, req };
}

// A name that disappeared, or a call that now demands more arguments, is the
// whole model. Everything else is called safe.
export function verdict(a, b) {
  const removed = [...a.names].filter((n) => !b.names.has(n));
  const arity = [...a.req]
    .filter(([n, c]) => b.req.has(n) && b.req.get(n) > c)
    .map(([n, c]) => `${n} ${c}->${b.req.get(n)}`);
  return { major: removed.length > 0 || arity.length > 0, removed, arity };
}

// Compare one pair by npm spec. Returns null when either side cannot be fetched.
export function comparePair(pkg, oldVer, newVer) {
  const oldRoot = fetchPkg(pkg, oldVer);
  const newRoot = fetchPkg(pkg, newVer);
  if (!oldRoot || !newRoot) return null;
  return verdict(surface(oldRoot), surface(newRoot));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const out = [];
  for (const spec of process.argv.slice(2)) {
    const explicit = spec.match(/^(.+)@([^@]+)\.\.([^@]+)$/);
    const pkg = explicit ? explicit[1] : spec;
    const pairs = explicit
      ? [[explicit[2], explicit[3]]]
      : (() => {
          const versions = JSON.parse(execFileSync('npm', ['view', pkg, 'versions', '--json'], { encoding: 'utf8' }))
            .filter((v) => !/-/.test(v))
            .slice(-20);
          return versions.slice(0, -1).map((v, i) => [v, versions[i + 1]]);
        })();
    for (const [ov, nv] of pairs) {
      const v = comparePair(pkg, ov, nv);
      if (!v) {
        console.error(`${pkg} ${ov}->${nv} FETCH-FAIL`);
        continue;
      }
      out.push({ pkg, ov, nv, ...v });
      console.error(`${pkg} ${ov}->${nv}  ${v.major ? 'MAJOR' : 'ok   '}  removed=${v.removed.length} arity=${v.arity.length}`);
    }
  }
  fs.writeFileSync(process.env.OUT || 'naive-baseline.json', JSON.stringify(out, null, 1));
  console.error(`\npairs=${out.length}  fired=${out.filter((r) => r.major).length}`);
}
