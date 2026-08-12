export class Singleton {
  private constructor() {}
  static create(): Singleton {
    return new Singleton();
  }
}
