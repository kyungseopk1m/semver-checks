export interface Client {
  send(body: string): void;
}
export declare namespace Client {
  const defaults: { retries: number };
}
