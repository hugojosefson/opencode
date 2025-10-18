# Deno LSP Implementation Plan

## Problem

OpenCode supports TypeScript files through the TypeScript LSP server but lacks
Deno-specific language server integration. Deno projects require different
module resolution, runtime APIs, and type checking than Node.js/npm TypeScript
projects.

Deno LSP supports a comprehensive range of file types including full language
server features for TypeScript/JavaScript files, formatting for JSON/Markdown,
and support for web technologies and other formats. Adding Deno LSP support will
provide proper language services for Deno projects.

## Implementation Steps

### Step 1: Add Deno LSP server configuration

**File**: `packages/opencode/src/lsp/server.ts`

**Location**: Add the new `Deno` export after line 758 (after the `JDTLS` export, before the closing brace of the namespace)

**Required imports**: No additional imports needed (path and spawn already imported)

Add the complete Deno LSP server definition:

```typescript
// Simple Deno project detection function
function DenoProjectRoot() {
  return async (file: string) => {
    if (!Bun.which("deno")) {
      return null
    }
    let current = path.dirname(file)

    // Search upward for configuration files
    while (current !== path.dirname(current)) {
      const denoJson = path.join(current, "deno.json")
      const denoJsonc = path.join(current, "deno.jsonc")

      // Check for Deno configuration files
      const hasDenoJson = await Bun.file(denoJson).exists()
      const hasDenoJsonc = await Bun.file(denoJsonc).exists()

      if (hasDenoJson || hasDenoJsonc) {
        log.info("Deno project detected", { dir: current, hasDenoJson, hasDenoJsonc })
        return current
      }

      current = path.dirname(current)
    }

    // Check root directory
    const denoJson = path.join(current, "deno.json")
    const denoJsonc = path.join(current, "deno.jsonc")
    const hasDenoJson = await Bun.file(denoJson).exists()
    const hasDenoJsonc = await Bun.file(denoJsonc).exists()

    if (hasDenoJson || hasDenoJsonc) {
      log.info("Deno project detected in root", { dir: current, hasDenoJson, hasDenoJsonc })
      return current
    }

    log.info("No Deno project detected", { startFile: file })
    return null
  }
}

export const Deno: Info = {
  id: "deno",
  root: DenoProjectRoot(),
  extensions: [
    // Full language server features
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".mts",
    ".cts",
    ".dts",
    ".dmts",
    ".dcts",
    // Formatting and basic support
    ".json",
    ".jsonc",
    ".markdown",
    ".md",
    // Additional supported languages
    ".html",
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".yaml",
    ".yml",
    ".sql",
    ".svelte",
    ".vue",
    ".astro",
    ".vto",
    ".njk",
  ],
  async spawn(root) {
    const deno = Bun.which("deno")
    if (!deno) {
      log.error("Deno is required to run Deno LSP. Please install Deno first.")
      return
    }

    log.info("Spawning Deno LSP server", { root, denoPath: deno })

    return {
      process: spawn(deno, ["lsp"], {
        cwd: root,
      }),
      initialization: {
        enable: true,
        lint: true,
        unstable: false,
        config: null,
        importMap: null,
        codeLens: {
          implementations: true,
          references: true,
        },
      },
    }
  },
}
```

**Error handling details**: The function includes basic error handling for:

- File system errors when checking for configuration files
- Missing Deno binary (returns undefined from spawn)

**Logging for debugging**: Detection decisions are logged with context:

- Which configuration files were found
- Final detection results

### Step 2: Update documentation

**File**: `packages/web/src/content/docs/lsp.mdx`

**Location**: Add to the built-in LSP servers table after line 28 (after the `jdtls` row, before the closing table)

Add this row to the table:

```markdown
| deno | .ts, .tsx, .js, .jsx, .mjs, .cjs, .mts, .cts, .dts, .json, .jsonc, .md, .html, .css, .scss, .sass, .less, .yaml, .sql, .svelte, .vue, .astro | Deno installation |
```

**Location**: Add complete section after line 34 (after the note about LSP downloads)

Add new section explaining Deno detection:

````markdown
### Deno LSP Detection

OpenCode uses a simple algorithm to detect Deno projects:

**Deno project detection:**

- Searches for `deno.json` or `deno.jsonc` files in the current directory and parent directories
- When either file is found, Deno LSP is activated for the project

**Manual override:**
If the automatic detection doesn't work for your project, you can manually enable Deno LSP:

```json title="opencode.json"
{
  "lsp": {
    "deno": {
      "disabled": false
    }
  }
}
```
````

### Step 3: Testing approach

Create test files to verify the detection algorithm works correctly:

**Test scenarios to verify:**

1. **Pure Deno project detection** - Create test directory with:

   ```bash
   mkdir test-deno-pure
   cd test-deno-pure
   echo '{"tasks": {"dev": "deno run main.ts"}}' > deno.json
   echo 'console.log("Hello Deno")' > main.ts
   ```

2. **Deno project with deno.jsonc** - Create test directory with:
   ```bash
   mkdir test-deno-jsonc
   cd test-deno-jsonc
   echo '{}' > deno.jsonc
   echo 'console.log("Deno with jsonc")' > main.ts
   ```

````

2. **Mixed environment with deno.jsonc** - Create test directory with:

   ```bash
   mkdir test-deno-mixed-jsonc
   cd test-deno-mixed-jsonc
   echo '{}' > deno.jsonc
   echo '{"dependencies": {"express": "^4.0.0"}}' > package.json
   echo 'console.log("Mixed environment")' > main.ts
   ```

3. **Mixed environment preferring Node.js** - Create test directory with:

   ```bash
   mkdir test-node-preferred
   cd test-node-preferred
   echo '{"compilerOptions": {"target": "ES2022"}}' > deno.json  # No Deno-specific config
   echo '{"dependencies": {"express": "^4.0.0"}}' > package.json
   echo 'console.log("Node.js project")' > main.ts
   ```

4. **Deno with explicit Node.js disable** - Create test directory with:
   ```bash
   mkdir test-deno-explicit
   cd test-deno-explicit
   echo '{"nodeModulesDir": false, "imports": {"std/": "https://deno.land/std/"}}' > deno.json
   echo '{"dependencies": {"express": "^4.0.0"}}' > package.json
   echo 'console.log("Explicit Deno")' > main.ts
   ```

**Testing commands:**

```bash
# Test each scenario
cd test-deno-pure && opencode main.ts  # Should use Deno LSP
cd test-deno-jsonc && opencode main.ts  # Should use Deno LSP
```

**Verification steps:**

1. Check OpenCode logs for detection decisions
2. Verify correct LSP server is spawned
3. Test that diagnostics work appropriately for each environment
4. Confirm import resolution matches the detected environment

### Step 4: Edge cases and potential issues

**Known edge cases to test:**

1. **Configuration files**:
   - Both `deno.json` and `deno.jsonc` should trigger Deno LSP
   - Malformed config files should be handled gracefully

2. **File system permission errors**:
   - Unreadable config files should be handled gracefully
   - Detection should continue searching parent directories

3. **Nested project structures**:
   - Deno config in parent directory should be found

4. **Missing Deno binary**:
   - Should log clear error message
   - Should not crash OpenCode

**Performance considerations:**

- File system operations are async
- Detection stops at first found configuration file
- Search is limited to directory tree traversal

### Step 5: Configuration validation

**No changes needed** to `packages/opencode/src/config/config.ts` because:

- Line 517: `const serverIds = new Set(Object.values(LSPServer).map((s) => s.id))`
- This automatically includes any new exports from the `LSPServer` namespace
- The `Deno` export will be automatically discovered and validated

**No changes needed** to `packages/opencode/src/lsp/index.ts` because:

- Line 60-62: `for (const server of Object.values(LSPServer)) { servers[server.id] = server }`
- This automatically discovers all exported servers
- The priority handling is managed by the `root` function returning `null` when not appropriate

## Testing and verification plan

### Manual testing checklist

1. **Installation verification:**
   - [ ] Verify Deno is installed: `deno --version`
   - [ ] Test Deno LSP directly: `deno lsp` (should start LSP server)

2. **Detection algorithm testing:**
   - [ ] Create each test scenario directory structure
   - [ ] Run OpenCode on test files
   - [ ] Verify correct LSP server is chosen via logs
   - [ ] Test file operations (hover, diagnostics) work correctly

3. **Integration testing:**
   - [ ] Test with real Deno projects (Fresh, Oak, etc.)
   - [ ] Verify no regressions in existing TypeScript projects

4. **Error handling testing:**
   - [ ] Test without Deno installed
   - [ ] Test with corrupted config files

5. **Documentation verification:**
   - [ ] Verify table formatting in docs
   - [ ] Test manual override configuration examples

### Automated testing approach

**Unit tests** (add to existing test suite):

```typescript
// packages/opencode/test/lsp-deno.test.ts
import { describe, it, expect } from "bun:test"
import { LSPServer } from "../src/lsp/server"
import { mkdtemp, writeFile, rm } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"

describe("Deno LSP Detection", () => {
  it("should detect pure Deno project", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "deno-test-"))
    await writeFile(join(tmpDir, "deno.json"), '{"tasks": {"dev": "deno run main.ts"}}')
    await writeFile(join(tmpDir, "main.ts"), 'console.log("test")')

    const root = await LSPServer.Deno.root(join(tmpDir, "main.ts"))
    expect(root).toBe(tmpDir)

    await rm(tmpDir, { recursive: true })
  })

  it("should detect Deno via deno.jsonc", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "jsonc-test-"))
    await writeFile(join(tmpDir, "deno.jsonc"), "{}")
    await writeFile(join(tmpDir, "main.ts"), 'console.log("test")')

    const root = await LSPServer.Deno.root(join(tmpDir, "main.ts"))
    expect(root).toBe(tmpDir)

    await rm(tmpDir, { recursive: true })
  })
})
```

**Integration tests**:

```bash
# Add to CI pipeline - test with real projects
git clone https://github.com/denoland/fresh.git test-fresh
cd test-fresh
opencode routes/index.tsx  # Should detect Deno LSP
# Verify diagnostics work correctly
```

## Implementation checklist

### Code changes

- [ ] Add Deno LSP server definition to `packages/opencode/src/lsp/server.ts` (lines 759+)
- [ ] Add logging statements for debugging detection decisions

### Documentation updates

- [ ] Add Deno row to LSP servers table in `packages/web/src/content/docs/lsp.mdx`
- [ ] Add "Deno LSP Detection" section with detection algorithm explanation

### Testing

- [ ] Create manual test scenarios for each detection case
- [ ] Add automated unit tests for detection algorithm
- [ ] Test integration with real Deno projects
- [ ] Verify no regressions in existing TypeScript projects

### Validation

- [ ] Verify config validation automatically includes new server
- [ ] Test manual configuration override works
- [ ] Confirm error handling for missing Deno binary
- [ ] Validate logging provides sufficient debugging information

## Final implementation notes

**Simple approach benefits:**

- Clear detection criteria based on configuration file presence
- No conflicts with existing TypeScript workflows
- Straightforward debugging via logging
- Manual override available when needed

**Expected behavior after implementation:**

- Projects with `deno.json` or `deno.jsonc` files use Deno LSP
- Clear logging shows detection decisions for troubleshooting
- Manual override available via configuration when needed
- Comprehensive file type support matching Deno LSP capabilities

The implementation prioritizes simplicity and reliability by detecting Deno projects
based on the presence of Deno configuration files, while providing comprehensive
language support for all file types that Deno LSP handles.
````
