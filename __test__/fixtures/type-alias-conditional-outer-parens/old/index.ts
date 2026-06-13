export type NonNull<T> = T extends null | undefined ? never : T;
