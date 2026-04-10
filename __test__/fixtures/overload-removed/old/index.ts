export function greet(name: string): string;
export function greet(name: string, greeting: string): string;
export function greet(name: string, greeting?: string): string {
  return greeting ? `${greeting}, ${name}` : `Hello, ${name}`;
}
