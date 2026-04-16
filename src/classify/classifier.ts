import type { ApiSnapshot, ApiSymbol, ApiFunctionSymbol, ApiInterfaceSymbol, ApiEnumSymbol, ApiClassSymbol, ApiTypeAliasSymbol, ApiVariableSymbol, ApiTypeParameter, ApiFunctionSignature } from '../extract/api-snapshot.js';
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

  // Removed type parameters (breaking)
  for (let i = newTPs.length; i < oldTPs.length; i++) {
    changes.push({
      kind: 'generic-param-removed',
      severity: 'major',
      symbolPath,
      message: `Generic parameter '${oldTPs[i].name}' was removed from '${symbolPath}'`,
      oldValue: oldTPs[i].name,
    });
  }

  // Added type parameters
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
  // Compare constraints of existing type parameters
  const commonCount = Math.min(oldTPs.length, newTPs.length);
  for (let i = 0; i < commonCount; i++) {
    const oldConstraint = oldTPs[i].constraint?.text ?? null;
    const newConstraint = newTPs[i].constraint?.text ?? null;
    if (oldConstraint !== newConstraint) {
      changes.push({
        kind: 'generic-constraint-changed',
        severity: 'major',
        symbolPath,
        message: `Generic constraint on '${oldTPs[i].name}' changed in '${symbolPath}'`,
        oldValue: oldConstraint ?? '(none)',
        newValue: newConstraint ?? '(none)',
      });
    }
  }

  return changes;
}

function compareFunctionSignature(symbolPath: string, oldSig: ApiFunctionSignature, newSig: ApiFunctionSignature): ApiChange[] {
  const changes: ApiChange[] = [];
  const oldParams = oldSig.parameters;
  const newParams = newSig.parameters;

  for (let i = oldParams.length; i < newParams.length; i++) {
    const p = newParams[i];
    if (!p.isOptional && !p.isRest) {
      changes.push({
        kind: 'required-param-added',
        severity: 'major',
        symbolPath,
        message: `Required parameter '${p.name}' was added to '${symbolPath}'`,
        newValue: `${p.name}: ${p.type.text}`,
      });
    } else {
      changes.push({
        kind: 'optional-param-added',
        severity: 'minor',
        symbolPath,
        message: `Optional parameter '${p.name}' was added to '${symbolPath}'`,
        newValue: `${p.name}?: ${p.type.text}`,
      });
    }
  }

  for (let i = newParams.length; i < oldParams.length; i++) {
    changes.push({
      kind: 'param-removed',
      severity: 'major',
      symbolPath,
      message: `Parameter '${oldParams[i].name}' was removed from '${symbolPath}'`,
      oldValue: `${oldParams[i].name}: ${oldParams[i].type.text}`,
    });
  }

  const minLen = Math.min(oldParams.length, newParams.length);
  for (let i = 0; i < minLen; i++) {
    const oldP = oldParams[i];
    const newP = newParams[i];
    if (oldP.type.text !== newP.type.text) {
      changes.push({
        kind: 'param-type-changed',
        severity: 'major',
        symbolPath: `${symbolPath}.${oldP.name}`,
        message: `Parameter '${oldP.name}' type changed in '${symbolPath}'`,
        oldValue: oldP.type.text,
        newValue: newP.type.text,
      });
    }
    else if (oldP.isRest !== newP.isRest) {
      changes.push({
        kind: 'param-type-changed',
        severity: 'major',
        symbolPath: `${symbolPath}.${oldP.name}`,
        message: `Parameter '${oldP.name}' rest modifier changed in '${symbolPath}'`,
        oldValue: oldP.isRest ? `...${oldP.name}: ${oldP.type.text}` : `${oldP.name}: ${oldP.type.text}`,
        newValue: newP.isRest ? `...${newP.name}: ${newP.type.text}` : `${newP.name}: ${newP.type.text}`,
      });
    }
    // Rest params are represented as optional in extracted signatures.
    // Do not double-report rest changes as optionality changes.
    if (!oldP.isRest && !newP.isRest && !oldP.isOptional && newP.isOptional) {
      changes.push({
        kind: 'optional-param-added',
        severity: 'minor',
        symbolPath: `${symbolPath}.${oldP.name}`,
        message: `Parameter '${oldP.name}' became optional in '${symbolPath}'`,
      });
    }
    if (!oldP.isRest && !newP.isRest && oldP.isOptional && !newP.isOptional) {
      changes.push({
        kind: 'required-param-added',
        severity: 'major',
        symbolPath: `${symbolPath}.${oldP.name}`,
        message: `Parameter '${oldP.name}' became required in '${symbolPath}'`,
      });
    }
  }

  if (oldSig.returnType.text !== newSig.returnType.text) {
    changes.push({
      kind: 'return-type-changed',
      severity: 'major',
      symbolPath,
      message: `Return type of '${symbolPath}' changed`,
      oldValue: oldSig.returnType.text,
      newValue: newSig.returnType.text,
    });
  }

  return changes;
}

function classifyFunctionChanges(name: string, oldFn: ApiFunctionSymbol, newFn: ApiFunctionSymbol): ApiChange[] {
  const changes: ApiChange[] = [];

  // Overload removed (breaking)
  if (newFn.signatures.length < oldFn.signatures.length) {
    changes.push({
      kind: 'overload-removed',
      severity: 'major',
      symbolPath: name,
      message: `Overload was removed from '${name}'`,
      oldValue: String(oldFn.signatures.length),
      newValue: String(newFn.signatures.length),
    });
  }

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

  // Compare all matching signature pairs
  const pairCount = Math.min(oldFn.signatures.length, newFn.signatures.length);
  for (let i = 0; i < pairCount; i++) {
    const oldSig = oldFn.signatures[i];
    const newSig = newFn.signatures[i];
    changes.push(...compareFunctionSignature(name, oldSig, newSig));
    changes.push(...classifyTypeParamChanges(name, oldSig.typeParameters, newSig.typeParameters));
  }

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
    if (oldProp.isOptional && !newProp.isOptional) {
      changes.push({
        kind: 'interface-property-became-required',
        severity: 'major',
        symbolPath: `${name}.${propName}`,
        message: `Property '${propName}' became required in interface '${name}'`,
      });
    }
    if (!oldProp.isOptional && newProp.isOptional) {
      changes.push({
        kind: 'interface-property-became-optional',
        severity: 'minor',
        symbolPath: `${name}.${propName}`,
        message: `Property '${propName}' became optional in interface '${name}'`,
      });
    }
    if (!oldProp.isReadonly && newProp.isReadonly) {
      changes.push({
        kind: 'interface-property-became-readonly',
        severity: 'major',
        symbolPath: `${name}.${propName}`,
        message: `Property '${propName}' became readonly in interface '${name}'`,
      });
    }
    if (oldProp.isReadonly && !newProp.isReadonly) {
      changes.push({
        kind: 'interface-property-became-mutable',
        severity: 'minor',
        symbolPath: `${name}.${propName}`,
        message: `Property '${propName}' became mutable in interface '${name}'`,
      });
    }
  }

  // Methods
  const oldMethods = new Map(oldIf.methods.map((m) => [m.name, m]));
  const newMethods = new Map(newIf.methods.map((m) => [m.name, m]));

  for (const [methodName] of oldMethods) {
    if (!newMethods.has(methodName)) {
      changes.push({
        kind: 'interface-method-removed',
        severity: 'major',
        symbolPath: `${name}.${methodName}`,
        message: `Method '${methodName}' was removed from interface '${name}'`,
      });
    }
  }

  for (const [methodName] of newMethods) {
    if (!oldMethods.has(methodName)) {
      const newMethod = newMethods.get(methodName);
      if (!newMethod) continue;
      changes.push({
        kind: newMethod.isOptional ? 'interface-method-added' : 'required-interface-method-added',
        severity: newMethod.isOptional ? 'minor' : 'major',
        symbolPath: `${name}.${methodName}`,
        message: `${newMethod.isOptional ? 'Optional' : 'Required'} method '${methodName}' was added to interface '${name}'`,
      });
    }
  }

  for (const [methodName, oldMethod] of oldMethods) {
    const newMethod = newMethods.get(methodName);
    if (!newMethod) continue;
    if (newMethod.signatures.length < oldMethod.signatures.length) {
      changes.push({
        kind: 'overload-removed',
        severity: 'major',
        symbolPath: `${name}.${methodName}`,
        message: `Overload was removed from interface method '${methodName}' in '${name}'`,
        oldValue: String(oldMethod.signatures.length),
        newValue: String(newMethod.signatures.length),
      });
    }
    if (newMethod.signatures.length > oldMethod.signatures.length) {
      changes.push({
        kind: 'overload-added',
        severity: 'minor',
        symbolPath: `${name}.${methodName}`,
        message: `Overload was added to interface method '${methodName}' in '${name}'`,
        oldValue: String(oldMethod.signatures.length),
        newValue: String(newMethod.signatures.length),
      });
    }
    const pairCount = Math.min(oldMethod.signatures.length, newMethod.signatures.length);
    const allSigChanges: ApiChange[] = [];
    for (let i = 0; i < pairCount; i++) {
      const oldSig = oldMethod.signatures[i];
      const newSig = newMethod.signatures[i];
      if (!oldSig || !newSig) continue;
      allSigChanges.push(...compareFunctionSignature(`${name}.${methodName}`, oldSig, newSig));
      allSigChanges.push(...classifyTypeParamChanges(`${name}.${methodName}`, oldSig.typeParameters, newSig.typeParameters));
    }
    if (allSigChanges.length > 0) {
      changes.push({
        kind: 'interface-method-signature-changed',
        severity: 'major',
        symbolPath: `${name}.${methodName}`,
        message: `Method '${methodName}' signature changed in interface '${name}'`,
      });
      changes.push(...allSigChanges);
    }
  }

  // Generic param changes
  changes.push(...classifyTypeParamChanges(name, oldIf.typeParameters, newIf.typeParameters));

  return changes;
}

type ApiClassMethod = ApiClassSymbol['methods'][number];
type ApiClassProperty = ApiClassSymbol['properties'][number];

function groupByName<T extends { name: string }>(items: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const existing = groups.get(item.name);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(item.name, [item]);
    }
  }
  return groups;
}

function classMethodKey(method: ApiClassMethod): string {
  return `${method.isStatic ? 'static' : 'instance'}:${method.name}`;
}

function classPropertyKey(property: ApiClassProperty): string {
  return `${property.isStatic ? 'static' : 'instance'}:${property.name}`;
}

function classifySingleClassMethodChange(className: string, oldMethod: ApiClassMethod, newMethod: ApiClassMethod): ApiChange[] {
  const changes: ApiChange[] = [];
  const symbolPath = `${className}.${oldMethod.name}`;

  if (newMethod.signatures.length < oldMethod.signatures.length) {
    changes.push({
      kind: 'overload-removed',
      severity: 'major',
      symbolPath,
      message: `Overload was removed from class method '${oldMethod.name}' in '${className}'`,
      oldValue: String(oldMethod.signatures.length),
      newValue: String(newMethod.signatures.length),
    });
  }
  if (newMethod.signatures.length > oldMethod.signatures.length) {
    changes.push({
      kind: 'overload-added',
      severity: 'minor',
      symbolPath,
      message: `Overload was added to class method '${oldMethod.name}' in '${className}'`,
      oldValue: String(oldMethod.signatures.length),
      newValue: String(newMethod.signatures.length),
    });
  }
  // isStatic checks only fire in the 1:1 name-only shortcut path (classifyClassMethodGroupChanges).
  // In the key-matched path, both sides share the same static/instance key, so isStatic is always equal.
  if (oldMethod.isStatic && !newMethod.isStatic) {
    changes.push({
      kind: 'class-method-became-instance',
      severity: 'major',
      symbolPath,
      message: `Method '${oldMethod.name}' changed from static to instance in class '${className}'`,
    });
  }
  if (!oldMethod.isStatic && newMethod.isStatic) {
    changes.push({
      kind: 'class-method-became-static',
      severity: 'major',
      symbolPath,
      message: `Method '${oldMethod.name}' changed from instance to static in class '${className}'`,
    });
  }

  const pairCount = Math.min(oldMethod.signatures.length, newMethod.signatures.length);
  const allSigChanges: ApiChange[] = [];
  for (let i = 0; i < pairCount; i++) {
    const oldSig = oldMethod.signatures[i];
    const newSig = newMethod.signatures[i];
    if (!oldSig || !newSig) continue;
    allSigChanges.push(...compareFunctionSignature(symbolPath, oldSig, newSig));
    allSigChanges.push(...classifyTypeParamChanges(symbolPath, oldSig.typeParameters, newSig.typeParameters));
  }
  if (allSigChanges.length > 0) {
    changes.push({
      kind: 'class-method-signature-changed',
      severity: 'major',
      symbolPath,
      message: `Method '${oldMethod.name}' signature changed in class '${className}'`,
    });
    changes.push(...allSigChanges);
  }

  return changes;
}

function classifySingleClassPropertyChange(className: string, oldProp: ApiClassProperty, newProp: ApiClassProperty): ApiChange[] {
  const changes: ApiChange[] = [];
  const symbolPath = `${className}.${oldProp.name}`;

  if (oldProp.type.text !== newProp.type.text) {
    changes.push({
      kind: 'class-property-type-changed',
      severity: 'major',
      symbolPath,
      message: `Property '${oldProp.name}' type changed in class '${className}'`,
      oldValue: oldProp.type.text,
      newValue: newProp.type.text,
    });
  }
  // isStatic checks only fire in the 1:1 name-only shortcut path (classifyClassPropertyGroupChanges).
  // In the key-matched path, both sides share the same static/instance key, so isStatic is always equal.
  if (oldProp.isStatic && !newProp.isStatic) {
    changes.push({
      kind: 'class-property-became-instance',
      severity: 'major',
      symbolPath,
      message: `Property '${oldProp.name}' changed from static to instance in class '${className}'`,
    });
  }
  if (!oldProp.isStatic && newProp.isStatic) {
    changes.push({
      kind: 'class-property-became-static',
      severity: 'major',
      symbolPath,
      message: `Property '${oldProp.name}' changed from instance to static in class '${className}'`,
    });
  }
  if (oldProp.isOptional && !newProp.isOptional) {
    changes.push({
      kind: 'class-property-became-required',
      severity: 'major',
      symbolPath,
      message: `Property '${oldProp.name}' became required in class '${className}'`,
    });
  }
  if (!oldProp.isOptional && newProp.isOptional) {
    changes.push({
      kind: 'class-property-became-optional',
      severity: 'minor',
      symbolPath,
      message: `Property '${oldProp.name}' became optional in class '${className}'`,
    });
  }
  if (!oldProp.isReadonly && newProp.isReadonly) {
    changes.push({
      kind: 'class-property-became-readonly',
      severity: 'major',
      symbolPath,
      message: `Property '${oldProp.name}' became readonly in class '${className}'`,
    });
  }
  if (oldProp.isReadonly && !newProp.isReadonly) {
    changes.push({
      kind: 'class-property-became-mutable',
      severity: 'minor',
      symbolPath,
      message: `Property '${oldProp.name}' became mutable in class '${className}'`,
    });
  }

  return changes;
}

function classifyClassMethodGroupChanges(className: string, oldGroup: ApiClassMethod[], newGroup: ApiClassMethod[]): ApiChange[] {
  const changes: ApiChange[] = [];

  if (oldGroup.length === 0) {
    for (const method of newGroup) {
      changes.push({
        kind: 'class-method-added',
        severity: 'minor',
        symbolPath: `${className}.${method.name}`,
        message: `Method '${method.name}' was added to class '${className}'`,
      });
    }
    return changes;
  }

  if (newGroup.length === 0) {
    for (const method of oldGroup) {
      changes.push({
        kind: 'class-method-removed',
        severity: 'major',
        symbolPath: `${className}.${method.name}`,
        message: `Method '${method.name}' was removed from class '${className}'`,
      });
    }
    return changes;
  }

  if (oldGroup.length === 1 && newGroup.length === 1) {
    return classifySingleClassMethodChange(className, oldGroup[0], newGroup[0]);
  }

  const oldByKey = new Map(oldGroup.map((method) => [classMethodKey(method), method]));
  const newByKey = new Map(newGroup.map((method) => [classMethodKey(method), method]));

  for (const [key, oldMethod] of oldByKey) {
    const newMethod = newByKey.get(key);
    if (!newMethod) {
      changes.push({
        kind: 'class-method-removed',
        severity: 'major',
        symbolPath: `${className}.${oldMethod.name}`,
        message: `Method '${oldMethod.name}' was removed from class '${className}'`,
      });
      continue;
    }
    changes.push(...classifySingleClassMethodChange(className, oldMethod, newMethod));
  }

  for (const [key, newMethod] of newByKey) {
    if (oldByKey.has(key)) continue;
    changes.push({
      kind: 'class-method-added',
      severity: 'minor',
      symbolPath: `${className}.${newMethod.name}`,
      message: `Method '${newMethod.name}' was added to class '${className}'`,
    });
  }

  return changes;
}

function classifyClassPropertyGroupChanges(className: string, oldGroup: ApiClassProperty[], newGroup: ApiClassProperty[]): ApiChange[] {
  const changes: ApiChange[] = [];

  if (oldGroup.length === 0) {
    for (const property of newGroup) {
      changes.push({
        kind: property.isOptional ? 'class-property-added' : 'required-class-property-added',
        severity: property.isOptional ? 'minor' : 'major',
        symbolPath: `${className}.${property.name}`,
        message: `${property.isOptional ? 'Optional' : 'Required'} property '${property.name}' was added to class '${className}'`,
      });
    }
    return changes;
  }

  if (newGroup.length === 0) {
    for (const property of oldGroup) {
      changes.push({
        kind: 'class-property-removed',
        severity: 'major',
        symbolPath: `${className}.${property.name}`,
        message: `Property '${property.name}' was removed from class '${className}'`,
      });
    }
    return changes;
  }

  if (oldGroup.length === 1 && newGroup.length === 1) {
    return classifySingleClassPropertyChange(className, oldGroup[0], newGroup[0]);
  }

  const oldByKey = new Map(oldGroup.map((property) => [classPropertyKey(property), property]));
  const newByKey = new Map(newGroup.map((property) => [classPropertyKey(property), property]));

  for (const [key, oldProperty] of oldByKey) {
    const newProperty = newByKey.get(key);
    if (!newProperty) {
      changes.push({
        kind: 'class-property-removed',
        severity: 'major',
        symbolPath: `${className}.${oldProperty.name}`,
        message: `Property '${oldProperty.name}' was removed from class '${className}'`,
      });
      continue;
    }
    changes.push(...classifySingleClassPropertyChange(className, oldProperty, newProperty));
  }

  for (const [key, newProperty] of newByKey) {
    if (oldByKey.has(key)) continue;
    changes.push({
      kind: newProperty.isOptional ? 'class-property-added' : 'required-class-property-added',
      severity: newProperty.isOptional ? 'minor' : 'major',
      symbolPath: `${className}.${newProperty.name}`,
      message: `${newProperty.isOptional ? 'Optional' : 'Required'} property '${newProperty.name}' was added to class '${className}'`,
    });
  }

  return changes;
}

function classifyEnumChanges(name: string, oldEnum: ApiEnumSymbol, newEnum: ApiEnumSymbol): ApiChange[] {
  const changes: ApiChange[] = [];
  const oldMembers = new Map(oldEnum.members.map((m) => [m.name, m]));
  const newMembers = new Map(newEnum.members.map((m) => [m.name, m]));

  for (const [memberName] of oldMembers) {
    if (!newMembers.has(memberName)) {
      changes.push({
        kind: 'enum-member-removed',
        severity: 'major',
        symbolPath: `${name}.${memberName}`,
        message: `Enum member '${memberName}' was removed from '${name}'`,
      });
    }
  }

  for (const [memberName] of newMembers) {
    if (!oldMembers.has(memberName)) {
      changes.push({
        kind: 'enum-member-added',
        severity: 'minor',
        symbolPath: `${name}.${memberName}`,
        message: `Enum member '${memberName}' was added to '${name}'`,
      });
    }
  }

  // Value changes (breaking: consumers may compare numeric values)
  for (const [memberName, oldMember] of oldMembers) {
    const newMember = newMembers.get(memberName);
    if (!newMember) continue;
    if (oldMember.value !== newMember.value) {
      changes.push({
        kind: 'enum-member-value-changed',
        severity: 'major',
        symbolPath: `${name}.${memberName}`,
        message: `Enum member '${memberName}' value changed in '${name}'`,
        oldValue: String(oldMember.value),
        newValue: String(newMember.value),
      });
    }
  }

  return changes;
}

function classifyClassChanges(name: string, oldCls: ApiClassSymbol, newCls: ApiClassSymbol): ApiChange[] {
  const changes: ApiChange[] = [];

  // Constructor changes
  const oldCtors = oldCls.constructorSignatures;
  const newCtors = newCls.constructorSignatures;
  if (newCtors.length < oldCtors.length) {
    changes.push({
      kind: 'overload-removed',
      severity: 'major',
      symbolPath: `${name}.constructor`,
      message: `Constructor overload was removed from '${name}'`,
      oldValue: String(oldCtors.length),
      newValue: String(newCtors.length),
    });
  }
  if (newCtors.length > oldCtors.length) {
    changes.push({
      kind: 'overload-added',
      severity: 'minor',
      symbolPath: `${name}.constructor`,
      message: `Constructor overload was added to '${name}'`,
      oldValue: String(oldCtors.length),
      newValue: String(newCtors.length),
    });
  }
  const ctorPairCount = Math.min(oldCtors.length, newCtors.length);
  for (let i = 0; i < ctorPairCount; i++) {
    const ctorSubChanges = compareFunctionSignature(`${name}.constructor`, oldCtors[i], newCtors[i]);
    if (ctorSubChanges.length > 0) {
      const oldCtorParams = oldCtors[i].parameters.map((p) => `${p.name}: ${p.type.text}`).join(', ');
      const newCtorParams = newCtors[i].parameters.map((p) => `${p.name}: ${p.type.text}`).join(', ');
      changes.push({
        kind: 'class-constructor-changed',
        severity: 'major',
        symbolPath: `${name}.constructor`,
        message: `Constructor of class '${name}' changed`,
        oldValue: oldCtorParams,
        newValue: newCtorParams,
      });
      changes.push(...ctorSubChanges);
    }
  }

  // Methods
  const oldMethodGroups = groupByName(oldCls.methods);
  const newMethodGroups = groupByName(newCls.methods);
  const methodNames = new Set([...oldMethodGroups.keys(), ...newMethodGroups.keys()]);
  for (const methodName of methodNames) {
    changes.push(
      ...classifyClassMethodGroupChanges(
        name,
        oldMethodGroups.get(methodName) ?? [],
        newMethodGroups.get(methodName) ?? [],
      ),
    );
  }

  // Properties
  const oldPropertyGroups = groupByName(oldCls.properties);
  const newPropertyGroups = groupByName(newCls.properties);
  const propertyNames = new Set([...oldPropertyGroups.keys(), ...newPropertyGroups.keys()]);
  for (const propertyName of propertyNames) {
    changes.push(
      ...classifyClassPropertyGroupChanges(
        name,
        oldPropertyGroups.get(propertyName) ?? [],
        newPropertyGroups.get(propertyName) ?? [],
      ),
    );
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
