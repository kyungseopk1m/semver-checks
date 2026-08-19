import ky, { HTTPError, TimeoutError } from 'ky';
import type { DownloadProgress, KyRequest, KyResponse, KyInstance } from 'ky';

interface Todo {
  id: number;
  title: string;
}

async function main() {
  try {
    await ky.get('https://api.example.com/todos/1');
  } catch (error) {
    if (error instanceof HTTPError) {
      console.log(error.name);
    }
    if (error instanceof TimeoutError) {
      console.log(error.name);
    }
  }

  const todo = await ky
    .get('https://api.example.com/todos/1', {
      searchParams: { done: 'true' },
      retry: { limit: 2, methods: ['get', 'post'] },
      onDownloadProgress: (progress: DownloadProgress, chunk: Uint8Array) => {
        console.log(progress.percent, chunk.length);
      },
      hooks: {
        beforeRequest: [
          (request: KyRequest) => {
            console.log(request.url);
          },
        ],
        beforeRetry: [
          ({ request, error, retryCount }) => {
            console.log(request.url, error, retryCount);
          },
        ],
        afterResponse: [
          (request: KyRequest, options, response: KyResponse) => {
            return response;
          },
        ],
      },
    })
    .json<Todo>();

  const withParams = ky.get('https://api.example.com/search', {
    searchParams: new URLSearchParams({ q: 'hello' }),
  });

  const instance: KyInstance = ky.create({ prefixUrl: 'https://api.example.com' });
  const extended: KyInstance = ky.extend({ retry: 2 });

  return { todo, withParams, instance, extended };
}

export { main };
