// @edictum/edictum — native OpenClaw plugin entry point
// Uses the formal Plugin SDK definePluginEntry for full integration.

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

// ---------------------------------------------------------------------------
// SDK import — graceful fallback for older OpenClaw versions without the SDK
// ---------------------------------------------------------------------------

type DefinePluginEntryFn = (opts: {
  id: string
  name: string
  description: string
  configSchema?: Record<string, unknown>
  register: (api: any) => void
}) => any

let defineEntry: DefinePluginEntryFn | undefined
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  defineEntry = require('openclaw/plugin-sdk/plugin-entry').definePluginEntry
} catch {
  /* older OpenClaw without SDK — fall back to raw object export */
}

// ---------------------------------------------------------------------------
// Plugin logger type — mirrors OpenClaw's PluginLogger
// ---------------------------------------------------------------------------

interface PluginLogger {
  debug?: (message: string) => void
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
}

// ---------------------------------------------------------------------------
// Server mode: lazy adapter initialization
// ---------------------------------------------------------------------------

async function initServerAdapter(
  config: PluginConfig,
  mode: 'enforce' | 'observe',
  log?: PluginLogger,
): Promise<EdictumOpenClawAdapter> {
  let serverModule: Record<string, unknown>
  try {
    serverModule = await import('@edictum/server')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('Cannot find module') || message.includes('MODULE_NOT_FOUND')) {
      const msg = 'Edictum Console mode requires @edictum/server. Install it with: npm install @edictum/server'
      log?.error(msg)
      throw new Error(msg)
    }
    throw err
  }

  if (!('createServerGuard' in serverModule)) {
    const msg = 'createServerGuard not found — update @edictum/server to >=0.2.0'
    log?.error(msg)
    throw new Error(msg)
  }

  const { guard } = await (serverModule as any).createServerGuard({
    url: config.serverUrl,
    apiKey: config.apiKey,
    agentId: config.agentId ?? 'openclaw',
    mode,
  })

  log?.info(`connected to Console at ${config.serverUrl}`)
  return new EdictumOpenClawAdapter(guard)
}

// ---------------------------------------------------------------------------
// Plugin config schema — matches openclaw.plugin.json
// ---------------------------------------------------------------------------

const configSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    enabled: { type: 'boolean' },
    contractsPath: { type: 'string' },
    mode: { type: 'string', enum: ['enforce', 'observe'] },
    serverUrl: { type: 'string' },
    apiKey: { type: 'string' },
    agentId: { type: 'string' },
  },
}

// ---------------------------------------------------------------------------
// Register function — shared between SDK and raw export paths
// ---------------------------------------------------------------------------

function registerPlugin(api: any) {
  const log: PluginLogger | undefined = api.logger
  const config = (api.pluginConfig ?? {}) as PluginConfig

  // Honor explicit disable
  if (config.enabled === false) {
    log?.info('plugin disabled via config')
    return
  }

  const mode = config.mode ?? 'enforce'

  // ── CLI commands ──────────────────────────────────────────────────
  if (typeof api.registerCommand === 'function') {
    // Track the guard/adapter for status and audit commands
    let activeGuard: Edictum | null = null
    let activeAdapter: EdictumOpenClawAdapter | null = null

    // Capture references after guard creation (below)
    const setActive = (guard: Edictum, adapter?: EdictumOpenClawAdapter) => {
      activeGuard = guard
      if (adapter) activeAdapter = adapter
    }

    api.registerCommand({
      name: 'edictum',
      description: 'Show Edictum governance status',
      acceptsArgs: true,
      handler: () => {
        if (!activeGuard) {
          return { text: '⚠️ Edictum guard not initialized yet.' }
        }
        const lines = [
          `**Edictum Governance Status**`,
          ``,
          `Mode: \`${activeGuard.mode}\``,
          `Policy version: \`${activeGuard.policyVersion ?? 'unknown'}\``,
          `Contracts path: \`${config.contractsPath ?? DEFAULT_CONTRACTS}\``,
        ]
        if (config.serverUrl) {
          lines.push(`Console: \`${config.serverUrl}\``)
        }
        return { text: lines.join('\n') }
      },
    })

    // Wire up guard capture in both code paths below
    if (config.serverUrl && config.apiKey) {
      let adapterPromise: Promise<EdictumOpenClawAdapter> | null = null

      const getAdapter = (): Promise<EdictumOpenClawAdapter> => {
        if (!adapterPromise) {
          adapterPromise = initServerAdapter(config, mode, log).then((adapter) => {
            setActive((adapter as any)._guard ?? activeGuard!, adapter)
            return adapter
          })
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
      const contractsPath = config.contractsPath ?? DEFAULT_CONTRACTS
      const guard = Edictum.fromYaml(contractsPath, { mode })
      setActive(guard)

      const plugin = createEdictumPlugin(guard, { priority: HOOK_PRIORITY })
      plugin.register(api as Parameters<typeof plugin.register>[0])

      log?.info(`loaded ${contractsPath} in ${mode} mode`)
    }
  } else {
    // ── No registerCommand — older OpenClaw or minimal API ──────────
    if (config.serverUrl && config.apiKey) {
      let adapterPromise: Promise<EdictumOpenClawAdapter> | null = null

      const getAdapter = (): Promise<EdictumOpenClawAdapter> => {
        if (!adapterPromise) {
          adapterPromise = initServerAdapter(config, mode, log)
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
      const contractsPath = config.contractsPath ?? DEFAULT_CONTRACTS
      const guard = Edictum.fromYaml(contractsPath, { mode })

      const plugin = createEdictumPlugin(guard, { priority: HOOK_PRIORITY })
      plugin.register(api as Parameters<typeof plugin.register>[0])

      log?.info(`loaded ${contractsPath} in ${mode} mode`)
    }
  }
}

// ---------------------------------------------------------------------------
// Export: use SDK definePluginEntry if available, raw object otherwise
// ---------------------------------------------------------------------------

const pluginDef = {
  id: 'edictum',
  name: 'Edictum Contract Enforcement',
  description:
    'Runtime contract enforcement for AI agent tool calls. Denies exfiltration, credential theft, destructive commands, and prompt injection.',
  configSchema,
  register: registerPlugin,
}

export default defineEntry ? defineEntry(pluginDef) : pluginDef
