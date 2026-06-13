export type Unwrap<A> = A extends ReadonlyArray<infer E> ? E : A;
