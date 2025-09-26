import z from "zod/v4"
import { spawn } from "child_process"

import { Tool } from "./tool"
import DESCRIPTION from "./bash.txt"
import { Permission } from "../permission"
import { Filesystem } from "../util/filesystem"
import { lazy } from "../util/lazy"
import { Log } from "../util/log"
import { Wildcard } from "../util/wildcard"
import { $ } from "bun"
import { Instance } from "../project/instance"
import { Agent } from "../agent/agent"

/** Maximum length of output before truncation */
const MAX_OUTPUT_LENGTH = 30_000
/** Default timeout for command execution in milliseconds */
const DEFAULT_TIMEOUT = 60 * 1000
/** Maximum allowed timeout for command execution in milliseconds */
const MAX_TIMEOUT = 10 * 60 * 1000
/** Grace period for SIGTERM before sending SIGKILL in milliseconds */
const GRACE_PERIOD = 3 * 1000

const log = Log.create({ service: "bash-tool" })

const parser = lazy(async () => {
  try {
    const { default: Parser } = await import("tree-sitter")
    const Bash = await import("tree-sitter-bash")
    const p = new Parser()
    p.setLanguage(Bash.language as any)
    return p
  } catch (e) {
    const { default: Parser } = await import("web-tree-sitter")
    const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, { with: { type: "wasm" } })
    await Parser.init({
      locateFile() {
        return treeWasm
      },
    })
    const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
      with: { type: "wasm" },
    })
    const bashLanguage = await Parser.Language.load(bashWasm)
    const p = new Parser()
    p.setLanguage(bashLanguage)
    return p
  }
})

export const BashTool = Tool.define("bash", {
  description: DESCRIPTION,
  parameters: z.object({
    command: z.string().describe("The command to execute"),
    timeout: z.number().describe("Optional timeout in milliseconds").optional(),
    description: z
      .string()
      .describe(
        "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
      ),
  }),
  async execute(params, ctx) {
    const timeout = Math.min(params.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT)
    const tree = await parser().then((p) => p.parse(params.command))
    const permissions = await Agent.get(ctx.agent).then((x) => x.permission.bash)

    const askPatterns = new Set<string>()
    for (const node of tree.rootNode.descendantsOfType("command")) {
      const command = []
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (!child) continue
        if (
          child.type !== "command_name" &&
          child.type !== "word" &&
          child.type !== "string" &&
          child.type !== "raw_string" &&
          child.type !== "concatenation"
        ) {
          continue
        }
        command.push(child.text)
      }

      // not an exhaustive list, but covers most common cases
      if (["cd", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown"].includes(command[0])) {
        for (const arg of command.slice(1)) {
          if (arg.startsWith("-") || (command[0] === "chmod" && arg.startsWith("+"))) continue
          const resolved = await $`realpath ${arg}`
            .quiet()
            .nothrow()
            .text()
            .then((x) => x.trim())
          log.info("resolved path", { arg, resolved })
          if (resolved && !Filesystem.contains(Instance.directory, resolved)) {
            throw new Error(
              `This command references paths outside of ${Instance.directory} so it is not allowed to be executed.`,
            )
          }
        }
      }

      // always allow cd if it passes above check
      if (command[0] !== "cd") {
        const action = Wildcard.all(node.text, permissions)
        if (action === "deny") {
          throw new Error(
            `The user has specifically restricted access to this command, you are not allowed to execute it. Here is the configuration: ${JSON.stringify(permissions)}`,
          )
        }
        if (action === "ask") {
          const pattern = (() => {
            let head = ""
            let sub: string | undefined
            for (let i = 0; i < node.childCount; i++) {
              const child = node.child(i)
              if (!child) continue
              if (child.type === "command_name") {
                if (!head) {
                  head = child.text
                }
                continue
              }
              if (!sub && child.type === "word") {
                if (!child.text.startsWith("-")) sub = child.text
              }
            }
            if (!head) return
            return sub ? `${head} ${sub} *` : `${head} *`
          })()
          if (pattern) {
            askPatterns.add(pattern)
          }
        }
      }
    }

    if (askPatterns.size > 0) {
      const patterns = Array.from(askPatterns)
      await Permission.ask({
        type: "bash",
        pattern: patterns,
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
        callID: ctx.callID,
        title: params.command,
        metadata: {
          command: params.command,
          patterns,
        },
      })
    }

    // Use spawn with stdio configuration to prevent stdin access
    // This prevents interactive commands from hanging by blocking stdin entirely
    const childProcess = spawn("bash", ["-c", params.command], {
      cwd: Instance.directory,
      signal: ctx.abort,
      env: process.env,
      // Critical: Configure stdio to prevent stdin access
      // 'ignore' means stdin is closed, causing interactive commands to fail fast
      stdio: ["ignore", "pipe", "pipe"],
      // Process group isolation to prevent orphaned processes
      detached: true,
      // Additional options for better process handling
      windowsHide: true, // Hide console window on Windows
    })


    // Improved timeout handling with escalating signals
    let timeoutId: NodeJS.Timeout | undefined
    let graceTimeoutId: NodeJS.Timeout | undefined

    /** Clean up all timeout handlers */
    const cleanupTimeouts = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = undefined
      }
      if (graceTimeoutId) {
        clearTimeout(graceTimeoutId)
        graceTimeoutId = undefined
      }
    }

    /** Kill the process group using the specified signal */
    const killProcessGroup = (signal: NodeJS.Signals) => {
      if (childProcess.pid && !childProcess.killed) {
        try {
          // Kill the entire process group to prevent orphaned processes
          // Use negative PID to target the process group
          process.kill(-childProcess.pid, signal)
        } catch (error) {
          // Fallback to killing just the main process if process group kill fails
          childProcess.kill(signal)
        }
      }
    }

    // Handle timeout with escalating signals
    timeoutId = setTimeout(() => {
      if (!childProcess.killed) {
        log.info("Process timeout - sending SIGTERM", { pid: childProcess.pid })
        killProcessGroup("SIGTERM")

        // Give process grace period to terminate gracefully
        graceTimeoutId = setTimeout(() => {
          if (!childProcess.killed) {
            log.info("Process didn't respond to SIGTERM - sending SIGKILL", { pid: childProcess.pid })
            killProcessGroup("SIGKILL")
          }
        }, GRACE_PERIOD)
      }
    }, timeout)

    let output = ""

    // Initialize metadata with empty output
    ctx.metadata({
      metadata: {
        output: "",
        description: params.description,
      },
    })

    childProcess.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString()
      ctx.metadata({
        metadata: {
          output: output,
          description: params.description,
        },
      })
    })

    childProcess.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString()
      ctx.metadata({
        metadata: {
          output: output,
          description: params.description,
        },
      })
    })

    await new Promise<void>((resolve) => {
      const cleanup = () => {
        cleanupTimeouts()
        resolve()
      }

      childProcess.on("close", cleanup)
      childProcess.on("exit", cleanup)
    })

    ctx.metadata({
      metadata: {
        output: output,
        exit: childProcess.exitCode,
        description: params.description,
      },
    })

    if (output.length > MAX_OUTPUT_LENGTH) {
      output = output.slice(0, MAX_OUTPUT_LENGTH)
      output += "\n\n(Output was truncated due to length limit)"
    }

    return {
      title: params.command,
      metadata: {
        output,
        exit: childProcess.exitCode,
        description: params.description,
      },
      output,
    }
  },
})
