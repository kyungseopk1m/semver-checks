// ioredis's README configures reconnection with `retryStrategy(times)` and
// cluster reconnection with `clusterRetryStrategy(times, reason)`. A config layer
// that reads those back off an options object and hands them to another component
// is the read position, and 5.11.1 widened both with `| null`. Writing them still
// checks out, which is why the main consumer cannot see this.
import Redis, { Cluster } from 'ioredis';
import type { RedisOptions, ClusterOptions } from 'ioredis';

type Backoff = (times: number) => number | void | null;
type ClusterBackoff = (times: number, reason?: Error) => number | void | null;

function backoffOf(options: RedisOptions): Backoff | undefined {
  return options.retryStrategy;
}

function clusterBackoffOf(options: ClusterOptions): ClusterBackoff | undefined {
  return options.clusterRetryStrategy;
}

const client = new Redis({
  retryStrategy(times: number): number {
    return Math.min(times * 50, 2000);
  },
});

const liveBackoff: Backoff | undefined = client.options.retryStrategy;

const cluster = new Cluster([{ host: '127.0.0.1', port: 7000 }], {
  clusterRetryStrategy(times: number): number {
    return times * 100;
  },
});

const liveClusterBackoff: ClusterBackoff | undefined = cluster.options.clusterRetryStrategy;

export { backoffOf, clusterBackoffOf, liveBackoff, liveClusterBackoff, client, cluster };
