export interface RetryOptions {
  retries?: number;
}
export interface RequestOptions extends RetryOptions {
  url: string;
}
