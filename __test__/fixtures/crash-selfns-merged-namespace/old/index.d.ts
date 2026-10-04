declare namespace foo {
  export interface Opts { a?: number }
  export { foo as default, foo }
}
declare namespace foo {
  export const version: string
}
declare function foo(o?: foo.Opts): void
export = foo
