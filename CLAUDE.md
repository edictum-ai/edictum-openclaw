# Edictum for OpenClaw

Native OpenClaw plugin + adapter for Edictum runtime contract enforcement.

**npm:** `@edictum/edictum`
**Install:** `openclaw plugins install @edictum/edictum`

## What This Is

A standalone npm package that provides:
1. **Native OpenClaw plugin** — auto-registers `before_tool_call`/`after_tool_call` hooks with bundled 770-line governance contracts
2. **Adapter library** — `EdictumOpenClawAdapter` and `createEdictumPlugin()` for manual wiring

Two modes:
- **Standalone** (default): Uses bundled `openclaw-governance.yaml`, zero config
- **Console-connected**: When `serverUrl` + `apiKey` are configured, connects to Edictum Console for hot-reload, fleet monitoring, HITL approvals

## Repo Structure

- `src/index.ts` — unified entry: default export (plugin) + adapter + factory
- `src/native-plugin.ts` — native OpenClaw plugin definition (config-driven setup)
- `src/adapter.ts` — `EdictumOpenClawAdapter` (governance pipeline bridge)
- `src/plugin.ts` — `createEdictumPlugin()` factory
- `src/types.ts` — OpenClaw type definitions
- `src/helpers.ts` — findings and result helpers
- `contracts/` — bundled governance YAML + security design docs
- `openclaw.plugin.json` — OpenClaw plugin manifest with config schema

## Dependencies

- `@edictum/core` — contract engine (bundled at build time)
- `@edictum/server` — Console connection (optional, separate install)
- `openclaw` — peer dependency (the host runtime)

## Commands

- `pnpm install` — install deps
- `pnpm build` — build with tsup (dual ESM+CJS)
- `pnpm test` — run tests (vitest)
- `pnpm typecheck` — type check

## Rules

- Follow edictum ecosystem conventions
- Security is non-negotiable — this is a security product
- Never skip CI or use --no-verify
- Verify all code examples against source before publishing
- Keep the bundled contracts in sync with OpenClaw's tool catalog
- Terminology: "contract" not "rule", "denied" not "blocked", "pipeline" not "engine"
