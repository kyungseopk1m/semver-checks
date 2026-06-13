export interface Box<T> {
  value: ReadonlyArray<T>;
  fn<U>(x: T | U): U;
}
