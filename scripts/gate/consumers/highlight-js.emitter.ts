// highlight.js documents Emitter as exported "for convenience as this has been a
// pretty stable API and is quite useful", and `HLJSOptions.__emitter` takes an
// emitter constructor, so implementing the interface is the documented way to
// render highlighted output as something other than HTML. 11.9.0 replaced the
// node-oriented members with scope-oriented ones.
import hljs from 'highlight.js';
import type { Emitter } from 'highlight.js';

class PlainTextEmitter implements Emitter {
  private out = '';

  constructor(_opts: unknown) {}

  addKeyword(text: string, kind: string): void {
    void kind;
    this.out += text;
  }

  addText(text: string): void {
    this.out += text;
  }

  openNode(kind: string): void {
    void kind;
  }

  closeNode(): void {}

  closeAllNodes(): void {}

  addSublanguage(emitter: Emitter, subLanguageName: string): void {
    void subLanguageName;
    this.out += emitter.toHTML();
  }

  toHTML(): string {
    return this.out;
  }

  finalize(): void {}
}

hljs.configure({ __emitter: PlainTextEmitter });

function drive(emitter: Emitter): string {
  emitter.openNode('keyword');
  emitter.addKeyword('const', 'keyword');
  emitter.closeNode();
  emitter.addText(' a = 1');
  emitter.closeAllNodes();
  emitter.finalize();
  return emitter.toHTML();
}

export { PlainTextEmitter, drive };
