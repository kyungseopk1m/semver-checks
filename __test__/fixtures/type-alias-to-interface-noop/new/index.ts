export interface IssueData {
  code: string;
}

// Converted to an interface with the same shape (member order preserved). This is
// a routine, non-breaking refactor and must NOT be reported as export-removed.
export interface RefinementCtx {
  addIssue: (arg: IssueData) => void;
  path: (string | number)[];
}
