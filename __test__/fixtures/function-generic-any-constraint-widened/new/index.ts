export function f<T extends any>(x: T | number): T { return x as T; }
