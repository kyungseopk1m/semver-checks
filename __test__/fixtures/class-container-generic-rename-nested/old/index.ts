export declare class Bag<T> {
  items: ReadonlyArray<T>;
  pick<U>(x: T | U): U;
}
