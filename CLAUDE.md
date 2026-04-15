# Edictum for OpenClaw

Native OpenClaw plugin + adapter for Edictum runtime rules enforcement.

**npm:** `@edictum/edictum`
**Install:** `openclaw plugins install @edictum/edictum`

## What This Is

A standalone npm package that provides:
1. **Native OpenClaw plugin** — auto-registers `before_tool_call` and `after_tool_call` hooks with a bundled ruleset
2. **Adapter library** — `EdictumOpenClawAdapter` and `createEdictumPlugin()` for manual wiring

Two modes:
- **Standalone** (default): Uses bundled `openclaw-rules.yaml`, zero network config
- **Control Plane-connected**: When `serverUrl` and `apiKey` are configured, connects to the Edictum Control Plane for hot reload, fleet monitoring, and HITL approvals

## Repo Structure

- `src/index.ts` — unified entry: default export, adapter, factory, exported types
- `src/native-plugin.ts` — native OpenClaw plugin definition and config-driven setup
- `src/adapter.ts` — `EdictumOpenClawAdapter`, the OpenClaw-to-Edictum bridge
- `src/plugin.ts` — `createEdictumPlugin()` factory
- `src/types.ts` — OpenClaw-facing types and adapter return types
- `src/helpers.ts` — violation and result helpers
- `contracts/` — bundled rules YAML
- `openclaw.plugin.json` — OpenClaw plugin manifest and config schema

## Dependencies

- `@edictum/core` — rules engine and Workflow Gates runtime
- `@edictum/server` — Control Plane connection for approvals and persistence
- `openclaw` — peer dependency provided by the host runtime

## Commands

- `pnpm install`
- `pnpm build`
- `pnpm test`
- `pnpm typecheck`

## Rules

- Follow edictum ecosystem conventions
- Security is non-negotiable
- Never skip CI or use `--no-verify`
- Verify code examples against source before publishing
- Keep the bundled rules in sync with OpenClaw's tool catalog
- Terminology for this repo: use `rules`, `block`, and `violations` as the primary public language
