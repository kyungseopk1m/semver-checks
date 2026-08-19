// Probe for hono 4.12.26 -> 4.12.27, where `JSXNode.localContexts` was removed.
// The package's main consumer never reads it, so the compile oracle could not see
// the removal either way. Reading the property is the only way a consumer depends
// on it, so that is the probe.
import type { JSXNode } from 'hono/jsx';

export function hasLocalContexts(node: JSXNode): boolean {
  return node.localContexts !== undefined;
}
