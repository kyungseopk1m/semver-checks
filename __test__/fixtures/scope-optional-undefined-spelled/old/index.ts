export interface ConnectionOptions {
  host: string;
}
export interface SentinelOptions {
  sentinelTLS?: ConnectionOptions;
}
export declare class Client {
  tls?: ConnectionOptions;
}
