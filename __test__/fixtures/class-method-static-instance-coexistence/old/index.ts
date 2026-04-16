export class Parser {
  parse(input: string): string {
    return input;
  }

  static parse(input: string): Parser {
    return new Parser();
  }
}
