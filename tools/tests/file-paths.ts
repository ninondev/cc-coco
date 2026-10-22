// Fixture paths are independent of the runner's separator and current Windows drive.
// Keep this separate from the shipping helper: tests must not borrow its implementation.
// The plugin root the Mac rehearsal (run-tests.py --windows-roots) swaps in for $.plugin.root; a Windows run keeps its real one.
export const MOCK_WINDOWS_ROOT = String.raw`C:\Users\windows\Coco`
export function slashPath(path: string): string { return path.replace(/\\/g, '/') }
export function posixPath(path: string): string { return slashPath(path).replace(/^[A-Za-z]:(?=\/)/, '') }
export function samePath(actual: string, expected: string): boolean {
  const path = slashPath(actual), want = slashPath(expected)
  return (want.startsWith('/') ? path.replace(/^[A-Za-z]:/, '') : path) === want
}
export function pathPattern(path: string): RegExp {
  const escaped = slashPath(path).split('/').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\\\/]')
  return new RegExp(`^${path.startsWith('/') ? '(?:[A-Za-z]:)?' : ''}${escaped}$`)
}
