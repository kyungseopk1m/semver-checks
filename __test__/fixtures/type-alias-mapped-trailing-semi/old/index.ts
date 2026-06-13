export type Readonlyify<T> = { readonly [K in keyof T]: T[K] };
