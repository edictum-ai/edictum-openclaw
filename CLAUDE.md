# Edictum OpenClaw Plugin

Native OpenClaw plugin for Edictum runtime contract enforcement.

## What This Is

A standalone npm package (`@edictum/openclaw-plugin`) that wraps `@edictum/openclaw`
into a native OpenClaw plugin. Users install it with `openclaw plugins install` and
get contract enforcement with zero code changes.

## Repo Structure

- `src/index.ts` — plugin entry point (exports `OpenClawPluginDefinition`)
- `contracts/` — bundled governance YAML + design docs (copied from edictum-ts)
- `openclaw.plugin.json` — OpenClaw plugin manifest with config schema
- `tsup.config.ts` — dual ESM/CJS build

## Dependencies

- `@edictum/core` — contract engine
- `@edictum/openclaw` — OpenClaw adapter (hook wiring, audit, governance pipeline)
- `openclaw` — peer dependency (the host runtime)

## Commands

- `pnpm install` — install deps
- `pnpm build` — build with tsup
- `pnpm test` — run tests (vitest)
- `pnpm typecheck` — type check

## Rules

- Follow edictum ecosystem conventions (see parent `CLAUDE.md`)
- Security is non-negotiable — this is a security product
- Never skip CI or use --no-verify
- Keep the bundled contracts in sync with `edictum-ts/packages/openclaw/contracts/`
