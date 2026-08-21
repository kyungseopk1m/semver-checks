export interface Element {
  tag: string;
}
export interface Text extends Element {
  data: string;
}
export interface Options {
  target: Element;
}
