// Flatten a highlight.js language definition's keywords into a plain word list
// (the shape an editor uses to build autocomplete from hljs language defs).
import type { LanguageDetail } from 'highlight.js';

export function keywordList(lang: LanguageDetail): string[] {
  const kw = lang.keywords;
  if (kw === undefined) return [];
  if (typeof kw === 'string') return kw.split(/\s+/);
  if (Array.isArray(kw)) return kw;

  const words: string[] = [];
  for (const group of Object.values(kw)) {
    words.push(...(typeof group === 'string' ? group.split(/\s+/) : group));
  }
  return words;
}
