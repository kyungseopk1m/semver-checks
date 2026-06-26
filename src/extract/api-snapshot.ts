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
  // the interface's full shape is larger than its own members — consumed when
  // deciding whether a type-alias <-> interface conversion is truly shape-equal.
  // Optional for backward compatibility with snapshots produced before 0.6.1.
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
  methods: Array<{ name: string; signatures: ApiFunctionSignature[]; isStatic: boolean }>;
  // `writeType` is the write (setter) type of a get/set accessor pair when it
  // differs from the read (getter) type — a `set`-only narrowing is breaking on
  // the write side even though the read type is unchanged. Absent for plain
  // fields and for accessors whose get/set types match.
  properties: Array<{ name: string; type: SerializedType; writeType?: SerializedType; isOptional: boolean; isReadonly: boolean; isStatic: boolean }>;
  typeParameters: ApiTypeParameter[];
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
