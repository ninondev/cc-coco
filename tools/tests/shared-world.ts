import { joinPath } from '../hooks/paths'

// Model the complete process-backed atomic replacement boundary. The payload is
// passed on stdin; tests retain the same feed assertions as the old fs.write seam.
export function atomicFeed(argv: readonly string[], stdin: string | undefined): { path: string; text: string } | undefined {
  return argv[0] === '/bin/sh' && argv[1] === '-c' && argv[3] === 'claudesama' && argv[5] === 'view.json'
    ? { path: joinPath(argv[4]!, argv[5]), text: stdin ?? '' }
    : undefined
}

export const PROCESS_OK = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
