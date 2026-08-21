export interface Headers {
  'content-type': string;
  'x-trace-id'?: string;
}
export interface Request {
  headers: Headers;
  tags: ReadonlyArray<string>;
}
