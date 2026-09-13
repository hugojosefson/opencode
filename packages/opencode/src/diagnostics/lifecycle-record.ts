import { isRecord } from "@/util/record"

const events = new Set([
  "process-spawn",
  "process-exit",
  "spawn-error",
  "supervisor-signal",
  "runtime-start",
  "runtime-exit",
  "api-abort",
  "session-cancel",
  "instance-disposal",
  "stream-start",
  "stream-interrupt",
  "stream-error",
  "stream-end",
])
const signals = new Set([
  "SIGINT",
  "SIGTERM",
  "SIGHUP",
  "SIGKILL",
  "SIGABRT",
  "SIGSEGV",
  "SIGBUS",
  "SIGILL",
  "SIGFPE",
  "SIGPIPE",
  "SIGQUIT",
  "SIGTRAP",
  "SIGSYS",
  "SIGXCPU",
  "SIGXFSZ",
])

export function parseLifecycleRecord(line: string) {
  try {
    const value: unknown = JSON.parse(line)
    if (!isRecord(value)) return undefined
    if (value.app !== "opencode" && value.app !== "opencode-launcher") return undefined
    if (typeof value.run !== "string" || !/^(?:[a-f0-9]{8}|[a-f0-9]{16})$/.test(value.run)) return undefined
    if (typeof value.ts !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.ts)) return undefined
    if (!Number.isFinite(Date.parse(value.ts)) || typeof value.event !== "string" || !events.has(value.event))
      return undefined
    // Select fields explicitly so an edited file cannot export conversation content.
    return {
      ts: value.ts,
      app: value.app,
      run: value.run,
      event: value.event,
      session: typeof value.session === "string" && /^[a-f0-9]{16}$/.test(value.session) ? value.session : undefined,
      summary: typeof value.summary === "boolean" ? value.summary : undefined,
      error:
        typeof value.error === "string" && ["abort", "context", "api", "other"].includes(value.error)
          ? value.error
          : undefined,
      result:
        typeof value.result === "string" && ["success", "failure", "interrupted"].includes(value.result)
          ? value.result
          : undefined,
      exitCode:
        value.exitCode === null ||
        (typeof value.exitCode === "number" &&
          Number.isInteger(value.exitCode) &&
          value.exitCode >= 0 &&
          value.exitCode <= 255)
          ? value.exitCode
          : undefined,
      signal:
        value.signal === null
          ? null
          : typeof value.signal === "string" && signals.has(value.signal)
            ? value.signal
            : undefined,
      rssMiB:
        typeof value.rssMiB === "number" && Number.isInteger(value.rssMiB) && value.rssMiB >= 0
          ? value.rssMiB
          : undefined,
    }
  } catch {
    return undefined
  }
}
