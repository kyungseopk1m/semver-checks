export class Base {
  protected constructor(x: string) {}
}
export class Derived extends Base {
  protected constructor(x: string) {
    super(x);
  }
}
