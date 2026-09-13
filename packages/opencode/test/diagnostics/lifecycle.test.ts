import { expect, test } from "bun:test"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { Global } from "@opencode-ai/core/global"
import { recordLifecycle } from "../../src/diagnostics/lifecycle"
import { parseLifecycleRecord } from "../../src/diagnostics/lifecycle-record"
import { tmpdir } from "../fixture/fixture"

const launcher = path.resolve(import.meta.dir, "../../bin/opencode")

test("diagnostic export rejects unknown events and removes arbitrary text", () => {
  const record = { ts: "2026-09-13T15:28:51.587Z", app: "opencode", run: "0123456789abcdef", event: "stream-error" }
  expect(parseLifecycleRecord("not json")).toBeUndefined()
  expect(parseLifecycleRecord(JSON.stringify({ ...record, event: "private-event" }))).toBeUndefined()
  const safe = parseLifecycleRecord(
    JSON.stringify({
      ...record,
      text: "private-text",
      error: "private-error",
      signal: "private-signal",
      session: "private-session",
    }),
  )
  expect(safe).toMatchObject(record)
  expect(JSON.stringify(safe)).not.toContain("private-")
})

test("lifecycle records are immediate and contain no raw session or extra fields", async () => {
  const previous = process.env.OPENCODE_DIAGNOSTICS
  process.env.OPENCODE_DIAGNOSTICS = "1"
  try {
    const detail = { sessionID: "private-session-marker", summary: true, text: "private-content-marker" }
    recordLifecycle("stream-interrupt", detail)
    const file = path.join(Global.Path.log, "lifecycle.jsonl")
    const text = await readFile(file, "utf8")
    const record = JSON.parse(text.trim().split("\n").at(-1)!)
    expect(record.event).toBe("stream-interrupt")
    expect(record.summary).toBe(true)
    expect(record.session).toMatch(/^[a-f0-9]{16}$/)
    expect(record.rssMiB).toBeGreaterThan(0)
    expect(text).not.toContain("private-session-marker")
    expect(text).not.toContain("private-content-marker")
    expect((await stat(file)).mode & 0o777).toBe(0o600)
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_DIAGNOSTICS
    else process.env.OPENCODE_DIAGNOSTICS = previous
  }
})

async function start(script: string) {
  const directory = await tmpdir()
  const target = path.join(directory.path, "child")
  await Bun.write(target, "#!/usr/bin/env node\n" + script)
  await Bun.$`chmod +x ${target}`.quiet()
  const child = Bun.spawn([process.execPath, launcher, "private-argument-marker"], {
    env: {
      ...process.env,
      XDG_DATA_HOME: directory.path,
      OPENCODE_BIN_PATH: target,
      OPENCODE_DIAGNOSTICS: "1",
      DUMMY_SECRET: "private-environment-marker",
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  return {
    child,
    async [Symbol.asyncDispose]() {
      child.kill()
      await child.exited
      await directory[Symbol.asyncDispose]()
    },
    async records() {
      const text = await readFile(path.join(directory.path, "opencode/log/lifecycle.jsonl"), "utf8")
      expect(text).not.toContain("private-argument-marker")
      expect(text).not.toContain("private-environment-marker")
      expect(text).not.toContain(directory.path)
      return text
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    },
  }
}

test("launcher records and preserves a nonzero child exit", async () => {
  await using fixture = await start("process.exit(7)")
  expect(await fixture.child.exited).toBe(7)
  const records = await fixture.records()
  expect(records.map((item) => item.event)).toEqual(["process-spawn", "process-exit"])
  expect(records[1]).toMatchObject({ exitCode: 7, signal: null, run: records[0].run })
})

test("launcher records a child SIGKILL", async () => {
  await using fixture = await start('process.stdout.write(String(process.pid) + "\\n"); setInterval(() => {}, 1000)')
  const reader = fixture.child.stdout.getReader()
  const chunk = await reader.read()
  const pid = Number(new TextDecoder().decode(chunk.value).trim())
  expect(pid).toBeGreaterThan(0)
  process.kill(pid, "SIGKILL")
  await fixture.child.exited
  const records = await fixture.records()
  expect(records.at(-1)).toMatchObject({ event: "process-exit", exitCode: null, signal: "SIGKILL" })
})

test("launcher forwards and records SIGTERM", async () => {
  await using fixture = await start('process.stdout.write("ready\\n"); setInterval(() => {}, 1000)')
  const reader = fixture.child.stdout.getReader()
  await reader.read()
  fixture.child.kill("SIGTERM")
  await fixture.child.exited
  const records = await fixture.records()
  expect(records.map((item) => item.event)).toEqual(["process-spawn", "supervisor-signal", "process-exit"])
  expect(records[1].signal).toBe("SIGTERM")
  expect(records[2]).toMatchObject({ exitCode: null, signal: "SIGTERM" })
})
