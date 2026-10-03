// Fixture paths are independent of the runner's separator and current Windows drive.
// Keep this separate from the shipping helper: tests must not borrow its implementation.
export function slashPath(path: string): string { return path.replace(/\\/g, '/') }
export function samePath(actual: string, expected: string): boolean {
  const path = slashPath(actual), want = slashPath(expected)
  return (want.startsWith('/') ? path.replace(/^[A-Za-z]:/, '') : path) === want
}
export function pathPattern(path: string): RegExp {
  const escaped = slashPath(path).split('/').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\\\/]')
  return new RegExp(`^${path.startsWith('/') ? '(?:[A-Za-z]:)?' : ''}${escaped}$`)
}
