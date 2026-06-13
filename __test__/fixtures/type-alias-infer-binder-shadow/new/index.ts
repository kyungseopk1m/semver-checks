export type X<S> = S extends Array<infer T> ? S : never;
