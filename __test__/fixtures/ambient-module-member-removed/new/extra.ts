// A second block for the same ambient module. TypeScript merges it into
// 'ambient-pkg', so extraction has to gather blocks project-wide, not just the
// ones sitting in the entry file.
declare module 'ambient-pkg' {
  export const fromOtherFile: string;
}
