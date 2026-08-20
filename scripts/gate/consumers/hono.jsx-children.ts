// Probe for hono 4.12.19 -> 4.12.20. The JSX factory's children parameter widened
// from `(string | number | HtmlEscapedString)[]` to `Child[]`, which now includes
// `null`, `undefined` and nested arrays. Widening a parameter is safe for callers
// and breaks whoever is contextually typed by the factory, which is the direction
// a wrapper sits in.
import { jsx } from 'hono/jsx';

export const wrapped: typeof jsx = (tag, props, ...children) =>
  jsx(tag, props, children.map((child) => child.toString()).join(''));
