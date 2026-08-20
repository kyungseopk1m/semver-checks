// Probe for hono 4.12.28 -> 4.12.29. The Lambda@Edge handler's result widened to
// `CloudFrontResult | CloudFrontRequest`, and `CloudFrontRequest` has no `status`,
// so an outer handler that reads the result stops compiling.
import { Hono } from 'hono';
import type { CloudFrontEdgeEvent } from 'hono/lambda-edge';
import { handle } from 'hono/lambda-edge';

const app = new Hono();
app.get('/', (c) => c.text('hello'));
const handler = handle(app);

declare const event: CloudFrontEdgeEvent;

export async function status(): Promise<string> {
  const result = await handler(event);
  return result.status;
}
