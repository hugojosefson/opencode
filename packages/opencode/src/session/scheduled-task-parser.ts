const metadataPattern = /(?:^|\s)opencode-scheduled-task:v1\s+session=([^\s]+)\s+task=([^\s]+)/

export function marker(text: string) {
  const found = metadataPattern.exec(text)
  if (!found) return
  return { sessionID: found[1], taskID: found[2] }
}

export function invocation(text: string) {
  const parsed = assignments(text)
  for (const line of logicalLines(mask(text, parsed.ranges))) {
    const words = shellWords(line).map((word) => expand(word, parsed.values))
    const command = words.findIndex((word) => word === "opencode" || word.endsWith("/opencode"))
    if (command === -1) continue
    const args = words.slice(command + 1)
    const session = sessionArgument(args)
    const run = args.indexOf("run")
    if (!session || run === -1 || run + 1 >= args.length) continue
    const input = args.slice(run + 1)
    const redirection = input.findIndex((word) => /^(?:\d?>|<|\||;|&)/.test(word))
    const prompt = input.slice(0, redirection === -1 ? undefined : redirection).join(" ")
    if (prompt) return { sessionID: session, prompt }
  }
}

export function properties(text: string) {
  return Object.fromEntries(
    text.split("\n").flatMap((line) => {
      const index = line.indexOf("=")
      return index < 1 ? [] : [[line.slice(0, index), line.slice(index + 1)]]
    }),
  )
}

export function triggeredService(value: string | undefined, timer: string) {
  const service = value?.split(/\s+/).find((unit) => unit.endsWith(".service"))
  return service ?? `${timer.slice(0, -6)}.service`
}

export function wrapperPath(execStart: string | undefined) {
  if (!execStart) return
  const argv = /argv\[\]=([\s\S]*?)(?:\s+;|$)/.exec(execStart)?.[1] ?? execStart
  const words = shellWords(argv)
  const command = words[0]
  if (!command?.startsWith("/")) return
  if (command === "/bin/sh" || command === "/bin/bash" || command === "/usr/bin/sh" || command === "/usr/bin/bash") {
    return words.slice(1).find((word) => word.startsWith("/") && !word.startsWith("/dev/"))
  }
  if (command.endsWith(".sh") || command.endsWith(".bash")) return command
}

export function schedule(properties: Record<string, string>) {
  return properties.TimersCalendar || properties.TimersMonotonic || undefined
}

export function timestamp(value: string | undefined) {
  if (!value) return
  const unix = /^@(\d+(?:\.\d+)?)$/.exec(value)
  const milliseconds = unix ? Number(unix[1]) * 1000 : /^\d+$/.test(value) ? Number(value) / 1000 : Date.parse(value)
  return Number.isFinite(milliseconds) ? milliseconds : undefined
}

export function promptTitle(prompt: string | undefined) {
  const first = prompt
    ?.split("\n")
    .map((line) => line.trim())
    .find(Boolean)
  if (!first) return
  return first.length <= 60 ? first : `${first.slice(0, 59)}…`
}

function assignments(text: string) {
  const values: Record<string, string> = {}
  const ranges: { start: number; end: number }[] = []
  const pattern = /(?:^|\n)\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*/g
  for (const match of text.matchAll(pattern)) {
    const start = (match.index ?? 0) + match[0].length
    const value = quoted(text, start)
    if (!value) continue
    values[match[1]] = value.value
    ranges.push({ start: match.index ?? 0, end: value.end })
  }
  return { values, ranges }
}

function mask(text: string, ranges: { start: number; end: number }[]) {
  const characters = [...text]
  for (const range of ranges) {
    for (let index = range.start; index < range.end; index++) {
      if (characters[index] !== "\n") characters[index] = " "
    }
  }
  return characters.join("")
}

function logicalLines(text: string) {
  return text.split("\n").reduce<string[]>((lines, physical) => {
    const previous = lines.at(-1)
    if (previous?.endsWith("\\")) {
      lines[lines.length - 1] = `${previous.slice(0, -1)} ${physical.trimStart()}`
      return lines
    }
    lines.push(physical)
    return lines
  }, [])
}

function quoted(text: string, start: number) {
  const quote = text[start]
  if (quote !== '"' && quote !== "'") return
  let value = ""
  for (let index = start + 1; index < text.length; index++) {
    const character = text[index]
    if (character === quote) return { value, end: index + 1 }
    if (character === "\\" && quote === '"' && index + 1 < text.length) {
      value += text[index + 1]
      index++
      continue
    }
    value += character
  }
}

function shellWords(text: string) {
  const words: string[] = []
  let word = ""
  let quote: '"' | "'" | undefined
  for (let index = 0; index < text.length; index++) {
    const character = text[index]
    if (quote) {
      if (character === quote) {
        quote = undefined
        continue
      }
      if (character === "\\" && quote === '"' && index + 1 < text.length) {
        word += text[++index]
        continue
      }
      word += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === "#" && !word) break
    if (/\s/.test(character)) {
      if (word) words.push(word)
      word = ""
      continue
    }
    if (character === "\\" && index + 1 < text.length) {
      word += text[++index]
      continue
    }
    word += character
  }
  if (word) words.push(word)
  return words
}

function expand(word: string, values: Record<string, string>) {
  return word.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (value, braced, plain) => {
    return values[braced ?? plain] ?? value
  })
}

function sessionArgument(args: string[]) {
  const long = args.find((arg) => arg.startsWith("--session="))
  if (long) return long.slice("--session=".length)
  const index = args.findIndex((arg) => arg === "--session" || arg === "-s")
  return index === -1 ? undefined : args[index + 1]
}

export * as ScheduledTaskParser from "./scheduled-task-parser"
