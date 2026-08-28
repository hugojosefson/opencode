/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { TuiPluginApi, TuiPluginMeta, TuiSlotContext, TuiSlotMap } from "@opencode-ai/plugin/tui"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createSlot, createSolidSlotRegistry, testRender, useRenderer } from "@opentui/solid"
import scheduledTasksPlugin from "../../../src/feature-plugins/sidebar/scheduled-tasks"
import { OpencodeKeymapProvider } from "../../../src/keymap"
import { createTuiPluginApi } from "../../fixture/tui-plugin"

type Slots = TuiSlotMap<Record<string, object>>

test("scheduled tasks appear after the initial request", async () => {
  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const base = createTuiPluginApi({
      keymap,
      client: {
        session: {
          scheduledTask: async () => ({
            data: [
              {
                id: "task-1",
                source: "metadata",
                status: "scheduled",
                title: "First task",
                next: 3_000,
                historical: false,
              },
              {
                id: "task-2",
                source: "metadata",
                status: "scheduled",
                title: "Second task",
                next: 1_000,
                historical: false,
              },
              {
                id: "task-3",
                source: "metadata",
                status: "scheduled",
                title: "Third task",
                next: 2_000,
                historical: false,
              },
            ],
          }),
        },
      } as unknown as TuiPluginApi["client"],
    })
    const registry = createSolidSlotRegistry<Slots, TuiSlotContext>(renderer, { theme: base.theme })
    const Slot = createSlot(registry)
    const register = ((plugin: Parameters<TuiPluginApi["slots"]["register"]>[0]) => {
      registry.register({ ...plugin, id: pluginMeta.id } as unknown as Parameters<typeof registry.register>[0])
      return pluginMeta.id
    }) as unknown as TuiPluginApi["slots"]["register"]
    const api = {
      ...base,
      renderer,
      slots: { register },
    } satisfies TuiPluginApi

    void scheduledTasksPlugin.tui(api, undefined, pluginMeta)
    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <Slot name="sidebar_content" session_id="ses_test" />
      </OpencodeKeymapProvider>
    )
  }

  const app = await testRender(() => <Harness />, { width: 40, height: 10 })
  try {
    await app.waitForFrame((frame) => frame.includes("Second task"))
    const frame = app.captureCharFrame()
    expect(frame).toContain("3 active")
    expect(frame.indexOf("Second task")).toBeLessThan(frame.indexOf("Third task"))
    expect(frame.indexOf("Third task")).toBeLessThan(frame.indexOf("First task"))
  } finally {
    app.renderer.destroy()
  }
})

const pluginMeta = {
  id: "scheduled-tasks-test",
  source: "internal",
  spec: "scheduled-tasks-test",
  target: "scheduled-tasks-test",
  first_time: 0,
  last_time: 0,
  time_changed: 0,
  load_count: 1,
  fingerprint: "test",
  state: "same",
} satisfies TuiPluginMeta
