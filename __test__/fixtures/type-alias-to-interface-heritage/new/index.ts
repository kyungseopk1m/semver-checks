export interface RequiredBase {
  required: number;
}

// Options had an empty own body but now extends RequiredBase, so it inherits a
// required member. Comparing own members alone ({} vs {}) would look equal — but
// `new Options = {}` no longer type-checks (TS2741). The extends clause forces a
// conservative MAJOR.
export interface Options extends RequiredBase {}
