export declare class Printer {
  // Every overload now demands an argument, so `print()` really is gone.
  print(context: { color: boolean }): void;
  print(format: (s: string) => string): void;
}
