export class Parser {
  parse(input: number): string {
    return String(input);
  }

  static parse(input: string): Parser {
    return new Parser();
  }
}
