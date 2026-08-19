// Probe for @sinclair/typebox 0.34.51 -> 0.34.52, where the `StringUtil` namespace
// was dropped from the `@sinclair/typebox/compiler` entry. The main consumer only
// uses the `Type` builders, so the removal was invisible to the oracle.
//
// Same reachability standard applied to the baseline's findings: a symbol counts
// only if it can be imported from a public entry. `StringUtil` can.
import { StringUtil, TypeCompiler } from '@sinclair/typebox/compiler';
import { Type } from '@sinclair/typebox';

export function escape(value: string): string {
  return StringUtil.Escape(value);
}

const compiled = TypeCompiler.Compile(Type.Object({ id: Type.Number() }));
export const ok: boolean = compiled.Check({ id: 1 });
