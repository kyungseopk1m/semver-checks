export function greet(name: string, greeting?: string): string { return `${greeting ?? 'Hello'} ${name}`; }
