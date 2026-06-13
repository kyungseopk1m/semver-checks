export type X<T> = T extends Array<infer T> ? T : never;
