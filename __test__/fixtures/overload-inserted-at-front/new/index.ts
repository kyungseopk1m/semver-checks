// A new overload declared ahead of the existing ones. Every old signature is
// still present, unchanged, in the same relative order.
export function on(event: 'close', listener: () => void): void;
export function on(event: 'ready', listener: (count: number) => void): void;
export function on(event: 'error', listener: (message: string) => void): void;
export function on(event: string, listener: (arg: never) => void): void {
  void event;
  void listener;
}
