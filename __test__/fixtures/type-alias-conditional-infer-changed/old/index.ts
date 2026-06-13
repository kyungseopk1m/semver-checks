export type Unwrap<A> = A extends Array<infer E> ? E : A;
