export interface IssueData {
  code: string;
}

// A type alias of an object literal. Member types reference a package-internal
// type (IssueData) that does not resolve in the isolated variance probe, so the
// equivalence must be proven by the canonical member-set comparison.
export type RefinementCtx = {
  addIssue: (arg: IssueData) => void;
  path: (string | number)[];
};
