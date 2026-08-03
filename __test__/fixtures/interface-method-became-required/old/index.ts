export interface Handler {
  onEvent?(payload: string): void;
}
