// Probe for ts-pattern 5.6.0 -> 5.6.1. `isMatching`'s pattern constraint gained
// `& UnknownProperties`, which requires a string index signature. Object-literal
// patterns have one; tuples, matchers like `P.string`, and literal patterns do not,
// so the two-argument README form stops compiling for all of them. 5.6.2 relaxes
// this again for array and primitive values, so this probe is scoped to the one
// pair rather than to the package.
import { P, isMatching } from 'ts-pattern';

declare const pair: [string, number];
export const n3: boolean = isMatching([P.string, P.number], pair);

declare const s: string;
export const n4: boolean = isMatching(P.string, s);

declare const code: 200 | 404;
export const n5: boolean = isMatching(200, code);
