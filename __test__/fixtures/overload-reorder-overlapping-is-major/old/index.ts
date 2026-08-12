export function overlap(x: string): 'specific';
export function overlap(x: unknown): 'broad';
export function overlap(x: unknown): string {
  return typeof x === 'string' ? 'specific' : 'broad';
}
