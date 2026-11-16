import { joinPath } from '../hooks/paths'
import { samePath } from './file-paths'

// Model the complete process-backed atomic replacement boundary. The payload is
// passed on stdin; tests retain the same feed assertions as the old fs.write seam.
export function atomicFeed(argv: readonly string[], stdin: string | undefined): { path: string; text: string } | undefined {
  return argv[0] === '/bin/sh' && argv[1] === '-c' && argv[3] === 'coco' && argv[5] === 'view.json'
    ? { path: joinPath(argv[4]!, argv[5]), text: stdin ?? '' }
    : undefined
}

// Only the bundled helper's fixed book-write contract is file I/O. Other helpers,
// destinations, extra arguments and lifecycle verbs remain visible to process assertions.
export function atomicLineBook(argv: readonly string[], stdin: string | undefined, pluginRoot: string, folder: string): { path: string; text: string } | undefined {
  return argv.length === 4 && samePath(argv[0] ?? '', joinPath(pluginRoot, 'bin', 'companion-control'))
    && argv[1] === 'write-lines' && samePath(argv[2] ?? '', folder)
    && /^lines-[a-f0-9]{64}\.json$/.test(argv[3] ?? '') && typeof stdin === 'string'
    ? { path: joinPath(argv[2]!, argv[3]!), text: stdin }
    : undefined
}

export const PROCESS_OK = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
