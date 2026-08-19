import { match, P, isMatching, ExhaustiveError } from 'ts-pattern';
import type { AnyPattern } from 'ts-pattern/types';

type Shape =
  | { kind: 'circle'; radius: number }
  | { kind: 'square'; size: number };

function area(shape: Shape): number {
  return match(shape)
    .with({ kind: 'circle' }, (s) => Math.PI * s.radius ** 2)
    .with({ kind: 'square', size: P.number }, (s) => s.size ** 2)
    .exhaustive();
}

function assertNever(x: never): never {
  throw new ExhaustiveError(x);
}

const isCircle = isMatching({ kind: 'circle' });
const check = isCircle({ kind: 'circle', radius: 1 } as Shape);

declare const someShape: Shape;
const isBigCircle = isMatching(
  { kind: 'circle', radius: P.number },
  someShape
);

const anyPattern: AnyPattern = P._;

export { area, assertNever, check, isBigCircle };
