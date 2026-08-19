export interface Emitter {
  on(event: 'ready', listener: (count: number) => void): void;
  on(event: 'error', listener: (message: string) => void): void;
}
