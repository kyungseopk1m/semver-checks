import { LRUCache } from 'lru-cache'

// FC = void: the instantiation the type docs name for
// FetchOptionsNoContext / MemoOptionsNoContext ("when the FC type is
// `undefined` or `void`"). fetchMethod/memoMethod take no context.
const cache = new LRUCache<string, string, void>({
  max: 100,
  fetchMethod: async (k: string) => `v:${k}`,
  memoMethod: (k: string) => `m:${k}`,
})

// A no-context cache carries no context, so downstream code types it as such.
function logContext(ctx: undefined): void {
  console.log('context', ctx)
}

// read position
export async function fetchAndLog(
  key: string,
  opts: LRUCache.FetchOptionsNoContext<string, string, void>
): Promise<string | undefined> {
  logContext(opts.context)
  return cache.fetch(key, opts)
}

// destructure position
export function memoAndLog(
  key: string,
  opts: LRUCache.MemoOptionsNoContext<string, string, void>
): string {
  const { context } = opts
  logContext(context)
  return cache.memo(key, opts)
}
