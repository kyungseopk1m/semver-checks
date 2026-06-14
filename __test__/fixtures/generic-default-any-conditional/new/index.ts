// Default changed unknown -> any. Inside a conditional type this is NOT a simple
// loosening: `any` distributes and can widen the resolved output an omitting
// consumer sees. There is no `any`-widening shortcut, so this stays MAJOR.
export type Sel<T = any> = T extends "n" ? "narrow" : T;
