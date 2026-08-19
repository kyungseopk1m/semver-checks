// Transcribed from axios's documented quickstart: request, instance with config,
// interceptors, error narrowing, and cancellation.
import axios from 'axios';
import type { AxiosInstance, AxiosResponse, AxiosRequestConfig, AxiosError, InternalAxiosRequestConfig } from 'axios';

interface Todo {
  id: number;
  title: string;
}

const client: AxiosInstance = axios.create({
  baseURL: 'https://example.com',
  timeout: 1000,
  headers: { 'X-Custom': 'value' },
});

client.interceptors.request.use((config: InternalAxiosRequestConfig) => config);
client.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError) => Promise.reject(error),
);

async function main(): Promise<void> {
  const response: AxiosResponse<Todo> = await client.get<Todo>('/todos/1');
  void response.data.title;
  void response.status;
  void response.headers;

  const config: AxiosRequestConfig = { params: { q: 'x' }, responseType: 'json' };
  await client.post<Todo>('/todos', { title: 'x' }, config);

  try {
    await axios.get('/missing');
  } catch (error) {
    if (axios.isAxiosError(error)) {
      void error.response?.status;
      void error.code;
    }
  }

  const controller = new AbortController();
  await client.get('/slow', { signal: controller.signal });
}

export { client, main };
