export interface Container<T extends { id: string }> {
  value: T;
  getValue(): T;
}
