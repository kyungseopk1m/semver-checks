export interface SerializedType {
  text: string;
}

export interface ApiParameter {
  name: string;
  type: SerializedType;
  isOptional: boolean;
  isRest: boolean;
}

export interface ApiTypeParameter {
  name: string;
  constraint?: SerializedType;
  hasDefault: boolean;
  // Serialized text of the default type argument, when one is declared
  // (`<T = string>`). Changing or removing a default is breaking for consumers
  // that rely on the default, so the text must be captured, not just `hasDefault`.
  default?: SerializedType;
}

export interface ApiFunctionSignature {
  parameters: ApiParameter[];
  returnType: SerializedType;
  typeParameters: ApiTypeParameter[];
}

export interface ApiFunctionSymbol {
  kind: 'function';
  name: string;
  signatures: ApiFunctionSignature[];
}

export interface ApiInterfaceProperty {
  name: string;
  type: SerializedType;
  // Write (setter) type of a get/set accessor pair when it differs from the
  // read (getter) type; absent for plain properties and matched accessors.
  writeType?: SerializedType;
  isOptional: boolean;
  isReadonly: boolean;
}

export interface ApiInterfaceMethod {
  name: string;
  signatures: ApiFunctionSignature[];
  isOptional: boolean;
}

export interface ApiIndexSignature {
  // The key type as written (`string`, `number`, or `symbol`).
  keyType: string;
  valueType: SerializedType;
  isReadonly: boolean;
}

export interface ApiInterfaceSymbol {
  kind: 'interface';
  name: string;
  properties: ApiInterfaceProperty[];
  methods: ApiInterfaceMethod[];
  typeParameters: ApiTypeParameter[];
  // Call signatures (`(x: string): string`), construct signatures
  // (`new (x: string): Foo`), and index signatures (`[k: string]: V`) are part
  // of the public interface shape, so a change to any of them is breaking.
  // Optional for backward compatibility with snapshots produced before 0.6.0.
  callSignatures?: ApiFunctionSignature[];
  constructSignatures?: ApiFunctionSignature[];
  indexSignatures?: ApiIndexSignature[];
  // `extends` heritage clause text(s), e.g. `["Base", "Other<T>"]`. Inherited
  // members are not flattened into `properties`/`methods`, so this records that
  // the interface's full shape is larger than its own members. Two consumers:
  // deciding whether a type-alias <-> interface conversion is truly shape-equal,
  // and diffing the clause itself (a dropped or swapped base moves no own-member).
  // Checker-resolved text, like every other type text here, so it is already
  // canonical; `heritageComparisonKey` in the classifier adds only what is specific
  // to a list of bases (set semantics and the container's alpha-rename).
  // Optional for backward compatibility with snapshots produced before 0.6.1;
  // absent is "unknown", not "no bases", and the diff skips the comparison.
  heritage?: string[];
}

// The member set of an object-literal type (`{ a: string; f(): void }`), shared
// by interfaces and by object-literal type aliases. Capturing it lets a
// `type X = { ... }` alias be diffed member-by-member like an interface instead
// of comparing the whole serialized text, so an added required property is a
// proven `required-property-added` rather than an opaque `type-alias-changed`.
export interface ApiObjectMembers {
  properties: ApiInterfaceProperty[];
  methods: ApiInterfaceMethod[];
  callSignatures: ApiFunctionSignature[];
  constructSignatures: ApiFunctionSignature[];
  indexSignatures: ApiIndexSignature[];
}

export interface ApiTypeAliasSymbol {
  kind: 'type-alias';
  name: string;
  type: SerializedType;
  typeParameters: ApiTypeParameter[];
  // Present only when the alias is a bare object-literal type (`type X = { ... }`).
  // Absent for non-object aliases (union / conditional / mapped / intersection /
  // function type) and for snapshots produced before 0.7.0. When both the old and
  // new alias carry it, the classifier decomposes the alias into its members.
  objectMembers?: ApiObjectMembers;
}

export interface ApiEnumMember {
  name: string;
  value?: string | number;
}

export interface ApiEnumSymbol {
  kind: 'enum';
  name: string;
  members: ApiEnumMember[];
}

export interface ApiClassSymbol {
  kind: 'class';
  name: string;
  constructorSignatures: ApiFunctionSignature[];
  // Absent for snapshots produced before this field existed; the classifier
  // treats a missing value as 'public' (an implicit constructor, or one with
  // no explicit access modifier, is callable from outside the class).
  constructorVisibility?: 'public' | 'protected' | 'private';
  // True only when the constructor genuinely could not be determined: no
  // explicit constructor on this class AND it has a heritage clause
  // (`extends`), in any form. `constructorSignatures`/`constructorVisibility`
  // are still populated with a placeholder in this case, but the classifier
  // must not compare them — see classifyClassChanges. Absent (not `false`)
  // both for a snapshot predating this field and for a class whose
  // constructor WAS determined, so an old snapshot compares exactly as it did
  // before this field existed rather than being newly treated as unknown.
  constructorUnknown?: boolean;
  methods: Array<{ name: string; signatures: ApiFunctionSignature[]; isStatic: boolean }>;
  // `writeType` is the write (setter) type of a get/set accessor pair when it
  // differs from the read (getter) type — a `set`-only narrowing is breaking on
  // the write side even though the read type is unchanged. Absent for plain
  // fields and for accessors whose get/set types match.
  properties: Array<{ name: string; type: SerializedType; writeType?: SerializedType; isOptional: boolean; isReadonly: boolean; isStatic: boolean }>;
  typeParameters: ApiTypeParameter[];
  // `extends Base` heritage, recorded for the same reason as an interface's (see
  // `ApiInterfaceSymbol.heritage`): inherited members are not flattened into
  // `properties`/`methods`, so a base is the only record that the class's shape is
  // larger than its own members. A class carries at most one, kept as a list so the
  // classifier's base resolution reads a class and an interface the same way.
  // Checker-resolved text like the interface field, so `extends Base<string>` is the
  // instance type; a base with no declaration to resolve (a mixin call) serializes to
  // `any` and simply resolves to nothing, which is what it did before this field.
  // Optional for backward compatibility with snapshots produced before it existed;
  // absent is "unknown", not "no bases".
  heritage?: string[];
  // True when the class declares a private or protected instance member (`#x`
  // included). TypeScript compares such a class nominally: an object literal with
  // every public member still cannot be assigned where the class type is expected,
  // so no consumer can implement it by hand. The members themselves are not public
  // surface and stay out of this snapshot, which is why their existence is recorded
  // as a flag. Static members do not count (a structural implementation is checked
  // against the instance type), nor does the constructor's own visibility, which
  // stops `new` rather than assignment. Absent both for a snapshot predating the
  // field and for a class that has no such member.
  hasNonPublicMembers?: boolean;
  // True when the class's instance type carries a string or number index signature.
  // `getMembers()` does not surface a class index signature at all, so this is read
  // off the checker; only its existence is recorded, because the one question asked
  // of it is whether dropping this class as a base takes an index signature with it
  // (an interface extending it inherits one, and members cannot be checked by name).
  // Absent both for a snapshot predating the field and for a class that has none,
  // and the classifier tells those apart by comparing against `false`.
  hasIndexSignature?: boolean;
}

export interface ApiVariableSymbol {
  kind: 'variable';
  name: string;
  type: SerializedType;
}

export interface ApiNamespaceSymbol {
  kind: 'namespace';
  name: string;
  symbols: Record<string, ApiSymbol>;
}

export type ApiSymbol =
  | ApiFunctionSymbol
  | ApiInterfaceSymbol
  | ApiTypeAliasSymbol
  | ApiEnumSymbol
  | ApiClassSymbol
  | ApiVariableSymbol
  | ApiNamespaceSymbol;

export interface ApiSnapshot {
  // Keyed by export subpath: the root entry is '.', subpaths follow the
  // package.json "exports" convention (e.g. './utils'). A single-entry package
  // is represented as `{ '.': { ...symbols } }`.
  entrypoints: Record<string, Record<string, ApiSymbol>>;
}

// A symbol that carries no shape: an `any`-typed value or alias, or a namespace
// whose members are all themselves opaque (an empty one included — it says
// nothing about the surface either).
function isOpaque(symbol: ApiSymbol): boolean {
  switch (symbol.kind) {
    case 'variable':
    case 'type-alias':
      return symbol.type.text === 'any';
    case 'namespace':
      return Object.values(symbol.symbols).every(isOpaque);
    default:
      return false;
  }
}

// Why a snapshot cannot support a comparison, or null when it can.
//
// An empty snapshot is the dangerous case, because it diffs against another
// empty snapshot as `{"changes":[],"recommended":"patch"}` and exits 0 — byte
// for byte the output of "analyzed, nothing broke". The extraction failed and
// the gate says green. Reporting it as a hard failure is the only way `--strict`
// can mean what it claims.
export function describeUnusableSnapshot(snapshot: ApiSnapshot): string | null {
  const symbols = Object.values(snapshot.entrypoints).flatMap((syms) => Object.values(syms));
  if (symbols.length === 0) return 'no API symbols could be extracted';
  if (symbols.every(isOpaque)) return `all ${symbols.length} extracted symbol(s) are opaque (\`any\`)`;
  return null;
}
