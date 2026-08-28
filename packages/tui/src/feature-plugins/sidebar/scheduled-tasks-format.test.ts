import { expect, test } from "bun:test"
import { formatTaskTime, taskDetail, taskTitle, type ScheduledTask } from "./scheduled-tasks-format"

const now = new Date(2026, 7, 28, 15, 0)

test("formats scheduled task times compactly", () => {
  expect(formatTaskTime(now.getTime() + 12 * 60_000, now)).toBe("in 12m")
  expect(formatTaskTime(now.getTime() + 90 * 60_000, now)).toBe("today 16:30")
  expect(formatTaskTime(new Date(2026, 7, 31, 16, 30).getTime(), now)).toBe("Mon 16:30")
  expect(formatTaskTime(new Date(2026, 8, 8, 16, 30).getTime(), now)).toBe("Sep 8")
  expect(formatTaskTime(now.getTime() - 12 * 60_000, now)).toBe("12m ago")
})

test("uses a useful fallback title and includes task details", () => {
  const task = {
    id: "task-1",
    source: "metadata",
    status: "scheduled",
    timer: "opencode-task.timer",
    schedule: "daily",
    prompt: "Check the build",
    workingDirectory: "/work",
    historical: false,
  } satisfies ScheduledTask

  expect(taskTitle(task)).toBe("opencode-task.timer")
  expect(taskDetail(task, now)).toBe(
    "Status: scheduled\nSchedule: daily\nTimer: opencode-task.timer\nDirectory: /work\nPrompt:\nCheck the build",
  )
})
