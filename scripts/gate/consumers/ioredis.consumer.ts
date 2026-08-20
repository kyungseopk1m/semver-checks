// Transcribed from ioredis's documented quickstart: the client class and its
// constructor overloads, the pipeline and transaction chains, a custom command,
// the cluster class, and a subclass of the shipped client. Nothing here opens a
// socket; the file exists to be typechecked.
import Redis, { Cluster, ReplyError, ScanStream, print } from 'ioredis';
import type {
  RedisOptions,
  ClusterOptions,
  ClusterNode,
  RedisKey,
  RedisValue,
  ChainableCommander,
  Callback,
  NatMap,
  SentinelAddress,
  StandaloneConnectionOptions,
  CommonRedisOptions,
} from 'ioredis';

// Each constructor overload is written out: an overload that loses its shape is
// only caught by a call that used it.
const byDefault = new Redis();
const byPort = new Redis(6379);
const byPath = new Redis('/tmp/redis.sock');
const byPortHost = new Redis(6379, '127.0.0.1');
const byOptions = new Redis({
  host: '127.0.0.1',
  port: 6379,
  db: 0,
  keyPrefix: 'app:',
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  retryStrategy(times: number): number {
    return Math.min(times * 50, 2000);
  },
});
const byPortHostOptions = new Redis(6379, '127.0.0.1', { db: 1 });

// Statics, including the ones that carry a class as their type.
const ClusterCtor: typeof Cluster = Redis.Cluster;
const created: Redis = Redis.createClient();

async function strings(): Promise<void> {
  await byOptions.set('key', 'value');
  await byOptions.set('key', 'value', 'EX', 60);
  const value: string | null = await byOptions.get('key');
  void value?.length;
  const count: number = await byOptions.del('key', 'other');
  void count;
  const incremented: number = await byOptions.incrby('counter', 5);
  void incremented;
  const exists: number = await byOptions.exists('key');
  void exists;
}

async function collections(): Promise<void> {
  await byOptions.hset('hash', 'field', 'value');
  const field: string | null = await byOptions.hget('hash', 'field');
  void field;
  const all: Record<string, string> = await byOptions.hgetall('hash');
  void all['field'];
  await byOptions.rpush('list', 'a', 'b', 'c');
  const range: string[] = await byOptions.lrange('list', 0, -1);
  void range.length;
  await byOptions.zadd('zset', 1, 'a', 2, 'b');
  const members: string[] = await byOptions.zrange('zset', 0, -1, 'WITHSCORES');
  void members;
}

// The callback form is a separate overload from the promise form.
function withCallback(): void {
  byOptions.get('key', (err: Error | null | undefined, result?: string | null) => {
    print(err ?? null, result);
  });
}

async function chained(): Promise<void> {
  const pipeline: ChainableCommander = byOptions.pipeline();
  pipeline.set('a', '1').incr('a').get('a');
  const results = await pipeline.exec();
  void results?.[0]?.[1];

  const multi: ChainableCommander = byOptions.multi();
  multi.set('b', '2').expire('b', 60);
  await multi.exec();
}

// `defineCommand` is the entry point for a Lua command; only its own signature is
// under test here, since naming the resulting method needs a `declare module`
// block and this file keeps its augmentations out of the shared surface.
byOptions.defineCommand('setIfGreater', {
  numberOfKeys: 1,
  lua: 'return redis.call("SET", KEYS[1], ARGV[1])',
});

async function streams(): Promise<void> {
  // The stream type is annotated rather than the listener: `on` is inherited from
  // EventEmitter as `(...args: any[])`, so a listener parameter annotation is
  // checked against `any` and would pin nothing.
  const stream: ScanStream = byOptions.scanStream({ match: 'app:*', count: 100 });
  stream.on('data', (keys: string[]) => void keys.length);
  const hashStream: ScanStream = byOptions.hscanStream('hash', { count: 10 });
  hashStream.on('end', () => undefined);
}

// Subclassing the shipped client: the base class's members and the EventEmitter
// it inherits both have to keep holding.
class TracedRedis extends Redis {
  private readonly label: string;

  constructor(label: string, options: RedisOptions) {
    super(options);
    this.label = label;
    this.on('error', (err: Error) => void err.message);
    this.on('ready', () => void this.status);
  }

  async getTraced(key: RedisKey): Promise<string | null> {
    void this.label;
    void this.options.keyPrefix;
    return this.get(key);
  }

  async setTraced(key: RedisKey, value: RedisValue): Promise<'OK'> {
    return this.set(key, value);
  }
}

const clusterOptions: ClusterOptions = {
  scaleReads: 'slave',
  redisOptions: { password: 'secret' },
  clusterRetryStrategy(times: number): number {
    return times * 100;
  },
};
const nodes: ClusterNode[] = [{ host: '127.0.0.1', port: 7000 }, { host: '127.0.0.1', port: 7001 }];
const cluster = new Cluster(nodes, clusterOptions);

async function clustered(): Promise<void> {
  await cluster.set('key', 'value');
  const nodesRead = cluster.nodes('master');
  void nodesRead.length;
  await cluster.quit();
}

const natMap: NatMap = { '10.0.0.1:30001': { host: '203.0.113.1', port: 30001 } };
const sentinels: SentinelAddress[] = [{ host: 'localhost', port: 26379 }];
const standalone: StandaloneConnectionOptions = { host: 'localhost', port: 6379 };
const common: Partial<CommonRedisOptions> = { commandTimeout: 5000 };
const cb: Callback<string> = (err, result) => void (err ?? result);

// `ReplyError` is declared `any` by the package, so there is no shape to pin here.
// The narrowing is written the plain way rather than through a cast that invents
// a constructor signature the declaration does not have.
function isReplyError(err: unknown): boolean {
  return err instanceof ReplyError;
}

const traced = new TracedRedis('primary', { lazyConnect: true });
const duplicated: Redis = byOptions.duplicate({ db: 3 });

export {
  byDefault,
  byPort,
  byPath,
  byPortHost,
  byOptions,
  byPortHostOptions,
  ClusterCtor,
  created,
  strings,
  collections,
  withCallback,
  chained,
  streams,
  TracedRedis,
  traced,
  cluster,
  clustered,
  natMap,
  sentinels,
  standalone,
  common,
  cb,
  isReplyError,
  duplicated,
};
