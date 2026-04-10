export class Connection {
  constructor(host: string);
  constructor(host: string, port: number, tls: boolean);
  constructor(host: string, port?: number, tls?: boolean) {}
}
