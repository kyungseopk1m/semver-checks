export class ProtectedBase {
  protected constructor() {}
}
export class Derived extends ProtectedBase {
  protected constructor() {
    super();
  }
}
