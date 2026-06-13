export interface Box<S> {
  value: readonly S[];
  fn<U>(x: S | U): U;
}
