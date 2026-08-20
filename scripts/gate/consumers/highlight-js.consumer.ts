// Transcribed from highlight.js's documented quickstart. highlight.js declares
// its whole surface inside `declare module 'highlight.js'` blocks in one root
// .d.ts, so calling into it is what forces the ambient descent. The DOM entry
// points are here too: the gate's `target: es2022` pulls in lib.es2022.full,
// which carries the DOM, so leaving them out would drop free coverage.
import hljs from 'highlight.js';
import type {
  HLJSApi,
  HLJSOptions,
  HLJSPlugin,
  HighlightResult,
  AutoHighlightResult,
  HighlightOptions,
  Language,
  LanguageFn,
  Mode,
  ModeCallback,
  CallbackResponse,
  BeforeHighlightContext,
  CompiledMode,
  PluginEvent,
} from 'highlight.js';

const api: HLJSApi = hljs;

const options: Partial<HLJSOptions> = {
  classPrefix: 'hljs-',
  cssSelector: 'pre code',
  languages: ['javascript', 'typescript'],
  ignoreUnescapedHTML: true,
};
api.configure(options);

// A language definition is a function handed the api back, which is where the
// modes half of the surface has to keep holding.
const miniLanguage: LanguageFn = (instance: HLJSApi): Language => {
  const ident: string = instance.IDENT_RE;
  const onMatch: ModeCallback = (match: RegExpMatchArray, response: CallbackResponse): void => {
    void match[0];
    response.ignoreMatch();
    void response.isMatchIgnored;
  };

  // The generic is written out: `inherit<T>` returns T, and a call that leaves it
  // to inference keeps compiling through a change to the parameter list.
  const quoted: Mode = instance.inherit<Mode>(instance.QUOTE_STRING_MODE, { relevance: 0 });
  const comment: Mode = instance.COMMENT('//', '$');

  return {
    name: 'mini',
    aliases: ['mn'],
    case_insensitive: true,
    keywords: { keyword: 'let const function' },
    contains: [
      quoted,
      comment,
      instance.APOS_STRING_MODE,
      instance.C_NUMBER_MODE,
      instance.HASH_COMMENT_MODE,
      instance.C_LINE_COMMENT_MODE,
      instance.C_BLOCK_COMMENT_MODE,
      instance.REGEXP_MODE,
      instance.BACKSLASH_ESCAPE,
      { className: 'title', begin: ident, on: { begin: onMatch } },
      instance.SHEBANG({ binary: 'node' }),
      instance.END_SAME_AS_BEGIN({ begin: /"/, end: /"/ }),
    ],
    illegal: /</,
  };
};

api.registerLanguage('mini', miniLanguage);
api.registerAliases(['mn2', 'mini2'], { languageName: 'mini' });

const known: Language | undefined = api.getLanguage('mini');
const languages: string[] = api.listLanguages();
const detects: boolean = api.autoDetection('mini');
const version: string = api.versionString;

const result: HighlightResult = api.highlight('const a = 1', { language: 'javascript' } satisfies HighlightOptions);
const legacy: HighlightResult = api.highlight('javascript', 'const a = 1', true);
const auto: AutoHighlightResult = api.highlightAuto('const a = 1', ['javascript', 'mini']);

const value: string = result.value;
const relevance: number = result.relevance;
const illegal: boolean = result.illegal;
const detected: string | undefined = auto.language;
const second: HighlightResult | undefined = auto.secondBest;
const top: Language | CompiledMode | undefined = result._top;

// A plugin is a keyed object rather than a class, so the key set is part of the
// surface. Only the non-DOM events are used here.
const plugin: HLJSPlugin = {
  'before:highlight'(context: BeforeHighlightContext): void {
    void context.code;
    void context.language;
    void context.result?.value;
  },
  'after:highlight'(highlighted: HighlightResult): void {
    void highlighted.value;
  },
};
api.addPlugin(plugin);

const events: PluginEvent[] = ['before:highlight', 'after:highlight'];

// The regex helper bundle is a nested object literal on the api, and `either`
// carries a rest-tuple overload that a change to its options object would move.
const pattern: string = api.regex.concat(/a/, 'b', api.regex.optional(/c/));
const either: string = api.regex.either(/x/, /y/);
const lookahead: string = api.regex.lookahead(/z/);
const many: string = api.regex.anyNumberOfTimes(/q/);

// The DOM-facing half of the api, and the two plugin events that carry elements.
function highlightDom(el: HTMLElement): void {
  api.highlightElement(el);
  api.highlightAll();
}

const domPlugin: HLJSPlugin = {
  'before:highlightElement'({ el, language }): void {
    void el.nodeName;
    void language;
  },
  'after:highlightElement'({ el, result, text }): void {
    void el.nodeName;
    void result.value;
    void text;
  },
};
api.addPlugin(domPlugin);

api.unregisterLanguage('mini');
api.debugMode();
api.safeMode();

export {
  api,
  miniLanguage,
  known,
  languages,
  detects,
  version,
  result,
  legacy,
  auto,
  value,
  relevance,
  illegal,
  detected,
  second,
  top,
  plugin,
  events,
  highlightDom,
  domPlugin,
  pattern,
  either,
  lookahead,
  many,
};
