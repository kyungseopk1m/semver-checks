export interface Formatter {
  format(value: string): string;
  validate(value: string): boolean;
}
