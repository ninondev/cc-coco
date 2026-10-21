// Development failure budgets only. Record clocks and production timers keep their own semantics.
export function cpuMilliseconds(): number {
  const usage = process.cpuUsage()
  return (usage.user + usage.system) / 1000
}

type Poll = (callback: () => void) => () => void
const poll: Poll = callback => {
  const timer = setTimeout(callback, 10)
  return () => clearTimeout(timer)
}

export function scheduleCpuBudget(milliseconds: number, work: () => void, clock = cpuMilliseconds, schedule: Poll = poll): () => void {
  const started = clock()
  let active = true
  let cancelPoll = () => {}
  function check() {
    if (!active) return
    if (clock() - started >= milliseconds) { active = false; work() }
    else cancelPoll = schedule(check)
  }
  check()
  return () => { active = false; cancelPoll() }
}
