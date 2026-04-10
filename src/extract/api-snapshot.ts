import type { SymbolKind } from '../types.js';

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
  isOptional: boolean;
  isReadonly: boolean;
}

export interface ApiInterfaceSymbol {
  kind: 'interface';
  name: string;
  properties: ApiInterfaceProperty[];
  typeParameters: ApiTypeParameter[];
}

export interface ApiTypeAliasSymbol {
  kind: 'type-alias';
  name: string;
  type: SerializedType;
  typeParameters: ApiTypeParameter[];
}

export interface ApiEnumSymbol {
  kind: 'enum';
  name: string;
  members: string[];
}

export interface ApiClassSymbol {
  kind: 'class';
  name: string;
  constructorSignatures: ApiFunctionSignature[];
  methods: Array<{ name: string; signatures: ApiFunctionSignature[]; isStatic: boolean }>;
  properties: Array<{ name: string; type: SerializedType; isOptional: boolean; isReadonly: boolean; isStatic: boolean }>;
  typeParameters: ApiTypeParameter[];
}

export interface ApiVariableSymbol {
  kind: 'variable';
  name: string;
  type: SerializedType;
}

export type ApiSymbol =
  | ApiFunctionSymbol
  | ApiInterfaceSymbol
  | ApiTypeAliasSymbol
  | ApiEnumSymbol
  | ApiClassSymbol
  | ApiVariableSymbol;

export interface ApiSnapshot {
  symbols: Record<string, ApiSymbol>;
}
