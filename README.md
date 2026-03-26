# Edictum for OpenClaw

**One command. Zero code changes. Full contract enforcement.**

Runtime contract enforcement for OpenClaw AI agent tool calls. Install the plugin and every tool call is governed by a 770-line security contract bundle — blocking exfiltration, credential theft, destructive commands, prompt injection, and more.

## Install

### Path 1: One command (recommended)

```bash
openclaw plugins install @edictum/openclaw
```

Done. All 25 contracts active. No code changes.

### Path 2: Manual wiring (advanced)

```bash
pnpm add @edictum/core @edictum/openclaw
```

```typescript
import { Edictum } from '@edictum/core'
import { createEdictumPlugin } from '@edictum/openclaw'

const guard = Edictum.fromYaml('contracts/openclaw-governance.yaml')
const plugin = createEdictumPlugin(guard)
```

Or use the adapter directly for full control:

```typescript
import { Edictum } from '@edictum/core'
import { EdictumOpenClawAdapter } from '@edictum/openclaw'

const guard = Edictum.fromYaml('contracts/openclaw-governance.yaml')
const adapter = new EdictumOpenClawAdapter(guard, {
  onDeny: (envelope, reason) => console.error(`[edictum] denied: ${reason}`),
})
```

## What It Does

Edictum enforces **contracts** — declarative YAML rules evaluated before and after every tool call. Unlike prompt-based guardrails, contracts cannot be talked past by the LLM.

When a tool call violates a contract, Edictum **denies it** before execution and logs an audit event. No data leaves, no file is deleted, no credential is exposed.

## What's Included

The plugin ships with `openclaw-governance.yaml` — a curated bundle of 25 contracts covering 11 security categories:

| Category | What it blocks |
|----------|---------------|
| Data exfiltration | Leaking files, env vars, or credentials via exec/fetch/message |
| Credential theft | Reading `.env`, secrets, auth tokens, SSH keys |
| Destructive commands | `rm -rf /`, `DROP TABLE`, `FORMAT`, disk wipes |
| Prompt injection | Control characters, instruction override attempts in tool args |
| Unauthorized network | Fetching from non-allowlisted domains, DNS exfiltration |
| Privilege escalation | `sudo`, `chmod 777`, SUID bit manipulation |
| Session hijacking | Cross-session tool call replay, session fixation |
| Supply chain | `curl | bash`, untrusted package installs, pip/npm script injection |
| Sandbox escape | Container breakout patterns, `/proc` access, namespace manipulation |
| Persistence | Crontab modification, startup script injection, backdoor installation |
| Reconnaissance | Port scanning, network enumeration, system fingerprinting |

## Configuration

Configure in your OpenClaw config under `plugins.entries.edictum`:

```json
{
  "plugins": {
    "entries": {
      "edictum": {
        "mode": "enforce",
        "contractsPath": "/path/to/custom-contracts.yaml"
      }
    }
  }
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable the plugin |
| `mode` | `"enforce"` \| `"observe"` | `"enforce"` | Enforce blocks violations; observe logs without blocking |
| `contractsPath` | string | bundled YAML | Path to a custom contract bundle |
| `serverUrl` | string | — | Edictum Console URL for HITL approvals and audit feeds |
| `apiKey` | string | — | API key for Console connection |
| `agentId` | string | — | Agent identifier for Console fleet monitoring |

### Connect to Edictum Console

For hot-reload contracts, fleet monitoring, and HITL approvals, connect to a running [Edictum Console](https://github.com/edictum-ai/edictum-console) instance:

```bash
pnpm add @edictum/server
```

```json
{
  "plugins": {
    "entries": {
      "edictum": {
        "serverUrl": "https://console.example.com",
        "apiKey": "edk_production_...",
        "agentId": "my-openclaw-agent"
      }
    }
  }
}
```

When `serverUrl` and `apiKey` are configured, the plugin connects to Console instead of loading local contracts. If `@edictum/server` is not installed or the connection fails, you get a clear error message.

Without server config, the plugin uses the bundled `openclaw-governance.yaml` — no network required.

### Observe Mode

Start in observe mode to audit what would be denied without interrupting your workflow:

```json
{
  "plugins": {
    "entries": {
      "edictum": {
        "mode": "observe"
      }
    }
  }
}
```

## How It Works

1. OpenClaw loads the plugin at startup
2. Edictum registers `before_tool_call` and `after_tool_call` hooks (priority 999 — runs first)
3. Before each tool call, preconditions are evaluated against the contract bundle
4. Violations are denied with a reason; allowed calls proceed normally
5. After execution, postconditions check the result for policy violations
6. Every decision is emitted as a structured audit event

## Custom Contracts

Write your own contracts in YAML following the Edictum contract schema:

```yaml
apiVersion: edictum/v1
kind: ContractBundle

metadata:
  name: my-custom-governance

contracts:
  no-production-writes:
    tools: [exec, write, edit]
    preconditions:
      - type: deny
        when:
          args_match:
            pattern: "production|prod-db|live-server"
        message: "Production writes require manual approval."
```

Point the plugin at your bundle:

```json
{
  "plugins": {
    "entries": {
      "edictum": {
        "contractsPath": "~/.openclaw/contracts/my-governance.yaml"
      }
    }
  }
}
```

## API Reference

### Plugin install (default)

The default export is the native OpenClaw plugin definition. Used automatically by `openclaw plugins install`.

### `createEdictumPlugin(guard, options?)`

Factory that creates a plugin definition from an `Edictum` guard instance. Returns `{ id, name, description, register(api) }`.

### `EdictumOpenClawAdapter`

Low-level adapter class. Methods:
- `pre(toolName, toolInput, callId, ctx)` — evaluate preconditions (returns denial reason or null)
- `post(callId, toolResponse, afterEvent)` — evaluate postconditions
- `handleBeforeToolCall(event, ctx)` — OpenClaw hook handler
- `handleAfterToolCall(event, ctx)` — OpenClaw hook handler
- `setPrincipal(principal)` — update principal at runtime

### `defaultPrincipalFromContext(ctx)`

Maps OpenClaw `ToolHookContext` to an Edictum `Principal`.

## Links

- [Edictum Core](https://github.com/edictum-ai/edictum) — Python reference implementation
- [Edictum TypeScript](https://github.com/edictum-ai/edictum-ts) — TypeScript SDK
- [OpenClaw Plugins](https://docs.openclaw.ai/tools/plugin) — OpenClaw plugin docs

## License

MIT
