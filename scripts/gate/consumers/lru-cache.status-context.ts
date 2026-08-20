// Probe for lru-cache 11.3.6 -> 11.4.0. `Status` gained a third type parameter
// for the fetch context, so the README's two-argument annotation stops matching a
// cache that declares one. The main consumer never names `Status`.
import { LRUCache } from 'lru-cache';

type Value = { body: string };
type FetchContext = { who: string };

const cache = new LRUCache<string, Value, FetchContext>({
  max: 100,
  fetchMethod: async () => ({ body: 'x' }),
});

const status: LRUCache.Status<string, Value> = {};
cache.get('a', { status });
cache.has('a', { status });
cache.peek('a', { status });

export { cache, status };
