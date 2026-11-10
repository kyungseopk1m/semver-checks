// A default ahead of a required parameter does not make the argument optional:
// every call still has to pass something in that position.
export const f = (x = 1, y: string): void => {
  void x;
  void y;
};
export function h(x = 1, y: string): void {
  void x;
  void y;
}
