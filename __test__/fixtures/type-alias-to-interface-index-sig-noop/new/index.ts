// Same index signature, converted to an interface. The index key name is
// arbitrary, so this is a no-op refactor and must not be flagged.
export interface Dict {
  [key: string]: number;
}
