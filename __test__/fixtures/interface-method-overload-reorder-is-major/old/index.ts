export interface Parser {
  parse(input: string): string;
  parse(input: number): number;
}
