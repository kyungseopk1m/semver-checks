// Doubled ten times this is a 10240-element tuple. Past 10000 elements the checker
// reports "too large to represent" against a node it does not have outside a
// diagnostics pass, and throws instead. `Huge` is spelled the same as before.
type Seed = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
type Double<T extends unknown[]> = [...T, ...T];
export type Huge = Double<Double<Double<Double<Double<Double<Double<Double<Double<Double<Seed>>>>>>>>>>;
export type Kept = string;
export {};
