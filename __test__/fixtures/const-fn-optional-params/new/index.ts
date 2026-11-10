// An optional parameter added: callers that pass nothing still compile.
export declare const grow: (a?: string, b?: number) => void;
// The same signature written as source with defaults.
export const box = (message = '', title = ''): void => {
  void message;
  void title;
};
// A real narrowing, which has to stay a break.
export const narrow = (value = ''): void => {
  void value;
};
