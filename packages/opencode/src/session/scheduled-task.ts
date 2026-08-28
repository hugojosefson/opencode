import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Context, Effect, Layer, Schema, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { createHash } from "node:crypto"
import { ScheduledTaskParser } from "./scheduled-task-parser"

const Status = Schema.Literals(["scheduled", "running", "succeeded", "failed", "unknown"])

export const Info = Schema.Struct({
  id: Schema.String,
  taskID: Schema.optional(Schema.String),
  source: Schema.Literals(["metadata", "service", "script", "journal"]),
  status: Status,
  title: Schema.optional(Schema.String),
  timer: Schema.optional(Schema.String),
  service: Schema.optional(Schema.String),
  schedule: Schema.optional(Schema.String),
  next: Schema.optional(Schema.Finite),
  last: Schema.optional(Schema.Finite),
  workingDirectory: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  result: Schema.optional(Schema.String),
  exitStatus: Schema.optional(Schema.Finite),
  historical: Schema.Boolean,
}).annotate({ identifier: "ScheduledTask" })
export type Info = typeof Info.Type

export interface Interface {
  readonly list: (sessionID: string) => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ScheduledTask") {}

const terminal = {
  ae8f7b866b0347b9af31fe1c80b127c0: "succeeded",
  "7ad2d189f7e94e70a38c781354912448": "succeeded",
  d9b373ed55a64feb8242e02dbe79a49c: "failed",
} as const

const JournalEntry = Schema.fromJsonString(
  Schema.Struct({
    MESSAGE_ID: Schema.String,
    USER_UNIT: Schema.optional(Schema.String),
    _SYSTEMD_USER_UNIT: Schema.optional(Schema.String),
    USER_INVOCATION_ID: Schema.optional(Schema.String),
    _SYSTEMD_INVOCATION_ID: Schema.optional(Schema.String),
    UNIT_RESULT: Schema.optional(Schema.String),
    __REALTIME_TIMESTAMP: Schema.optional(Schema.String),
  }),
)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const fs = yield* FSUtil.Service

    const run = Effect.fnUntraced(
      function* (command: string, args: string[]) {
        const child = yield* spawner.spawn(
          ChildProcess.make(command, args, { stdin: "ignore", stderr: "ignore", extendEnv: true }),
        )
        const [stdout] = yield* Effect.all([Stream.mkString(Stream.decodeText(child.stdout)), child.exitCode], {
          concurrency: 2,
        })
        return stdout
      },
      Effect.scoped,
      Effect.catch(() => Effect.succeed("")),
    )

    const inspectTimer = Effect.fnUntraced(function* (timer: string, sessionID: string) {
      const timerProps = ScheduledTaskParser.properties(
        yield* run("systemctl", [
          "--user",
          "--timestamp=unix",
          "show",
          timer,
          "--property=Description,ActiveState,SubState,NextElapseUSecRealtime,LastTriggerUSec,TimersCalendar,TimersMonotonic,Triggers",
        ]),
      )
      const service = ScheduledTaskParser.triggeredService(timerProps.Triggers, timer)
      const serviceProps = ScheduledTaskParser.properties(
        yield* run("systemctl", [
          "--user",
          "show",
          service,
          "--property=Description,WorkingDirectory,Result,ExecMainStatus,ActiveState,SubState",
        ]),
      )
      const tag = ScheduledTaskParser.marker(`${timerProps.Description ?? ""}\n${serviceProps.Description ?? ""}`)
      if (tag && tag.sessionID !== sessionID) return

      const execStart = ScheduledTaskParser.properties(
        yield* run("systemctl", ["--user", "show", service, "--property=ExecStart"]),
      ).ExecStart
      const direct = ScheduledTaskParser.invocation(execStart ?? "")
      if (!tag && direct && direct.sessionID !== sessionID) return

      const path = direct ? undefined : ScheduledTaskParser.wrapperPath(execStart)
      const script = path
        ? yield* fs.stat(path).pipe(
            Effect.flatMap((stat) =>
              stat.type === "File" && stat.size <= 65_536 ? fs.readFileString(path) : Effect.succeed(""),
            ),
            Effect.catch(() => Effect.succeed("")),
          )
        : ""
      const wrapped = ScheduledTaskParser.invocation(script)
      const match = association({ sessionID, tag, direct, wrapped })
      if (!match) return

      const description = (timerProps.Description || serviceProps.Description || "")
        .replace(/opencode-scheduled-task:v1\s+session=\S+\s+task=\S+/, "")
        .trim()
      const prompt = [direct, wrapped].find((call) => call?.sessionID === sessionID)?.prompt
      return {
        id: match.taskID ?? timer,
        taskID: match.taskID,
        source: match.source,
        status: liveStatus(timerProps, serviceProps),
        title: description || ScheduledTaskParser.promptTitle(prompt) || match.taskID,
        timer,
        service,
        schedule: ScheduledTaskParser.schedule(timerProps),
        next: ScheduledTaskParser.timestamp(timerProps.NextElapseUSecRealtime),
        last: ScheduledTaskParser.timestamp(timerProps.LastTriggerUSec),
        workingDirectory: serviceProps.WorkingDirectory || undefined,
        prompt,
        result: serviceProps.Result || undefined,
        exitStatus: finiteInteger(serviceProps.ExecMainStatus),
        historical: false,
      } satisfies Info
    })

    const history = Effect.fnUntraced(function* (sessionID: string) {
      const output = yield* Effect.all(
        Object.keys(terminal).map((messageID) =>
          run("journalctl", [
            "--user",
            "--since=7 days ago",
            "--no-pager",
            "--output=json",
            "--output-fields=MESSAGE_ID,USER_UNIT,_SYSTEMD_USER_UNIT,USER_INVOCATION_ID,_SYSTEMD_INVOCATION_ID,UNIT_RESULT,__REALTIME_TIMESTAMP",
            `MESSAGE_ID=${messageID}`,
          ]),
        ),
        { concurrency: 2 },
      )
      return journalEntries(output.flatMap((text) => text.split("\n")), sessionID)
    })

    const list = Effect.fn("ScheduledTask.list")(function* (sessionID: string) {
      if (process.platform !== "linux") return []
      const timers = (yield* run("systemctl", [
        "--user",
        "list-units",
        "--all",
        "--type=timer",
        "--no-legend",
        "--plain",
      ]))
        .split("\n")
        .map((line) => line.trim().split(/\s+/)[0])
        .filter((unit) => unit.endsWith(".timer"))
      const inspected = yield* Effect.forEach(timers, (timer) => inspectTimer(timer, sessionID), { concurrency: 8 })
      const live = inspected.flatMap((item) => (item ? [item] : []))
      return [...live, ...(yield* history(sessionID))]
    })

    return Service.of({ list })
  }),
)

function association(input: {
  sessionID: string
  tag: ReturnType<typeof ScheduledTaskParser.marker>
  direct: ReturnType<typeof ScheduledTaskParser.invocation>
  wrapped: ReturnType<typeof ScheduledTaskParser.invocation>
}) {
  if (input.tag?.sessionID === input.sessionID) return { taskID: input.tag.taskID, source: "metadata" as const }
  if (input.direct?.sessionID === input.sessionID) return { source: "service" as const }
  if (input.wrapped?.sessionID === input.sessionID) return { source: "script" as const }
}

function liveStatus(timer: Record<string, string>, service: Record<string, string>): Info["status"] {
  if (service.SubState === "running" || service.ActiveState === "activating") return "running"
  if (timer.ActiveState === "active") return "scheduled"
  if (service.Result === "success") return "succeeded"
  if (service.Result) return "failed"
  return "unknown"
}

function finiteInteger(value: string | undefined) {
  if (!value || !/^-?\d+$/.test(value)) return
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

export function sessionKey(sessionID: string) {
  return createHash("sha256").update(sessionID).digest("hex").slice(0, 12)
}

export function journalEntry(line: string, pattern?: RegExp): Info[] {
  const parsed = Schema.decodeUnknownOption(JournalEntry)(line)
  if (parsed._tag === "None") return []
  const entry = parsed.value
  const status = terminal[entry.MESSAGE_ID as keyof typeof terminal]
  if (!status) return []
  const service = [entry.USER_UNIT, entry._SYSTEMD_USER_UNIT].find((unit) => unit && (!pattern || pattern.test(unit)))
  if (!service) return []
  const timestamp = finiteInteger(entry.__REALTIME_TIMESTAMP)
  const last = timestamp === undefined ? undefined : timestamp / 1000
  const invocation = entry.USER_INVOCATION_ID ?? entry._SYSTEMD_INVOCATION_ID ?? entry.__REALTIME_TIMESTAMP
  const taskID = /^opencode-task-[a-f0-9]{12}-(.+)\.service$/.exec(service)?.[1]
  return [
    {
      id: `${service}:${String(invocation)}`,
      taskID,
      source: "journal",
      status,
      title: taskID,
      service,
      last,
      result: entry.UNIT_RESULT,
      historical: true,
    },
  ]
}

export function journalEntries(lines: string[], sessionID: string): Info[] {
  const pattern = new RegExp(`^opencode-task-${sessionKey(sessionID)}-(.+)\\.service$`)
  const records = lines.flatMap((line) => journalEntry(line, pattern))
  const deduplicated = records.reduce((items, record) => {
    const previous = items.get(record.id)
    if (
      !previous ||
      (record.status === "failed" && previous.status !== "failed") ||
      (record.status === previous.status && (record.last ?? 0) > (previous.last ?? 0))
    ) {
      items.set(record.id, record)
    }
    return items
  }, new Map<string, Info>())
  return [...deduplicated.values()]
    .toSorted((left, right) => (right.last ?? 0) - (left.last ?? 0))
    .slice(0, 10)
}

export const node = makeGlobalNode({ service: Service, layer, deps: [FSUtil.node, CrossSpawnSpawner.node] })
export * as ScheduledTask from "./scheduled-task"
