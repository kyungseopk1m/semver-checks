// highlight.js's language-definition guide shows `keywords` carrying a
// `$pattern` RegExp alongside the keyword lists. 11.9.0 narrowed the declared
// type of that object and stopped accepting it.
import hljs from 'highlight.js';
import type { Language, LanguageFn, HLJSApi } from 'highlight.js';

const lang: LanguageFn = (instance: HLJSApi): Language => {
  void instance.IDENT_RE;
  return {
    name: 'patterned',
    keywords: {
      $pattern: /[A-Za-z][A-Za-z0-9_]*/,
      keyword: 'let const function',
      literal: ['true', 'false'],
    },
    contains: [instance.QUOTE_STRING_MODE],
  };
};

hljs.registerLanguage('patterned', lang);

export { lang };
