import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';

// The standard axios service-layer wrapper: forward axios's own <T, R>
// generics so callers can opt into an unwrapped return type.
export function request<T = any, R = AxiosResponse<T>>(
  config: AxiosRequestConfig
): Promise<R> {
  return axios.request<T, R>(config);
}

interface User {
  id: number;
  name: string;
}

export async function main(): Promise<void> {
  const full = await request<User>({ url: '/me' });
  console.log(full.data.name);
}
