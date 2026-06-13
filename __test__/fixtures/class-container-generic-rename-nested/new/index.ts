export declare class Bag<S> {
  items: readonly S[];
  pick<U>(x: S | U): U;
}
