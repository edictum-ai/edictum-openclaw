# Edictum for OpenClaw

**One command. Zero code changes. Full rules enforcement.**

Runtime rules enforcement for OpenClaw AI agent tool calls. Install the plugin and every tool call is evaluated against a bundled security ruleset that blocks exfiltration, credential theft, destructive commands, prompt injection, and more.

> Previously published as `@edictum/openclaw` — that package is deprecated. Use `@edictum/edictum` instead.

## Install

### Path 1: One command

```bash
openclaw plugins install @edictum/edictum
openclaw config set plugins.allow '["edictum"]'
```

Done. The bundled ruleset is active with no manual wiring.

### Path 2: Manual wiring

```bash
pnpm add @edictum/core @edictum/edictum
```

```ts
import { Edictum } from '@edictum/core'
import { createEdictumPlugin } from '@edictum/edictum'

const guard = Edictum.fromYaml('contracts/openclaw-rules.yaml')
const plugin = createEdictumPlugin(guard)
```

Or use the adapter directly:

```ts
import { Edictum } from '@edictum/core'
import { EdictumOpenClawAdapter } from '@edictum/edictum'

const guard = Edictum.fromYaml('contracts/openclaw-rules.yaml')
const adapter = new EdictumOpenClawAdapter(guard, {
  onDeny: (toolCall, reason) => console.error(`[edictum] blocked: ${reason}`),
})
```

## What It Does

Edictum enforces **rules**: declarative YAML checks that run before and after every tool call. Unlike prompt-only guardrails, the enforcement happens at the runtime boundary.

When a tool call violates a rule, Edictum blocks it before execution and writes an audit event. No data leaves, no file is deleted, and no secret is exposed.

## What’s Included

The package ships with `contracts/openclaw-rules.yaml`, a curated ruleset that covers:

- data exfiltration
- credential theft
- destructive commands
- prompt injection
- unauthorized network access
- privilege escalation
- session hijacking
- supply-chain abuse
- sandbox escape
- persistence
- reconnaissance

## Breaking Changes in v0.4.0

- Bundled YAML renamed from `openclaw-governance.yaml` to `openclaw-rules.yaml`.
- Plugin config renamed from `contractsPath` to `rulesPath`.
- The plugin rejects `contractsPath` at startup instead of silently falling back to the bundled rules.
- The adapter now returns `violations` instead of `findings` from `post()`.

## Configuration

Configure the plugin under `plugins.entries.edictum`:

```json
{
  "plugins": {
    "entries": {
      "edictum": {
        "mode": "enforce",
        "rulesPath": "/path/to/custom-rules.yaml"
      }
    }
  }
}
```

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Enable or disable the plugin |
| `mode` | `"enforce"` \| `"observe"` | `"enforce"` | `enforce` blocks violations; `observe` logs them without blocking |
| `rulesPath` | string | bundled YAML | Path to a custom ruleset |
| `workflowPath` | string | — | Path to a Workflow Gates YAML definition enforced alongside the ruleset |
| `serverUrl` | string | — | Edictum Console URL for approvals and audit feeds |
| `apiKey` | string | — | API key for Console connection |
| `agentId` | string | — | Stable agent identifier for Console-backed runs |

## Workflow Gates

Workflow Gates continue to work with the renamed rules surface.

```json
{
  "plugins": {
    "entries": {
      "edictum": {
        "rulesPath": "/path/to/custom-rules.yaml",
        "workflowPath": "/path/to/workflow.yaml",
        "serverUrl": "https://console.example.com",
        "apiKey": "edk_production_...",
        "agentId": "mimi"
      }
    }
  }
}
```

`workflowPath` uses the OpenClaw session identity for workflow state. Real workflow runs still require Console-backed persistence through `serverUrl` and `apiKey`. Memory-backed workflow state remains test-only.

## Console Mode

For hot reload, fleet monitoring, and HITL approvals, connect the plugin to [Edictum Console](https://github.com/edictum-ai/edictum-console).

Install `@edictum/server` in the OpenClaw extensions directory:

```bash
cd ~/.openclaw/extensions/edictum && npm install @edictum/server
```

When `serverUrl` and `apiKey` are configured, the plugin connects to Console instead of loading a local rules file. Without server config, the plugin uses the bundled `openclaw-rules.yaml` with no network dependency.

## Observe Mode

Use observe mode to audit what would be blocked without interrupting the run:

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

## Custom Rules

Write custom YAML with the renamed schema:

```yaml
apiVersion: edictum/v1
kind: Ruleset
metadata:
  name: my-custom-rules
defaults:
  mode: enforce
rules:
  - id: no-production-writes
    type: pre
    tool: "*"
    when:
      any:
        - args.path: { matches: "production|prod-db|live-server" }
        - args.command: { matches: "production|prod-db|live-server" }
    then:
      action: block
      message: "Production operations require manual approval."
```

Point the plugin at that file:

```json
{
  "plugins": {
    "entries": {
      "edictum": {
        "rulesPath": "~/.openclaw/rules/my-custom-rules.yaml"
      }
    }
  }
}
```

## API Reference

### `createEdictumPlugin(guard, options?)`

Creates an OpenClaw plugin definition from an `Edictum` guard instance.

### `EdictumOpenClawAdapter`

Low-level adapter methods:

- `pre(toolName, toolInput, callId, ctx)` evaluates pre-execution rules
- `post(callId, toolResponse, afterEvent)` evaluates output checks
- `handleBeforeToolCall(event, ctx)` handles the OpenClaw pre-hook
- `handleAfterToolCall(event, ctx)` handles the OpenClaw post-hook
- `setPrincipal(principal)` updates the principal used for later calls

`post()` returns `{ result, postconditionsPassed, violations, outputSuppressed }`.

## Links

- [Edictum TypeScript](https://github.com/edictum-ai/edictum-ts)
- [Edictum Python](https://github.com/edictum-ai/edictum)
- [OpenClaw plugin docs](https://docs.openclaw.ai/tools/plugin)

## License

MIT
