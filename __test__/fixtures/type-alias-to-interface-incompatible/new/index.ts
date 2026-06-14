// Same name, converted to an interface, but the property type changed
// (number -> string). The shapes are not interchangeable, so this stays a
// breaking change rather than being suppressed as a no-op refactor.
export interface Cfg {
  a: string;
}
