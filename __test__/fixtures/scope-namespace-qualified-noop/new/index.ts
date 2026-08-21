export declare namespace P {
  interface Pattern<T> {
    match(value: T): boolean;
  }
}
export type Matcher<T> = { readonly tag: string } & P.Pattern<T>;
