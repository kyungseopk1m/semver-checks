declare module 'ambient-pkg' {
  export function stay(): void;
}

// An augmentation of somebody else's module. Not this package's surface, so it
// must not leak into the snapshot.
declare module 'other-pkg' {
  export function unrelated(): void;
}
