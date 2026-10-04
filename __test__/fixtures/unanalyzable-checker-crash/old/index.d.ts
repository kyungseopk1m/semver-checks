// Doubled ten times this is a 5120-element tuple, which the checker can build.
type Seed = [0, 0, 0, 0, 0];
type Double<T extends unknown[]> = [...T, ...T];
export type Huge = Double<Double<Double<Double<Double<Double<Double<Double<Double<Double<Seed>>>>>>>>>>;
export type Kept = string;
export {};
