import path from "node:path"
import { Global } from "@opencode-ai/core/global"
import { parseLifecycleRecord } from "@/diagnostics/lifecycle-record"
import { cmd } from "../cmd"

export const LifecycleCommand = cmd({
  command: "lifecycle",
  describe: "show restricted cancellation and process records",
  builder: (yargs) =>
    yargs
      .option("since", { type: "string" })
      .option("until", { type: "string" })
      .option("limit", { type: "number", default: 200 }),
  async handler(args) {
    const since = args.since === undefined ? -Infinity : Date.parse(args.since)
    const until = args.until === undefined ? Infinity : Date.parse(args.until)
    if (
      Number.isNaN(since) ||
      Number.isNaN(until) ||
      since > until ||
      !Number.isInteger(args.limit) ||
      args.limit < 1
    ) {
      throw new Error("Invalid diagnostic interval or limit")
    }
    const file = Bun.file(path.join(Global.Path.log, "lifecycle.jsonl"))
    if (!(await file.exists())) return
    const records = (
      await file.text().catch(() => {
        throw new Error("Cannot read lifecycle diagnostics")
      })
    )
      .split("\n")
      .flatMap((line) => {
        const record = parseLifecycleRecord(line)
        if (!record) return []
        const time = Date.parse(record.ts)
        return time >= since && time <= until ? [record] : []
      })
    for (const record of records.slice(-args.limit)) console.log(JSON.stringify(record))
  },
})
