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
}

export interface ApiTypeAliasSymbol {
  kind: 'type-alias';
  name: string;
  type: SerializedType;
  typeParameters: ApiTypeParameter[];
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
