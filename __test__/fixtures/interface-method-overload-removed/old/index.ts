export interface Parser {
  parse(input: string): object;
  parse(input: string, strict: boolean): object;
}
