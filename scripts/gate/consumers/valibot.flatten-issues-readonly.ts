// Probe for valibot 1.3.1 -> 1.4.0. Both `flatten` overloads widened their issues
// parameter to a readonly tuple. Calling `flatten` is unaffected, because that is a
// relaxation; a helper that names the parameter type and mutates it is not.
import * as v from 'valibot';

type FlattenIssues = Parameters<typeof v.flatten>[0];

export function collect(issues: FlattenIssues, extra: v.BaseIssue<unknown>): FlattenIssues {
  issues.push(extra);
  return issues;
}
