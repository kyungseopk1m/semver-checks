export function on(event: 'ready', listener: (count: number) => void): void;
export function on(event: 'error', listener: (message: string) => void): void;
export function on(event: string, listener: (arg: never) => void): void {
  void event;
  void listener;
}
