export declare class Headers {
  // Two narrower overloads added ahead of the original. The original is still
  // here as the last one, with only its return type changed -- so no new
  // signature matches it exactly, and the alignment has to pick the closest
  // rather than the first. Picking the first invents a narrowed, newly-required
  // `asStrings`, which is what axios 1.17.0 reported before this.
  toJSON(asStrings: true): Record<string, string>;
  toJSON(asStrings?: false): Record<string, string | string[]>;
  toJSON(asStrings?: boolean): Record<string, string | string[]>;
}
