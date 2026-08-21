export interface ConnectionOptions {
  host: string;
}
export interface SentinelOptions {
  sentinelTLS?: ConnectionOptions | undefined;
}
export declare class Client {
  tls?: ConnectionOptions | undefined;
}
