// A consumer-owned function that accepts a LimitFunction, called with a stub.
import type { LimitFunction } from 'p-limit';

export async function runAll(limit: LimitFunction, jobs: Array<() => Promise<void>>) {
  await Promise.all(jobs.map(job => limit(job)));
  return limit.activeCount + limit.pendingCount;
}

const stub = Object.assign(
  <Arguments extends unknown[], ReturnType>(
    fn: (...args: Arguments) => PromiseLike<ReturnType> | ReturnType,
    ...args: Arguments
  ): Promise<ReturnType> => Promise.resolve(fn(...args)),
  { activeCount: 0, pendingCount: 0, clearQueue: () => {} },
);

export const total = runAll(stub, []);
