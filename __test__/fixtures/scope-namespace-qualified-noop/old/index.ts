export declare namespace P {
  interface Pattern<T> {
    match(value: T): boolean;
  }
}
export type Matcher<T> = P.Pattern<T> & { readonly tag: string };
