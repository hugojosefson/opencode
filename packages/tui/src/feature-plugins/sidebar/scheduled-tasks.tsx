import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { useBindings } from "../../keymap"
import { Locale } from "../../util/locale"
import { formatTaskTime, taskDetail, taskTitle, type ScheduledTask } from "./scheduled-tasks-format"

const id = "internal:sidebar-scheduled-tasks"

function statusColor(api: TuiPluginApi, status: ScheduledTask["status"]) {
  if (status === "succeeded") return api.theme.current.success
  if (status === "failed") return api.theme.current.error
  if (status === "running") return api.theme.current.warning
  if (status === "scheduled") return api.theme.current.primary
  return api.theme.current.textMuted
}

function statusIcon(status: ScheduledTask["status"]) {
  if (status === "succeeded") return "✓"
  if (status === "failed") return "×"
  if (status === "running") return "●"
  if (status === "scheduled") return "○"
  return "?"
}

function showDetails(api: TuiPluginApi, task: ScheduledTask) {
  api.ui.dialog.replace(() => <api.ui.DialogAlert title={taskTitle(task)} message={taskDetail(task)} />)
}

function showPicker(api: TuiPluginApi, tasks: ScheduledTask[]) {
  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect
      title="Scheduled tasks"
      options={tasks.map((task) => ({
        title: taskTitle(task),
        description: task.historical ? formatTaskTime(task.last) : formatTaskTime(task.next),
        value: task,
      }))}
      onSelect={(option) => showDetails(api, option.value)}
    />
  ))
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const [tasks, setTasks] = createSignal<ScheduledTask[]>([])
  const [open, setOpen] = createSignal(true)
  const theme = () => props.api.theme.current
  let generation = 0
  let mounted = true

  async function refresh(showError = false) {
    const request = ++generation
    try {
      const result = await props.api.client.session.scheduledTask(
        { sessionID: props.session_id },
        { throwOnError: true },
      )
      const next =
        result.data?.toSorted(
          (left, right) =>
            (left.next ?? left.last ?? Number.POSITIVE_INFINITY) -
            (right.next ?? right.last ?? Number.POSITIVE_INFINITY),
        ) ?? []
      if (mounted && request === generation) setTasks(next)
      return next
    } catch (error) {
      if (showError && mounted) {
        props.api.ui.toast({
          title: "Scheduled tasks",
          message: error instanceof Error ? error.message : "Could not load scheduled tasks",
          variant: "error",
        })
      }
      return
    }
  }

  useBindings(() => ({
    commands: [
      {
        name: "session.scheduled_tasks",
        title: "Scheduled tasks",
        category: "Session",
        namespace: "palette",
        run: async () => {
          const next = await refresh(true)
          if (!next) return
          if (next.length > 0) {
            showPicker(props.api, next)
            return
          }
          props.api.ui.toast({ message: "No scheduled tasks for this session", variant: "info" })
        },
      },
    ],
  }))

  void refresh()
  const timer = setInterval(() => void refresh(), 15_000)
  onCleanup(() => {
    mounted = false
    generation++
    clearInterval(timer)
  })

  const overview = createMemo(() => {
    const active = tasks().filter((task) => !task.historical).length
    const next = tasks()
      .filter((task) => !task.historical && typeof task.next === "number")
      .toSorted((left, right) => (left.next ?? 0) - (right.next ?? 0))[0]
    const latest = tasks()
      .filter((task) => task.historical)
      .toSorted((left, right) => (right.last ?? 0) - (left.last ?? 0))[0]
    const parts = [
      active === 1 ? "1 active" : `${active} active`,
      next?.next ? `next ${formatTaskTime(next.next)}` : undefined,
      latest?.last ? `last ${latest.status} ${formatTaskTime(latest.last)}` : undefined,
    ]
    return parts.filter((part): part is string => part !== undefined).join(" · ")
  })

  return (
    <box>
      <Show when={tasks().length > 0}>
        <box>
          <box flexDirection="row" gap={1} onMouseDown={() => setOpen((value) => !value)}>
            <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
            <box>
              <text fg={theme().text}>
                <b>Scheduled tasks</b>
              </text>
              <text fg={theme().textMuted} wrapMode="none">
                {Locale.truncate(overview(), 34)}
              </text>
            </box>
          </box>
          <Show when={open()}>
            <For each={tasks()}>
              {(task) => (
                <box flexDirection="row" gap={1} onMouseUp={() => showDetails(props.api, task)}>
                  <text flexShrink={0} fg={statusColor(props.api, task.status)}>
                    {statusIcon(task.status)}
                  </text>
                  <text flexGrow={1} fg={theme().text} overflow="hidden" wrapMode="none">
                    {Locale.truncate(taskTitle(task), 20)}
                  </text>
                  <text flexShrink={0} fg={theme().textMuted} wrapMode="none">
                    {task.historical ? formatTaskTime(task.last) : formatTaskTime(task.next)}
                  </text>
                </box>
              )}
            </For>
          </Show>
        </box>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 450,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
