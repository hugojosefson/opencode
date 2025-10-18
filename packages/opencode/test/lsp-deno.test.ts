import { describe, it, expect } from "bun:test"
import { LSPServer } from "../src/lsp/server"
import { Instance } from "../src/project/instance"
import { mkdtemp, writeFile, rm } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"

describe("Deno LSP Detection", () => {
  it("should detect pure Deno project", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "deno-test-"))
    await writeFile(join(tmpDir, "deno.json"), '{"tasks": {"dev": "deno run main.ts"}}')
    await writeFile(join(tmpDir, "main.ts"), 'console.log("test")')

    const root = await Instance.provide({
      directory: tmpDir,
      fn: () => LSPServer.Deno.root(join(tmpDir, "main.ts")),
    })
    expect(root).toBe(tmpDir)

    await rm(tmpDir, { recursive: true })
  })

  it("should detect Deno via deno.jsonc", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "jsonc-test-"))
    await writeFile(join(tmpDir, "deno.jsonc"), "{}")
    await writeFile(join(tmpDir, "main.ts"), 'console.log("test")')

    const root = await Instance.provide({
      directory: tmpDir,
      fn: () => LSPServer.Deno.root(join(tmpDir, "main.ts")),
    })
    expect(root).toBe(tmpDir)

    await rm(tmpDir, { recursive: true })
  })

  it("should detect Deno in parent directory", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "parent-test-"))
    const subDir = join(tmpDir, "src")
    await writeFile(join(tmpDir, "deno.json"), '{"tasks": {"dev": "deno run src/main.ts"}}')
    const { mkdir } = await import("fs/promises")
    await mkdir(subDir, { recursive: true })
    await writeFile(join(subDir, "main.ts"), 'console.log("test")')

    const root = await Instance.provide({
      directory: tmpDir,
      fn: () => LSPServer.Deno.root(join(subDir, "main.ts")),
    })
    expect(root).toBe(tmpDir)

    await rm(tmpDir, { recursive: true })
  })

  it("should return undefined when no Deno config found", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "no-deno-test-"))
    await writeFile(join(tmpDir, "main.ts"), 'console.log("test")')

    const root = await Instance.provide({
      directory: tmpDir,
      fn: () => LSPServer.Deno.root(join(tmpDir, "main.ts")),
    })
    expect(root).toBe(undefined)

    await rm(tmpDir, { recursive: true })
  })
})
