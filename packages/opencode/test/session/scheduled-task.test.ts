import { describe, expect, test } from "bun:test"
import { journalEntries, journalEntry, sessionKey } from "../../src/session/scheduled-task"
import {
  invocation,
  marker,
  properties,
  schedule,
  timestamp,
  triggeredService,
  wrapperPath,
} from "../../src/session/scheduled-task-parser"

describe("scheduled task discovery parsers", () => {
  test("reads the versioned description marker", () => {
    expect(marker("backup opencode-scheduled-task:v1 session=ses_123 task=nightly-1")).toEqual({
      sessionID: "ses_123",
      taskID: "nightly-1",
    })
  })

  test("recognizes literal session invocations", () => {
    expect(invocation('opencode -s ses_123 run "Review the pull request"')).toEqual({
      sessionID: "ses_123",
      prompt: "Review the pull request",
    })
  })

  test("resolves simple scheduling-skill shell variables without executing the script", () => {
    expect(
      invocation('session_id="ses_123"\nprompt="Review PR"\nopencode --session "${session_id}" run "${prompt}"'),
    ).toEqual({
      sessionID: "ses_123",
      prompt: "Review PR",
    })
  })

  test("keeps multiline prompts intact", () => {
    expect(
      invocation(
        'session_id="ses_123"\nprompt="Check status.\nReport failures plainly."\nexec opencode -s "$session_id" run "$prompt"',
      ),
    ).toEqual({
      sessionID: "ses_123",
      prompt: "Check status.\nReport failures plainly.",
    })
  })

  test("joins shell continuations and ignores output redirection", () => {
    expect(
      invocation(
        'session_id="ses_123"\nprompt="Check status"\nopencode --session "${session_id}" run \\\n  "${prompt}" \\\n  >"/work/result.log" 2>&1',
      ),
    ).toEqual({ sessionID: "ses_123", prompt: "Check status" })
  })

  test("ignores commented commands and command text inside prompt assignments", () => {
    expect(invocation('# opencode -s ses_123 run "not a task"')).toBeUndefined()
    expect(invocation('prompt="Instructions:\nopencode -s ses_123 run fake"')).toBeUndefined()
  })

  test("keeps systemctl property values intact", () => {
    expect(properties("Description=Daily task\nWorkingDirectory=/work/project\n")).toEqual({
      Description: "Daily task",
      WorkingDirectory: "/work/project",
    })
  })

  test("reads timer trigger and schedule properties", () => {
    expect(triggeredService("example.service", "fallback.timer")).toBe("example.service")
    expect(triggeredService(undefined, "fallback.timer")).toBe("fallback.service")
    expect(schedule({ TimersCalendar: "{ OnCalendar=Mon *-*-* 09:00:00 }" })).toBe("{ OnCalendar=Mon *-*-* 09:00:00 }")
  })

  test("reads numeric, unix, and human systemd timestamps", () => {
    expect(timestamp("1787929200000000")).toBe(1787929200000)
    expect(timestamp("@1787912100")).toBe(1787912100000)
    expect(timestamp("Fri 2026-08-28 15:00:00 UTC")).toBe(Date.UTC(2026, 7, 28, 15))
    expect(timestamp("[not set]")).toBeUndefined()
  })

  test("follows one directly invoked wrapper", () => {
    expect(wrapperPath("{ path=/usr/bin/bash ; argv[]=/usr/bin/bash /work/task.sh ; ignore_errors=no }")).toBe(
      "/work/task.sh",
    )
    expect(wrapperPath("{ path=/usr/bin/opencode ; argv[]=/usr/bin/opencode -s ses_123 run check }")).toBeUndefined()
  })

  test("uses the session hash convention for journal unit names", () => {
    expect(sessionKey("ses_123")).toBe("5be5e0e76c3c")
  })

  test("reads terminal lifecycle records without message content", () => {
    expect(
      journalEntry(
        JSON.stringify({
          MESSAGE_ID: "d9b373ed55a64feb8242e02dbe79a49c",
          USER_UNIT: "opencode-task-5be5e0e76c3c-check.service",
          USER_INVOCATION_ID: "invocation-1",
          UNIT_RESULT: "exit-code",
          __REALTIME_TIMESTAMP: "1787929200000000",
        }),
      ),
    ).toEqual([
      {
        id: "opencode-task-5be5e0e76c3c-check.service:invocation-1",
        taskID: "check",
        source: "journal",
        status: "failed",
        title: "check",
        service: "opencode-task-5be5e0e76c3c-check.service",
        last: 1787929200000,
        result: "exit-code",
        historical: true,
      },
    ])
  })

  test("keeps only terminal records from the requested session", () => {
    expect(
      journalEntries(
        [
          JSON.stringify({
            MESSAGE_ID: "ae8f7b866b0347b9af31fe1c80b127c0",
            USER_UNIT: "opencode-task-5be5e0e76c3c-check.service",
            USER_INVOCATION_ID: "invocation-1",
          }),
          JSON.stringify({
            MESSAGE_ID: "ae8f7b866b0347b9af31fe1c80b127c0",
            _SYSTEMD_USER_UNIT: "opencode-task-000000000000-other.service",
            _SYSTEMD_INVOCATION_ID: "invocation-2",
          }),
        ],
        "ses_123",
      ),
    ).toEqual([expect.objectContaining({ service: "opencode-task-5be5e0e76c3c-check.service", status: "succeeded" })])
  })

  test("deduplicates lifecycle records and preserves failure", () => {
    expect(
      journalEntries(
        [
          JSON.stringify({
            MESSAGE_ID: "ae8f7b866b0347b9af31fe1c80b127c0",
            USER_UNIT: "opencode-task-5be5e0e76c3c-check.service",
            USER_INVOCATION_ID: "invocation-1",
            __REALTIME_TIMESTAMP: "1787929200000000",
          }),
          JSON.stringify({
            MESSAGE_ID: "d9b373ed55a64feb8242e02dbe79a49c",
            USER_UNIT: "opencode-task-5be5e0e76c3c-check.service",
            USER_INVOCATION_ID: "invocation-1",
            __REALTIME_TIMESTAMP: "1787929100000000",
          }),
        ],
        "ses_123",
      ),
    ).toEqual([expect.objectContaining({ status: "failed", last: 1787929100000 })])
  })
})
