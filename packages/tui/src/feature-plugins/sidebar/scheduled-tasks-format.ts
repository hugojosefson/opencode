import type { SessionScheduledTaskResponse } from "@opencode-ai/sdk/v2"

export type ScheduledTask = SessionScheduledTaskResponse[number]

export function taskTitle(task: ScheduledTask) {
  return task.title || task.taskID || task.timer || task.service || "Scheduled task"
}

export function formatTaskTime(value: ScheduledTask["next"] | ScheduledTask["last"], now = new Date()) {
  if (typeof value !== "number" || !Number.isFinite(value)) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""

  const difference = date.getTime() - now.getTime()
  if (difference > 0 && difference < 60 * 60 * 1000) return `in ${Math.max(1, Math.ceil(difference / 60_000))}m`
  if (difference < 0 && difference > -60 * 60 * 1000) return `${Math.max(1, Math.ceil(-difference / 60_000))}m ago`

  const time = date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
  if (date.toDateString() === now.toDateString()) return `today ${time}`

  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  if (date.toDateString() === tomorrow.toDateString()) return `tomorrow ${time}`

  const days = Math.floor(Math.abs(difference) / 86_400_000)
  if (days < 7) return `${date.toLocaleDateString("en-US", { weekday: "short" })} ${time}`
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function taskDetail(task: ScheduledTask, now = new Date()) {
  const lines = [
    `Status: ${task.status}`,
    task.schedule ? `Schedule: ${task.schedule}` : undefined,
    task.next ? `Next: ${formatTaskTime(task.next, now)}` : undefined,
    task.last ? `Last: ${formatTaskTime(task.last, now)}` : undefined,
    task.timer ? `Timer: ${task.timer}` : undefined,
    task.service ? `Service: ${task.service}` : undefined,
    task.workingDirectory ? `Directory: ${task.workingDirectory}` : undefined,
    task.exitStatus !== undefined ? `Exit status: ${task.exitStatus}` : undefined,
    task.result ? `Result: ${task.result}` : undefined,
    task.prompt ? `Prompt:\n${task.prompt}` : undefined,
  ]
  return lines.filter((line): line is string => line !== undefined).join("\n")
}
