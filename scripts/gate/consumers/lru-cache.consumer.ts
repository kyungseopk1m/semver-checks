// Transcribed from lru-cache's documented quickstart: construct with options,
// set/get/has/delete, and the dispose + fetch hooks.
import { LRUCache } from 'lru-cache';

interface Entry {
  value: string;
}

const cache = new LRUCache<string, Entry>({
  max: 500,
  ttl: 1000 * 60 * 5,
  updateAgeOnGet: true,
  allowStale: false,
  dispose: (value, key, reason) => {
    void value.value;
    void key;
    void reason;
  },
});

cache.set('a', { value: 'x' });
const got: Entry | undefined = cache.get('a');
const present: boolean = cache.has('a');
cache.delete('a');
cache.clear();

const size: number = cache.size;
const max: number = cache.max;
for (const [key, value] of cache.entries()) {
  void key;
  void value.value;
}

export { cache, got, present, size, max };
