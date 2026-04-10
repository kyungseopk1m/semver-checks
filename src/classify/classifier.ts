import type { ApiSnapshot, ApiSymbol, ApiFunctionSymbol, ApiInterfaceSymbol, ApiEnumSymbol, ApiClassSymbol, ApiTypeAliasSymbol, ApiVariableSymbol, ApiTypeParameter } from '../extract/api-snapshot.js';
import type { ApiChange } from '../types.js';

export function classifyChanges(oldSnap: ApiSnapshot, newSnap: ApiSnapshot): ApiChange[] {
  const changes: ApiChange[] = [];

  // Removed exports
  for (const name of Object.keys(oldSnap.symbols)) {
    if (!newSnap.symbols[name]) {
      changes.push({
        kind: 'export-removed',
        severity: 'major',
        symbolPath: name,
        message: `Export '${name}' was removed`,
        oldValue: oldSnap.symbols[name].kind,
      });
    }
  }

  // Added exports
  for (const name of Object.keys(newSnap.symbols)) {
    if (!oldSnap.symbols[name]) {
      changes.push({
        kind: 'export-added',
        severity: 'minor',
        symbolPath: name,
        message: `Export '${name}' was added`,
        newValue: newSnap.symbols[name].kind,
      });
    }
  }

  // Changed exports
  for (const name of Object.keys(oldSnap.symbols)) {
    const oldSym = oldSnap.symbols[name];
    const newSym = newSnap.symbols[name];
    if (!newSym) continue;

    const symbolChanges = classifySymbolChanges(name, oldSym, newSym);
    changes.push(...symbolChanges);
  }

  return changes;
}

function classifySymbolChanges(name: string, oldSym: ApiSymbol, newSym: ApiSymbol): ApiChange[] {
  if (oldSym.kind !== newSym.kind) {
    return [{
      kind: 'export-removed',
      severity: 'major',
      symbolPath: name,
      message: `'${name}' changed kind from '${oldSym.kind}' to '${newSym.kind}'`,
      oldValue: oldSym.kind,
      newValue: newSym.kind,
    }];
  }

  switch (oldSym.kind) {
    case 'function':
      return classifyFunctionChanges(name, oldSym, newSym as ApiFunctionSymbol);
    case 'interface':
      return classifyInterfaceChanges(name, oldSym, newSym as ApiInterfaceSymbol);
    case 'enum':
      return classifyEnumChanges(name, oldSym, newSym as ApiEnumSymbol);
    case 'class':
      return classifyClassChanges(name, oldSym, newSym as ApiClassSymbol);
    case 'type-alias':
      return classifyTypeAliasChanges(name, oldSym as ApiTypeAliasSymbol, newSym as ApiTypeAliasSymbol);
    case 'variable':
      return classifyVariableChanges(name, oldSym as ApiVariableSymbol, newSym as ApiVariableSymbol);
    default:
      return [];
  }
}

function classifyTypeParamChanges(symbolPath: string, oldTPs: ApiTypeParameter[], newTPs: ApiTypeParameter[]): ApiChange[] {
  const changes: ApiChange[] = [];
  for (let i = oldTPs.length; i < newTPs.length; i++) {
    const tp = newTPs[i];
    if (!tp.hasDefault) {
      changes.push({
        kind: 'generic-param-required',
        severity: 'major',
        symbolPath,
        message: `Required generic parameter '${tp.name}' was added to '${symbolPath}'`,
        newValue: tp.name,
      });
    } else {
      changes.push({
        kind: 'generic-param-with-default',
        severity: 'minor',
        symbolPath,
        message: `Generic parameter '${tp.name}' with default was added to '${symbolPath}'`,
        newValue: tp.name,
      });
    }
  }
  return changes;
}

function classifyFunctionChanges(name: string, oldFn: ApiFunctionSymbol, newFn: ApiFunctionSymbol): ApiChange[] {
  const changes: ApiChange[] = [];

  // Overload added
  if (newFn.signatures.length > oldFn.signatures.length) {
    changes.push({
      kind: 'overload-added',
      severity: 'minor',
      symbolPath: name,
      message: `Overload was added to '${name}'`,
      oldValue: String(oldFn.signatures.length),
      newValue: String(newFn.signatures.length),
    });
  }

  const oldSig = oldFn.signatures[0];
  const newSig = newFn.signatures[0];
  if (!oldSig || !newSig) return changes;

  const oldParams = oldSig.parameters;
  const newParams = newSig.parameters;

  // Added parameters
  for (let i = oldParams.length; i < newParams.length; i++) {
    const p = newParams[i];
    if (!p.isOptional && !p.isRest) {
      changes.push({
        kind: 'required-param-added',
        severity: 'major',
        symbolPath: name,
        message: `Required parameter '${p.name}' was added to '${name}'`,
        newValue: `${p.name}: ${p.type.text}`,
      });
    } else {
      changes.push({
        kind: 'optional-param-added',
        severity: 'minor',
        symbolPath: name,
        message: `Optional parameter '${p.name}' was added to '${name}'`,
        newValue: `${p.name}?: ${p.type.text}`,
      });
    }
  }

  // Removed parameters (breaking)
  for (let i = newParams.length; i < oldParams.length; i++) {
    changes.push({
      kind: 'param-removed',
      severity: 'major',
      symbolPath: name,
      message: `Parameter '${oldParams[i].name}' was removed from '${name}'`,
      oldValue: `${oldParams[i].name}: ${oldParams[i].type.text}`,
    });
  }

  // Existing parameter type/optionality changes
  const minLen = Math.min(oldParams.length, newParams.length);
  for (let i = 0; i < minLen; i++) {
    const oldP = oldParams[i];
    const newP = newParams[i];
    if (oldP.type.text !== newP.type.text) {
      changes.push({
        kind: 'param-type-changed',
        severity: 'major',
        symbolPath: `${name}.${oldP.name}`,
        message: `Parameter '${oldP.name}' type changed in '${name}'`,
        oldValue: oldP.type.text,
        newValue: newP.type.text,
      });
    }
    if (!oldP.isOptional && newP.isOptional) {
      changes.push({
        kind: 'optional-param-added',
        severity: 'minor',
        symbolPath: `${name}.${oldP.name}`,
        message: `Parameter '${oldP.name}' became optional in '${name}'`,
      });
    }
    if (oldP.isOptional && !newP.isOptional) {
      changes.push({
        kind: 'required-param-added',
        severity: 'major',
        symbolPath: `${name}.${oldP.name}`,
        message: `Parameter '${oldP.name}' became required in '${name}'`,
      });
    }
  }

  // Return type changes
  if (oldSig.returnType.text !== newSig.returnType.text) {
    changes.push({
      kind: 'return-type-changed',
      severity: 'major',
      symbolPath: name,
      message: `Return type of '${name}' changed`,
      oldValue: oldSig.returnType.text,
      newValue: newSig.returnType.text,
    });
  }

  // Generic param changes
  changes.push(...classifyTypeParamChanges(name, oldSig.typeParameters, newSig.typeParameters));

  return changes;
}

function classifyInterfaceChanges(name: string, oldIf: ApiInterfaceSymbol, newIf: ApiInterfaceSymbol): ApiChange[] {
  const changes: ApiChange[] = [];
  const oldProps = new Map(oldIf.properties.map((p) => [p.name, p]));
  const newProps = new Map(newIf.properties.map((p) => [p.name, p]));

  // Removed properties
  for (const [propName, prop] of oldProps) {
    if (!newProps.has(propName)) {
      changes.push({
        kind: 'property-removed',
        severity: 'major',
        symbolPath: `${name}.${propName}`,
        message: `Property '${propName}' was removed from interface '${name}'`,
        oldValue: prop.type.text,
      });
    }
  }

  // Added properties
  for (const [propName, prop] of newProps) {
    if (!oldProps.has(propName)) {
      if (!prop.isOptional) {
        changes.push({
          kind: 'required-property-added',
          severity: 'major',
          symbolPath: `${name}.${propName}`,
          message: `Required property '${propName}' was added to interface '${name}'`,
          newValue: prop.type.text,
        });
      } else {
        changes.push({
          kind: 'optional-property-added',
          severity: 'minor',
          symbolPath: `${name}.${propName}`,
          message: `Optional property '${propName}' was added to interface '${name}'`,
          newValue: prop.type.text,
        });
      }
    }
  }

  // Changed properties
  for (const [propName, oldProp] of oldProps) {
    const newProp = newProps.get(propName);
    if (!newProp) continue;
    if (oldProp.type.text !== newProp.type.text) {
      changes.push({
        kind: 'property-type-changed',
        severity: 'major',
        symbolPath: `${name}.${propName}`,
        message: `Property '${propName}' type changed in interface '${name}'`,
        oldValue: oldProp.type.text,
        newValue: newProp.type.text,
      });
    }
  }

  // Generic param changes
  changes.push(...classifyTypeParamChanges(name, oldIf.typeParameters, newIf.typeParameters));

  return changes;
}

function classifyEnumChanges(name: string, oldEnum: ApiEnumSymbol, newEnum: ApiEnumSymbol): ApiChange[] {
  const changes: ApiChange[] = [];
  const oldMembers = new Set(oldEnum.members);
  const newMembers = new Set(newEnum.members);

  for (const m of oldMembers) {
    if (!newMembers.has(m)) {
      changes.push({
        kind: 'enum-member-removed',
        severity: 'major',
        symbolPath: `${name}.${m}`,
        message: `Enum member '${m}' was removed from '${name}'`,
      });
    }
  }

  for (const m of newMembers) {
    if (!oldMembers.has(m)) {
      changes.push({
        kind: 'enum-member-added',
        severity: 'minor',
        symbolPath: `${name}.${m}`,
        message: `Enum member '${m}' was added to '${name}'`,
      });
    }
  }

  return changes;
}

function classifyClassChanges(name: string, oldCls: ApiClassSymbol, newCls: ApiClassSymbol): ApiChange[] {
  const changes: ApiChange[] = [];

  // Constructor changes
  const oldCtor = oldCls.constructorSignatures[0];
  const newCtor = newCls.constructorSignatures[0];
  if (oldCtor && newCtor) {
    const oldCtorParams = oldCtor.parameters.map((p) => `${p.name}: ${p.type.text}`).join(', ');
    const newCtorParams = newCtor.parameters.map((p) => `${p.name}: ${p.type.text}`).join(', ');
    if (oldCtorParams !== newCtorParams) {
      changes.push({
        kind: 'class-constructor-changed',
        severity: 'major',
        symbolPath: `${name}.constructor`,
        message: `Constructor of class '${name}' changed`,
        oldValue: oldCtorParams,
        newValue: newCtorParams,
      });
    }
  }

  // Methods
  const oldMethods = new Map(oldCls.methods.map((m) => [m.name, m]));
  const newMethods = new Map(newCls.methods.map((m) => [m.name, m]));

  for (const [methodName] of oldMethods) {
    if (!newMethods.has(methodName)) {
      changes.push({
        kind: 'class-method-removed',
        severity: 'major',
        symbolPath: `${name}.${methodName}`,
        message: `Method '${methodName}' was removed from class '${name}'`,
      });
    }
  }

  for (const [methodName] of newMethods) {
    if (!oldMethods.has(methodName)) {
      changes.push({
        kind: 'class-method-added',
        severity: 'minor',
        symbolPath: `${name}.${methodName}`,
        message: `Method '${methodName}' was added to class '${name}'`,
      });
    }
  }

  // Properties
  const oldProps = new Map(oldCls.properties.map((p) => [p.name, p]));
  const newProps = new Map(newCls.properties.map((p) => [p.name, p]));

  for (const [propName] of oldProps) {
    if (!newProps.has(propName)) {
      changes.push({
        kind: 'class-property-removed',
        severity: 'major',
        symbolPath: `${name}.${propName}`,
        message: `Property '${propName}' was removed from class '${name}'`,
      });
    }
  }

  for (const [propName] of newProps) {
    if (!oldProps.has(propName)) {
      changes.push({
        kind: 'class-property-added',
        severity: 'minor',
        symbolPath: `${name}.${propName}`,
        message: `Property '${propName}' was added to class '${name}'`,
      });
    }
  }

  // Generic param changes
  changes.push(...classifyTypeParamChanges(name, oldCls.typeParameters, newCls.typeParameters));

  return changes;
}

function classifyTypeAliasChanges(name: string, oldTA: ApiTypeAliasSymbol, newTA: ApiTypeAliasSymbol): ApiChange[] {
  const changes: ApiChange[] = [];

  if (oldTA.type.text !== newTA.type.text) {
    changes.push({
      kind: 'type-alias-changed',
      severity: 'major',
      symbolPath: name,
      message: `Type alias '${name}' changed`,
      oldValue: oldTA.type.text,
      newValue: newTA.type.text,
    });
  }

  changes.push(...classifyTypeParamChanges(name, oldTA.typeParameters, newTA.typeParameters));

  return changes;
}

function classifyVariableChanges(name: string, oldVar: ApiVariableSymbol, newVar: ApiVariableSymbol): ApiChange[] {
  if (oldVar.type.text !== newVar.type.text) {
    return [{
      kind: 'variable-type-changed',
      severity: 'major',
      symbolPath: name,
      message: `Variable '${name}' type changed`,
      oldValue: oldVar.type.text,
      newValue: newVar.type.text,
    }];
  }
  return [];
}
