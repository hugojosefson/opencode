/**
 * Count characters that are concealed markdown markers.
 * These are hidden in TUI rendering, so shouldn't count toward display width.
 */
function countConcealedMarkers(str: string): number {
  let count = 0

  // Count `code` markers (2 backticks per code span)
  const codeMatches = str.match(/`[^`]+`/g) || []
  count += codeMatches.length * 2

  // Count **bold** markers (4 asterisks per bold span)
  const boldMatches = str.match(/\*\*[^*]+\*\*/g) || []
  count += boldMatches.length * 4

  // Count *italic* markers (2 asterisks per italic span) - but not inside bold
  const withoutBold = str.replace(/\*\*[^*]+\*\*/g, "")
  const italicMatches = withoutBold.match(/\*[^*]+\*/g) || []
  count += italicMatches.length * 2

  return count
}

/**
 * Calculate the display width of a string in terminal cells.
 * Most characters are 1 cell, but CJK, emoji, and some symbols are 2 cells.
 * Combining characters are 0 cells.
 */
function displayWidth(str: string): number {
  let width = 0
  for (const char of str) {
    const code = char.codePointAt(0)!
    width += charWidth(code)
  }
  // Subtract concealed markdown emphasis markers (asterisks were counted as 1 each in the loop)
  width -= countConcealedMarkers(str)
  return width
}

function charWidth(code: number): number {
  // Combining characters (zero width)
  if (
    (code >= 0x0300 && code <= 0x036f) || // Combining Diacritical Marks
    (code >= 0x1ab0 && code <= 0x1aff) || // Combining Diacritical Marks Extended
    (code >= 0x1dc0 && code <= 0x1dff) || // Combining Diacritical Marks Supplement
    (code >= 0x20d0 && code <= 0x20ff) || // Combining Diacritical Marks for Symbols
    (code >= 0xfe20 && code <= 0xfe2f) // Combining Half Marks
  ) {
    return 0
  }

  // Wide characters (2 cells)
  if (
    // CJK Unified Ideographs and extensions
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x20000 && code <= 0x2a6df) ||
    (code >= 0x2a700 && code <= 0x2b73f) ||
    (code >= 0x2b740 && code <= 0x2b81f) ||
    (code >= 0x2b820 && code <= 0x2ceaf) ||
    (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
    (code >= 0x2f800 && code <= 0x2fa1f) || // CJK Compatibility Ideographs Supplement
    // Japanese
    (code >= 0x3000 && code <= 0x303f) || // CJK Symbols and Punctuation
    (code >= 0x3040 && code <= 0x309f) || // Hiragana
    (code >= 0x30a0 && code <= 0x30ff) || // Katakana
    (code >= 0x31f0 && code <= 0x31ff) || // Katakana Phonetic Extensions
    // Korean
    (code >= 0xac00 && code <= 0xd7af) || // Hangul Syllables
    (code >= 0x1100 && code <= 0x11ff) || // Hangul Jamo
    (code >= 0x3130 && code <= 0x318f) || // Hangul Compatibility Jamo
    (code >= 0xa960 && code <= 0xa97f) || // Hangul Jamo Extended-A
    (code >= 0xd7b0 && code <= 0xd7ff) || // Hangul Jamo Extended-B
    // Full-width forms
    (code >= 0xff00 && code <= 0xff60) || // Full-width ASCII variants
    (code >= 0xffe0 && code <= 0xffe6) || // Full-width symbol variants
    // Emoji (common ranges)
    (code >= 0x1f300 && code <= 0x1f9ff) || // Miscellaneous Symbols and Pictographs, Emoticons, etc.
    (code >= 0x1fa00 && code <= 0x1faff) || // Chess, symbols, etc.
    (code >= 0x1f600 && code <= 0x1f64f) || // Emoticons
    (code >= 0x1f680 && code <= 0x1f6ff) || // Transport and Map Symbols
    (code >= 0x2700 && code <= 0x27bf) // Dingbats (✅ ❌ etc.)
  ) {
    return 2
  }

  return 1
}

// TODO: Make configurable if upstreamed - some users may prefer different replacements
const CHAR_REPLACEMENTS: Record<string, string> = {
  "⚠": "🔶", // Warning triangle → orange diamond (more visible)
}

export function formatMarkdownTables(markdown: string): string {
  // Strip variation selectors - they cause inconsistent width rendering
  markdown = markdown.replace(/[\uFE00-\uFE0F]/g, "")

  // Replace problematic characters
  for (const [from, to] of Object.entries(CHAR_REPLACEMENTS)) {
    markdown = markdown.replaceAll(from, to)
  }

  const lines = markdown.split("\n")
  const result: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Check if this could be start of a table
    if (!line.trimStart().startsWith("|")) {
      result.push(line)
      i++
      continue
    }

    // Collect potential table lines
    const table: string[] = []
    let j = i
    while (j < lines.length && lines[j].trimStart().startsWith("|")) {
      table.push(lines[j])
      j++
    }

    // Check if table is complete (followed by empty line or non-table content or EOF)
    const isComplete = j >= lines.length || !lines[j].trimStart().startsWith("|")

    // Find separator row
    const sepIndex = table.findIndex((row) => isSeparatorRow(row))

    // Not a valid table (no separator) or incomplete
    if (sepIndex === -1 || !isComplete) {
      for (const row of table) {
        result.push(row)
      }
      i = j
      continue
    }

    // Parse and format the table
    const formatted = formatTable(table, sepIndex)
    for (const row of formatted) {
      result.push(row)
    }
    i = j
  }

  return result.join("\n")
}

function isSeparatorRow(line: string): boolean {
  const cells = parseCells(line)
  if (cells.length === 0) return false
  return cells.every((cell) => /^:?-+:?$/.test(cell.trim()))
}

function parseCells(line: string): string[] {
  const trimmed = line.trim()
  // Remove leading/trailing pipes and split
  const inner = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed
  const content = inner.endsWith("|") ? inner.slice(0, -1) : inner
  return content.split("|").map((c) => c.trim())
}

function getAlignment(cell: string): "left" | "center" | "right" {
  const trimmed = cell.trim()
  const left = trimmed.startsWith(":")
  const right = trimmed.endsWith(":")
  if (left && right) return "center"
  if (right) return "right"
  return "left"
}

function formatTable(table: string[], sepIndex: number): string[] {
  // Parse all rows
  const rows = table.map(parseCells)

  // Get alignments from separator row
  const alignments = rows[sepIndex].map(getAlignment)

  // Calculate max width per column
  const colCount = Math.max(...rows.map((r) => r.length))
  const widths: number[] = Array(colCount).fill(3) // minimum width of 3 for separator

  for (let r = 0; r < rows.length; r++) {
    if (r === sepIndex) continue // skip separator for width calculation
    for (let c = 0; c < rows[r].length; c++) {
      widths[c] = Math.max(widths[c], displayWidth(rows[r][c]))
    }
  }

  // Format each row
  const formatted: string[] = []
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    const cells: string[] = []

    for (let c = 0; c < colCount; c++) {
      const content = row[c] ?? ""
      const width = widths[c]
      const align = alignments[c] ?? "left"

      if (r === sepIndex) {
        // Format separator cell
        cells.push(formatSeparator(width, align))
        continue
      }

      cells.push(padCell(content, width, align))
    }

    formatted.push("| " + cells.join(" | ") + " |")
  }

  return formatted
}

function formatSeparator(width: number, align: "left" | "center" | "right"): string {
  if (align === "center") return ":" + "-".repeat(width - 2) + ":"
  if (align === "right") return "-".repeat(width - 1) + ":"
  return ":" + "-".repeat(width - 1)
}

function padCell(content: string, width: number, align: "left" | "center" | "right"): string {
  const pad = width - displayWidth(content)
  if (pad <= 0) return content

  if (align === "right") return " ".repeat(pad) + content
  if (align === "center") {
    const left = Math.floor(pad / 2)
    const right = pad - left
    return " ".repeat(left) + content + " ".repeat(right)
  }
  return content + " ".repeat(pad)
}
