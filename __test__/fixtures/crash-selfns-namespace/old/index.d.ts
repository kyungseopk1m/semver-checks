declare namespace foo {
  interface Opts { a?: number }
  export { foo as default, foo }
}
declare function foo(o?: foo.Opts): void
export = foo
