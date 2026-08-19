// Probe for hono 4.12.34 -> 4.13.0. Three flagged symbols, none of which the main
// consumer touches: `JSXNode.suspendedContext` (removed), `useRef`'s parameter
// (narrowed, alongside `RefObject<T>` changing from `{current: T | null}` to
// `{current: T}`), and `METHODS` (a readonly tuple that grew a member).
import type { JSXNode, RefObject } from 'hono/jsx';
import { useRef } from 'hono/jsx';
import { METHODS } from 'hono/router';

export function runSuspended<T>(node: JSXNode, callback: () => T): T | undefined {
  return node.suspendedContext?.(callback);
}

// Annotating a ref is the ordinary React-shaped idiom, and it is the form that
// pins the return type rather than re-inferring it.
const divRef: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);

// A consumer that routes each method through its own union-typed function is what
// a grown tuple breaks: the union gained a member the consumer does not handle.
type Method = 'get' | 'post' | 'put' | 'delete' | 'options' | 'patch';
function register(method: Method): void {
  void method;
}
for (const method of METHODS) {
  register(method);
}

export { divRef, register };
