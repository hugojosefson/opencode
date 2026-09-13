import { appendFileSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import { Global } from "@opencode-ai/core/global"
import { runID } from "@opencode-ai/core/observability/shared"
import { InstallationVersion } from "@opencode-ai/core/installation/version"

type Event =
  | "runtime-start"
  | "runtime-exit"
  | "api-abort"
  | "session-cancel"
  | "instance-disposal"
  | "stream-start"
  | "stream-interrupt"
  | "stream-error"
  | "stream-end"

type Detail = {
  sessionID?: string
  summary?: boolean
  error?: "abort" | "context" | "api" | "other"
  result?: "success" | "failure" | "interrupted"
  exitCode?: number
}

export function recordLifecycle(event: Event, detail: Detail = {}) {
  if (process.env.OPENCODE_DIAGNOSTICS !== "1") return
  const supplied = process.env.OPENCODE_DIAGNOSTIC_RUN
  const run = supplied && /^[a-f0-9]{16}$/.test(supplied) ? supplied : runID
  try {
    // Write before cancellation can close the batched application logger.
    appendFileSync(
      path.join(Global.Path.log, "lifecycle.jsonl"),
      JSON.stringify({
        ts: new Date().toISOString(),
        app: "opencode",
        run,
        event,
        version: event === "runtime-start" ? InstallationVersion : undefined,
        rssMiB: Math.round(process.memoryUsage.rss() / 1024 / 1024),
        session: detail.sessionID
          ? createHash("sha256").update(detail.sessionID).digest("hex").slice(0, 16)
          : undefined,
        summary: detail.summary,
        error: detail.error,
        result: detail.result,
        exitCode: detail.exitCode,
      }) + "\n",
      { mode: 0o600 },
    )
  } catch {
    // Diagnostics must not stop a session or print filesystem errors.
    process.stderr.write("OpenCode lifecycle diagnostics write failed\n")
  }
}
