// Ambient shapes for the Node/Bun APIs test/helpers.ts uses. The project has
// no @types/node and tsconfig.json cannot be edited, so tsc needs these
// declarations; at runtime Bun provides the real implementations.
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: string): string;
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
}

interface ImportMeta {
  readonly dir: string;
}
