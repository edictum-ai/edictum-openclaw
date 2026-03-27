// @edictum/openclaw — native OpenClaw plugin entry point
// Wraps createEdictumPlugin with config-driven setup for `openclaw plugins install`.

import { Edictum } from '@edictum/core'
import { createEdictumPlugin } from './plugin.js'
import { EdictumOpenClawAdapter } from './adapter.js'
import type {
  AfterToolCallEvent,
  BeforeToolCallEvent,
  ToolHookContext,
} from './types.js'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolve __dirname for both ESM and CJS contexts
const currentDir =
  typeof __dirname !== 'undefined'
    ? __dirname
    : dirname(fileURLToPath(import.meta.url))

/** Default contracts: bundled governance YAML shipped with this plugin. */
const DEFAULT_CONTRACTS = resolve(currentDir, '..', 'contracts', 'openclaw-governance.yaml')

/** Hook priority — run before most other plugins. */
const HOOK_PRIORITY = 999

interface PluginConfig {
  readonly enabled?: boolean
  readonly contractsPath?: string
  readonly mode?: 'enforce' | 'observe'
  readonly serverUrl?: string
  readonly apiKey?: string
  readonly agentId?: string
}

/**
 * Lazily initialize a server-connected adapter. Called once on the first
 * before_tool_call or after_tool_call invocation. The returned promise is
 * cached so subsequent hook calls resolve immediately.
 */
async function initServerAdapter(
  config: PluginConfig,
  mode: 'enforce' | 'observe',
): Promise<EdictumOpenClawAdapter> {
  let serverModule: Record<string, unknown>
  try {
    serverModule = await import('@edictum/server')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('Cannot find module') || message.includes('MODULE_NOT_FOUND')) {
      throw new Error(
        'Edictum Console mode requires @edictum/server. Install it with: pnpm add @edictum/server',
      )
    }
    throw err
  }

  if (!('createServerGuard' in serverModule)) {
    throw new Error('createServerGuard not found — update @edictum/server to >=0.2.0')
  }

  const { guard } = await (serverModule as any).createServerGuard({
    url: config.serverUrl,
    apiKey: config.apiKey,
    agentId: config.agentId ?? 'openclaw',
    mode,
  })

  return new EdictumOpenClawAdapter(guard)
}

/**
 * OpenClaw plugin definition.
 *
 * OpenClaw loads this module and calls `register(api)`. The plugin reads
 * its config from `api.pluginConfig`, creates an Edictum guard from the
 * contract bundle, and wires up before_tool_call / after_tool_call hooks.
 *
 * IMPORTANT: register() is synchronous — OpenClaw ignores async return values.
 *
 * Two code paths:
 * - **Local** (default): Edictum.fromYaml() is synchronous, so the guard is
 *   created inline and hooks are registered immediately.
 * - **Server** (serverUrl + apiKey): The async import of @edictum/server and
 *   guard creation are deferred to the first hook invocation (lazy init).
 */
export default {
  id: 'edictum',
  name: 'Edictum Contract Enforcement',
  description:
    'Runtime contract enforcement for AI agent tool calls. Denies exfiltration, credential theft, destructive commands, and prompt injection.',
  version: '0.1.0',

  register(api: {
    readonly pluginConfig?: Record<string, unknown>
    on(hookName: string, handler: (...args: unknown[]) => unknown, opts?: { priority?: number }): void
  }) {
    const config = (api.pluginConfig ?? {}) as PluginConfig

    // Honor explicit disable
    if (config.enabled === false) return

    const mode = config.mode ?? 'enforce'

    if (config.serverUrl && config.apiKey) {
      // ── Server mode: lazy init ──────────────────────────────────────
      // Defer the async import of @edictum/server and guard creation to
      // the first hook invocation. The promise is cached — all subsequent
      // calls share the same adapter instance.
      let adapterPromise: Promise<EdictumOpenClawAdapter> | null = null

      const getAdapter = (): Promise<EdictumOpenClawAdapter> => {
        if (!adapterPromise) {
          adapterPromise = initServerAdapter(config, mode)
        }
        return adapterPromise
      }

      api.on(
        'before_tool_call',
        async (event: unknown, ctx: unknown) => {
          const adapter = await getAdapter()
          return adapter.handleBeforeToolCall(
            event as BeforeToolCallEvent,
            ctx as ToolHookContext,
          )
        },
        { priority: HOOK_PRIORITY },
      )

      api.on(
        'after_tool_call',
        async (event: unknown, ctx: unknown) => {
          const adapter = await getAdapter()
          await adapter.handleAfterToolCall(
            event as AfterToolCallEvent,
            ctx as ToolHookContext,
          )
        },
        { priority: HOOK_PRIORITY },
      )
    } else {
      // ── Local mode: fully synchronous ───────────────────────────────
      const contractsPath = config.contractsPath ?? DEFAULT_CONTRACTS
      const guard = Edictum.fromYaml(contractsPath, { mode })

      // Delegate to the adapter's plugin factory — it registers hooks via api.on()
      const plugin = createEdictumPlugin(guard, { priority: HOOK_PRIORITY })
      plugin.register(api as Parameters<typeof plugin.register>[0])
    }
  },
}
