import { formatMarkdownTables } from "./src/util/format-table"
const table = `| Wish | Current state | With OpenTUI + Bun |
|:-----|:--------------|:-------------------|
| **Cursor at selection** | ❌ Using \`█\` character | ✅ Native cursor positioning |
| **Blinking block cursor** | ❌ Hidden entirely | ✅ Can set cursor style \`\\x1b[1 q\` |
| **Hide cursor on focus loss** | ⚠️ Focus tracked but unused | ✅ Clean focus API |
| **remote-viewer survives exit** | ❌ Dies with TUI | ✅ \`detached: true\` works |
| **UI dimming on focus loss** | 🔜 Tracked but not implemented | ✅ Can implement cleanly |`
console.log(formatMarkdownTables(table))
