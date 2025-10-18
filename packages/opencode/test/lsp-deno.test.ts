import { describe, it, expect } from "bun:test"
import { Deno } from "../src/lsp/server"
import type { InstanceContext } from "../src/project/instance-context"
import { ProjectID } from "@opencode-ai/schema/project-id"
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

function context(directory: string): InstanceContext {
  return {
    directory,
    worktree: directory,
    project: {
      id: ProjectID.make(directory),
      worktree: directory,
      time: { created: 0, updated: 0 },
      sandboxes: [],
    },
  }
}

describe("Deno LSP Detection", () => {
  it("should detect pure Deno project", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "deno-test-"))
    await writeFile(join(tmpDir, "deno.json"), '{"tasks": {"dev": "deno run main.ts"}}')
    await writeFile(join(tmpDir, "main.ts"), 'console.log("test")')

    const root = await Deno.root(join(tmpDir, "main.ts"), context(tmpDir))
    expect(root).toBe(tmpDir)

    await rm(tmpDir, { recursive: true })
  })

  it("should detect Deno via deno.jsonc", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "jsonc-test-"))
    await writeFile(join(tmpDir, "deno.jsonc"), "{}")
    await writeFile(join(tmpDir, "main.ts"), 'console.log("test")')

    const root = await Deno.root(join(tmpDir, "main.ts"), context(tmpDir))
    expect(root).toBe(tmpDir)

    await rm(tmpDir, { recursive: true })
  })

  it("should detect Deno in parent directory", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "parent-test-"))
    const subDir = join(tmpDir, "src")
    await writeFile(join(tmpDir, "deno.json"), '{"tasks": {"dev": "deno run src/main.ts"}}')
    await mkdir(subDir, { recursive: true })
    await writeFile(join(subDir, "main.ts"), 'console.log("test")')

    const root = await Deno.root(join(subDir, "main.ts"), context(tmpDir))
    expect(root).toBe(tmpDir)

    await rm(tmpDir, { recursive: true })
  })

  it("should return undefined when no Deno config found", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "no-deno-test-"))
    await writeFile(join(tmpDir, "main.ts"), 'console.log("test")')

    const root = await Deno.root(join(tmpDir, "main.ts"), context(tmpDir))
    expect(root).toBe(undefined)

    await rm(tmpDir, { recursive: true })
  })
})
