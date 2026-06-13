// String, template, and template-placeholder literal span tracking used by both
// the rename-aware textual fast-path and the `any`-keyword guard. Rewriting an
// identifier inside a string literal type (`'S'` → `'T'`) would erase a real
// breaking change, and the keyword `any` inside `'foo any bar'` is not the
// `any` keyword — both consumers need the same scanner.
//
// Template-literal placeholders (`${...}`) put the parser back into type
// position, so identifiers there *should* still be rewritten and the keyword
// guard *should* still fire. We expose placeholder spans separately from the
// outer literal spans and `isInsideLiteral` returns `true` only when an offset
// is inside an outer literal **and not** inside a placeholder body.

export type LiteralSpan = readonly [number, number];

export interface LiteralSpans {
  /** Outer string / template-literal bodies, from open quote to close quote. */
  literal: LiteralSpan[];
  /** Template-literal placeholder bodies, between `${` and the matching `}`. */
  placeholders: LiteralSpan[];
}

export function computeLiteralSpans(text: string): LiteralSpans {
  const literal: [number, number][] = [];
  const placeholders: [number, number][] = [];
  type Mode =
    | { kind: 'type'; braceDepth: number; placeholderStart: number }
    | { kind: 'string'; quote: '"' | "'"; start: number }
    | { kind: 'template'; start: number };
  const stack: Mode[] = [{ kind: 'type', braceDepth: 0, placeholderStart: -1 }];
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const top = stack[stack.length - 1];
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (top.kind === 'string') {
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === top.quote) {
        literal.push([top.start, i]);
        stack.pop();
      }
      continue;
    }
    if (top.kind === 'template') {
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '`') {
        literal.push([top.start, i]);
        stack.pop();
        continue;
      }
      if (ch === '$' && text[i + 1] === '{') {
        // Re-enter type position inside the placeholder. The outer template
        // span is *not* closed — placeholders are excluded from the literal
        // body via the separate `placeholders` list.
        stack.push({ kind: 'type', braceDepth: 0, placeholderStart: i + 2 });
        i++; // skip the `{`
        continue;
      }
      continue;
    }
    // type mode
    if (ch === '"' || ch === "'") {
      stack.push({ kind: 'string', quote: ch as '"' | "'", start: i });
      continue;
    }
    if (ch === '`') {
      stack.push({ kind: 'template', start: i });
      continue;
    }
    if (ch === '{') {
      top.braceDepth++;
      continue;
    }
    if (ch === '}') {
      if (top.braceDepth > 0) {
        top.braceDepth--;
        continue;
      }
      if (stack.length > 1 && top.placeholderStart >= 0) {
        // Close a placeholder: record its body span (between `${` and `}`)
        // before popping back to the enclosing template.
        placeholders.push([top.placeholderStart, i - 1]);
        stack.pop();
      }
    }
  }
  return { literal, placeholders };
}

export function isInsideLiteral(
  spans: LiteralSpans,
  startOffset: number,
  endOffset: number,
): boolean {
  let inside = false;
  for (const [s, e] of spans.literal) {
    if (startOffset > s && endOffset < e) {
      inside = true;
      break;
    }
  }
  if (!inside) return false;
  // A match that lands strictly inside a placeholder body is at *type* position
  // again, so the consumer must not treat it as a literal.
  for (const [s, e] of spans.placeholders) {
    if (startOffset >= s && endOffset <= e) return false;
  }
  return true;
}
