export interface Element {
  tag: string;
}
export interface Text extends Element {
  data: string;
}
export interface Options {
  // `Text` extends `Element`, so this union is the same type. The DOM globals of
  // the same names are not.
  target: Element | Text;
}
