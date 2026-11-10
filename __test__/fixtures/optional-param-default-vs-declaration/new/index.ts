// The working-tree side: the same API written as source with defaults.
export function box(message = '', title = ''): void {
  void message;
  void title;
}
// A real narrowing: `number` is no longer accepted.
export function pick(value = ''): void {
  void value;
}
// A real widening: `number` is accepted now.
export function grow(value: string | number = ''): void {
  void value;
}
export class Panel {
  render(width = 80): void {
    void width;
  }
}
