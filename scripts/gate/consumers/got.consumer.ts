import got, { HTTPError, TimeoutError, ParseError, RequestError, Options } from 'got';
import type { CancelableRequest, CancelError } from 'got';

async function main() {
  const request: CancelableRequest<string> = got('https://example.com').text();

  try {
    await request;
  } catch (error) {
    if (error instanceof HTTPError) {
      console.log(error.name, error.code, error.response.statusCode);
    }
    if (error instanceof TimeoutError) {
      console.log(error.name, error.code);
    }
    if (error instanceof ParseError) {
      console.log(error.name, error.code);
    }
    if (error instanceof RequestError) {
      console.log(error.name, error.code);
    }
  }

  const opts = new Options('https://example.com', { method: 'GET' });

  const client = got.extend({
    hooks: {
      beforeRequest: [(options) => {}],
      beforeCache: [(response) => {}],
    },
  });

  return { client, opts, request };
}

export { main };
export type { CancelError };
