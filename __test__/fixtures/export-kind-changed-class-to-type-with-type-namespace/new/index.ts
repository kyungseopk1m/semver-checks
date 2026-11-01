export interface Client {
  send(body: string): void;
}
export declare namespace Client {
  type Options = { retries: number };
}
