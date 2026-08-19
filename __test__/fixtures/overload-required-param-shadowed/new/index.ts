export declare class Printer {
  print(context?: { color: boolean }): void;
  // The deprecated overload lost its `?`, but the overload ahead of it still
  // accepts a bare `print()`, so no consumer loses a call form.
  /** @deprecated */
  print(format: (s: string) => string): void;
}
