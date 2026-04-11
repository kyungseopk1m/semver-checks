export interface Container<T extends { id: string; version: number }> {
  value: T;
  getValue(): T;
}
