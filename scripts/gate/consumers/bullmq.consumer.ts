import { Queue, Worker, QueueEvents, FlowProducer, Job } from 'bullmq';
import type { Repeat, RepeatableJob, RedisJobOptions } from 'bullmq';

async function main() {
  const queue = new Queue('my-queue', { connection: { host: 'localhost' } });
  await queue.add('job-name', { foo: 'bar' });

  // QueueBase public getters (documented, if uncommon, consumer reads)
  const client = queue.client;
  const version = queue.redisVersion;
  const dbType = queue.databaseType;
  const scripts = queue.scripts;

  const worker = new Worker('my-queue', async (job) => {
    return job.id;
  });
  worker.resume();

  const events = new QueueEvents('my-queue');

  const flow = new FlowProducer({ connection: { host: 'localhost' } });
  await flow.add({
    name: 'parent',
    queueName: 'parent-queue',
    data: {},
    children: [{ name: 'child', data: {}, queueName: 'child-queue' }],
  });

  const jobs: RepeatableJob[] = await queue.getRepeatableJobs();
  await queue.removeRepeatable('job-name', { pattern: '* * * * *' });
  await queue.removeRepeatableByKey(jobs[0]?.key ?? '');
  const v: string = await queue.getVersion();

  const job = await Job.fromId(queue, 'id');
  job?.discard();
  const opts: RedisJobOptions = Job.optsAsJSON({});

  return { client, version, dbType, scripts, worker, events, jobs, v, opts };
}

export { main };
export type { Repeat };
