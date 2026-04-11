type A = { a: 1 };
type B = { b: 1 };
type C = { c: 1 };

export type Value = A & (B | C);
