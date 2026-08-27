# Handoff: live-refresh an open TUI after a cross-process session run

## Objective

Investigate and fix OpenCode so an already-open TUI displays messages added to
its session by another OpenCode process.

The external process successfully resumes the persisted session and completes a
model turn. The prompt and response appear after the TUI exits and reopens the
session, but the running TUI never displays them.

## Environment

- Linux desktop
- OpenCode built from this repository
- One interactive TUI process
- One separate `opencode run` process
- Both processes use the same project directory, configuration, database, and
  session ID
- Reproduced with the repository-built executable directly, without a shell
  wrapper

## Minimal reproduction

Use a disposable project and session. Do not use production data.

### Terminal A

Start OpenCode interactively:

```bash
opencode /tmp/opencode/live-session-test
```

Send one message so the session exists. Obtain its ID with:

```bash
opencode session list -n 5
```

Keep the TUI open on that session.

### Terminal B

Run a model turn against the same persisted session:

```bash
opencode run \
  --session <session-id> \
  --dir /tmp/opencode/live-session-test \
  "Reply with exactly: cross-process update received"
```

A timer is not required to reproduce the problem. If timing behavior matters,
run the same command with `systemd-run --user --on-active=1m`.

## Observed behavior

1. Terminal B runs successfully and prints `cross-process update received`.
2. `opencode session list` shows the session's updated timestamp.
3. Terminal A remains unchanged. It does not show either the externally added
   user message or assistant response.
4. Exit Terminal A and reopen the session:

   ```bash
   opencode --session <session-id>
   ```

5. The reopened TUI now shows both messages in the correct transcript position.

This proves persistence works. The failure is live synchronization into the
already-running TUI.

## Expected behavior

While Terminal A remains open, it should notice the durable session changes and
render the new user and assistant messages without requiring a restart.

At minimum, the UI should provide a clear supported way to refresh the active
session. Prefer automatic refresh because an unattended process may append a
message while the user is away.

Expected properties:

- no duplicate messages;
- stable ordering;
- no loss of in-progress local input;
- no interruption of a model turn already running in Terminal A;
- correct behavior when several durable messages arrive close together;
- eventual synchronization after the external process exits unexpectedly;
- no busy polling with significant idle CPU or database load.

## Important distinction

An earlier test failed before OpenCode started because a shell launcher depended
on a tool absent from systemd's `PATH`. Calling the repository-built OpenCode
executable directly fixed that test setup. That launcher failure is unrelated to
the live-refresh issue.

The successful test showed this sequence in the persisted transcript after
reopening:

```text
Timer test: reply with exactly: cross-process update received
cross-process update received
```

The same sequence was absent from the TUI while it remained open.

## Investigation leads

Do not assume the correct fix is a filesystem watcher. First identify the
intended process topology and event path.

Questions to answer:

1. Does interactive `opencode` host its own server and subscribe only to that
   process's event bus?
2. Does `opencode run --session` start another server, update the shared store,
   and publish events only inside its own process?
3. Can `opencode run --attach <url> --session <id>` already provide live updates
   through the interactive process's server? If so, is there a supported way for
   unattended local clients to discover and authenticate to that server?
4. Should the fix live in session storage notifications, server event replay,
   the TUI session subscription, or a supported local attach/discovery command?
5. How does the V2 session implementation reconcile externally persisted
   `session_input` and promoted messages with an active process-local runner?

Relevant architectural constraints are documented in `AGENTS.md`, especially
the V2 Session Core section. Preserve durable prompt admission, serialized
session execution, explicit delivery modes, and process-local execution
ownership.

Likely search areas:

```bash
rg 'SessionExecution|SessionRunCoordinator|session_input|EventV2' packages
rg 'session.updated|message.updated|subscribe|event' packages/opencode
rg 'attach|--attach|session list|sessionID' packages/opencode
rg 'replay|EventSource|SSE|websocket' packages
```

## Acceptance tests

Add an automated test at the lowest practical layer and a regression test that
represents two processes or two server instances sharing one session store.

Required cases:

1. Client A loads a session and begins listening.
2. Process or server B durably adds a user message and assistant response.
3. Client A receives or discovers both without reconnecting.
4. Repeated synchronization emits each message once.
5. Reconnecting and replaying events does not duplicate them.
6. A local draft in Client A survives the refresh.
7. Existing same-process streaming behavior remains unchanged.

If cross-process live refresh is intentionally unsupported, implement and test a
documented supported route for unattended callers to address the active local
server. It must be discoverable without scraping terminal output and safe when
more than one OpenCode process is running.

## Validation

Follow this repository's `AGENTS.md`.

- Run tests from the affected package, not the repository root.
- Run `bun typecheck` from the affected package.
- Run the narrow regression test during development.
- Run the package's applicable aggregate checks before committing.
- Re-run the two-terminal manual reproduction against the built executable.

## Non-goals

- Do not add desktop notifications as a substitute for transcript
  synchronization.
- Do not solve only the systemd launcher `PATH` problem.
- Do not weaken session serialization or permit two model runners to mutate one
  session concurrently without the existing coordination guarantees.
- Do not rely on private or organization-specific services, data, paths, or
  credentials in tests or documentation.

## Deliverable

Produce a focused branch, regression tests, implementation, and a concise PR
explaining the cross-process event path and why the fix cannot duplicate or
reorder messages.
