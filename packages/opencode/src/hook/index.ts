import { spawn } from "bun"
import { Config } from "../config/config"
import { Log } from "../util/log"

export namespace Hook {
  const log = Log.create({ service: "hook" })

  export type HookConfig = {
    command: string[]
    environment?: Record<string, string>
  }

  export async function run(name: string, hooks: HookConfig[] | undefined, extraEnv?: Record<string, string>) {
    if (!hooks || hooks.length === 0) return

    for (const hook of hooks) {
      try {
        log.info("running hook", { name, command: hook.command.join(" ") })
        const proc = spawn({
          cmd: hook.command,
          env: { ...process.env, ...hook.environment, ...extraEnv },
          stdout: "inherit",
          stderr: "inherit",
        })
        await proc.exited
      } catch (err) {
        log.error("hook failed", { name, command: hook.command.join(" "), error: err })
      }
    }
  }

  export async function runAndCapture(
    name: string,
    hooks: HookConfig[] | undefined,
    extraEnv?: Record<string, string>,
  ): Promise<string> {
    if (!hooks || hooks.length === 0) return ""

    const outputs: string[] = []
    for (const hook of hooks) {
      try {
        log.info("running hook", { name, command: hook.command.join(" ") })
        const proc = spawn({
          cmd: hook.command,
          env: { ...process.env, ...hook.environment, ...extraEnv },
          stdout: "pipe",
          stderr: "inherit",
        })
        const output = await new Response(proc.stdout).text()
        await proc.exited
        if (output.trim()) {
          outputs.push(output.trim())
        }
      } catch (err) {
        log.error("hook failed", { name, command: hook.command.join(" "), error: err })
      }
    }
    return outputs.join("\n\n")
  }

  export async function sessionStart(sessionID: string) {
    const config = await Config.get()
    const hooks = config.experimental?.hook?.session_start
    await run("session_start", hooks, { OPENCODE_SESSION_ID: sessionID })
  }

  export async function sessionStartWithCapture(sessionID: string): Promise<string> {
    const config = await Config.get()
    const hooks = config.experimental?.hook?.session_start
    return runAndCapture("session_start", hooks, { OPENCODE_SESSION_ID: sessionID })
  }

  export async function preCompact(sessionID: string) {
    const config = await Config.get()
    const hooks = config.experimental?.hook?.pre_compact
    await run("pre_compact", hooks, { OPENCODE_SESSION_ID: sessionID })
  }
}
