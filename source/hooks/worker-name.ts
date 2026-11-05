// Who does the work in this conversation. Words written for Claude name the model really behind it once another model
// is (owner 11-04: 「对Claude 模型本身可以全力去依赖」). «Claude Code» stays: that is the app. Claude the character
// (Claudie's own lines), Claude's own account, what is sent to a model and the fan-mod notice are left alone.
let worker: string | undefined

export function setWorkerName(name: string | undefined): void { worker = name?.trim() || undefined }

const KEPT = /^(more\.)?(model\.|talk\.(dake|maid)\.|dialog\.title|paste\.kinds\.)|^privacy\.accountHow$/

export function workerText(key: string, text: string): string {
  const name = worker
  return !name || KEPT.test(key) ? text : text.replace(/\bClaude\b(?! Code|さま)|\bclaude$/g, () => name)
}
