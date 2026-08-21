import type {
  ApiFunctionSignature,
  ApiIndexSignature,
  ApiInterfaceMethod,
  ApiInterfaceProperty,
  ApiInterfaceSymbol,
  ApiSymbol,
  ApiTypeAliasSymbol,
  ApiTypeParameter,
} from '../extract/api-snapshot.js';
import { mentionsAny } from './literal-spans.js';

// Render a snapshot's exported symbols back into ambient declaration text, so the
// variance probe can resolve the names a package declares about itself.
//
// The probe synthesizes two type texts into one program and asks the compiler
// whether one is assignable to the other. Until now that program held nothing but
// the ES libs, so any text naming a package-local type (clsx's `ClassArray |
// ClassDictionary`, ts-pattern's `P.Pattern<T>`) failed to resolve and the probe
// reported undecidable — which the classifier reads as "review only". That is the
// dominant reason `--strict` stays silent on breaks it already noticed.
//
// Only interfaces, type aliases and namespaces are rendered. The omissions are
// deliberate, not unfinished:
//
//   - Enums and classes are *nominal*. The two sides are rendered into separate
//     namespaces, so `__sc_old.Color` and `__sc_new.Color` would be unrelated
//     types even when the enum never changed, and every text mentioning one would
//     probe as an unrelated change: a confident major on a package that did
//     nothing. Leaving the name unresolved keeps the old, safe bail.
//   - `unique symbol` brands are nominal for the same reason, so a rendered
//     symbol whose text mentions one is dropped.
//   - Variables and functions are values, not types. They cannot appear in a type
//     text except under `typeof`, which needs the value declaration anyway.
//   - A declaration mentioning `any` is not rendered either. `any` is assignable
//     in both directions, so a member typed `any` makes its whole containing type
//     bidirectionally assignable and `Sink` compares equivalent to
//     `Sink & { write(chunk: Uint8Array): void }`. `compareTypeText` already bails
//     when either *compared* text mentions `any`; installing a declaration that
//     mentions one routes around that guard, because neither compared text has to
//     say the word. Such a name is left to the opaque stand-in, which is not
//     assignable to anything it is not.
//
// Anything not rendered simply stays unresolved, which is exactly the behaviour
// the probe had before this file existed.

const OMITTED_KINDS = new Set(['enum', 'class', 'variable', 'function']);

// A member name the checker printed. Identifiers and numeric keys are emitted as
// written; a computed key (`[Symbol.iterator]`) is already bracketed; anything
// else (`'content-type'`, `foo-bar`) has to be quoted to parse.
function renderKey(name: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) return name;
  if (/^[0-9]+$/.test(name)) return name;
  if (name.startsWith('[')) return name;
  return JSON.stringify(name);
}

function renderTypeParams(tps: ApiTypeParameter[]): string {
  if (tps.length === 0) return '';
  const parts = tps.map((tp) => {
    const constraint = tp.constraint ? ` extends ${tp.constraint.text}` : '';
    const dflt = tp.default ? ` = ${tp.default.text}` : '';
    return `${tp.name}${constraint}${dflt}`;
  });
  return `<${parts.join(', ')}>`;
}

function renderParams(sig: ApiFunctionSignature): string {
  return sig.parameters
    .map((p) => {
      const rest = p.isRest ? '...' : '';
      const optional = !p.isRest && p.isOptional ? '?' : '';
      return `${rest}${p.name}${optional}: ${p.type.text}`;
    })
    .join(', ');
}

// `<T>(a: X): R` — the shape shared by function types, methods, call signatures
// and construct signatures.
function renderSignature(sig: ApiFunctionSignature): string {
  return `${renderTypeParams(sig.typeParameters)}(${renderParams(sig)}): ${sig.returnType.text}`;
}

// The write (setter) type of an accessor pair is dropped: an interface cannot
// declare `get`/`set` with different types, and the read type is the one a
// referencing type text sees.
function renderProperty(p: ApiInterfaceProperty): string {
  const readonly = p.isReadonly ? 'readonly ' : '';
  return `${readonly}${renderKey(p.name)}${p.isOptional ? '?' : ''}: ${p.type.text};`;
}

function renderMethod(m: ApiInterfaceMethod): string[] {
  return m.signatures.map((sig) => `${renderKey(m.name)}${m.isOptional ? '?' : ''}${renderSignature(sig)};`);
}

function renderIndexSignature(ix: ApiIndexSignature): string {
  return `${ix.isReadonly ? 'readonly ' : ''}[__sc_k: ${ix.keyType}]: ${ix.valueType.text};`;
}

function renderInterface(name: string, sym: ApiInterfaceSymbol): string {
  const body: string[] = [];
  for (const p of sym.properties) body.push(renderProperty(p));
  for (const m of sym.methods) body.push(...renderMethod(m));
  for (const sig of sym.callSignatures ?? []) body.push(`${renderSignature(sig)};`);
  for (const sig of sym.constructSignatures ?? []) body.push(`new ${renderSignature(sig)};`);
  for (const ix of sym.indexSignatures ?? []) body.push(renderIndexSignature(ix));
  const heritage = sym.heritage && sym.heritage.length > 0 ? ` extends ${sym.heritage.join(', ')}` : '';
  return `interface ${name}${renderTypeParams(sym.typeParameters)}${heritage} { ${body.join(' ')} }`;
}

function renderTypeAlias(name: string, sym: ApiTypeAliasSymbol): string {
  return `type ${name}${renderTypeParams(sym.typeParameters)} = ${sym.type.text};`;
}

export interface RenderedScope {
  /**
   * One rendered declaration per exported symbol, keyed by name. Each entry is a
   * single line, so a diagnostic reported against the rendered scope can be
   * mapped back to the symbol that produced it and dropped.
   */
  declarations: Map<string, string>;
  /**
   * Names this snapshot declares that were deliberately left out. They must not
   * be stood in for: a stand-in is an object type carrying a brand property, so
   * an interface extending an omitted class would inherit a member the class
   * never had, and the interface would compare as changed against a version of
   * itself that does not extend it. A declaration naming one of these is dropped
   * instead, which is the same bail the probe had before any of this existed.
   */
  omitted: Set<string>;
}

/**
 * Render a snapshot's exported symbols into ambient declaration text. A symbol
 * this renderer does not cover is absent, which leaves its name unresolved in
 * the probe — the conservative behaviour.
 */
export function renderScopeDeclarations(symbols: Record<string, ApiSymbol>): RenderedScope {
  const declarations = new Map<string, string>();
  const omitted = new Set<string>();
  for (const [name, sym] of Object.entries(symbols)) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) continue;
    if (OMITTED_KINDS.has(sym.kind)) {
      omitted.add(name);
      continue;
    }
    let text: string;
    if (sym.kind === 'interface') {
      text = renderInterface(name, sym);
    } else if (sym.kind === 'type-alias') {
      text = renderTypeAlias(name, sym);
    } else if (sym.kind === 'namespace') {
      const inner = renderScopeDeclarations(sym.symbols);
      if (inner.declarations.size === 0) {
        omitted.add(name);
        continue;
      }
      text = `namespace ${name} { ${[...inner.declarations.values()].join(' ')} }`;
    } else {
      omitted.add(name);
      continue;
    }
    // A nominal brand rendered twice is two distinct types; see the header.
    if (text.includes('unique symbol')) {
      omitted.add(name);
      continue;
    }
    // An `any` anywhere inside makes the whole declaration a yes-man. Not added
    // to `omitted`: unlike a class or an enum this name has no nominal identity
    // to protect, so an opaque stand-in is a better answer than dropping every
    // declaration that mentions it.
    if (mentionsAny(text)) continue;
    declarations.set(name, text);
  }
  return { declarations, omitted };
}
