// @edictum/openclaw — native OpenClaw plugin entry point
// Wraps createEdictumPlugin with config-driven setup for `openclaw plugins install`.

import { Edictum } from '@edictum/core'
import { createEdictumPlugin } from './plugin.js'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolve __dirname for both ESM and CJS contexts
const currentDir =
  typeof __dirname !== 'undefined'
    ? __dirname
    : dirname(fileURLToPath(import.meta.url))

/** Default contracts: bundled governance YAML shipped with this plugin. */
const DEFAULT_CONTRACTS = resolve(currentDir, '..', 'contracts', 'openclaw-governance.yaml')

interface PluginConfig {
  readonly enabled?: boolean
  readonly contractsPath?: string
  readonly mode?: 'enforce' | 'observe'
  readonly serverUrl?: string
  readonly apiKey?: string
  readonly agentId?: string
}

/**
 * OpenClaw plugin definition.
 *
 * OpenClaw loads this module and calls `register(api)`. The plugin reads
 * its config from `api.pluginConfig`, creates an Edictum guard from the
 * contract bundle, and delegates to `createEdictumPlugin` which wires up
 * the before_tool_call / after_tool_call hooks.
 *
 * When `serverUrl` and `apiKey` are configured, the plugin connects to
 * Edictum Console for hot-reload contracts and fleet monitoring instead
 * of loading local YAML.
 */
export default {
  id: 'edictum',
  name: 'Edictum Contract Enforcement',
  description:
    'Runtime contract enforcement for AI agent tool calls. Denies exfiltration, credential theft, destructive commands, and prompt injection.',
  version: '0.1.0',

  async register(api: {
    readonly pluginConfig?: Record<string, unknown>
    on(hookName: string, handler: (...args: unknown[]) => unknown, opts?: { priority?: number }): void
  }) {
    const config = (api.pluginConfig ?? {}) as PluginConfig

    // Honor explicit disable
    if (config.enabled === false) return

    const mode = config.mode ?? 'enforce'

    let guard: Edictum

    if (config.serverUrl && config.apiKey) {
      // Connect to Edictum Console for hot-reload contracts + fleet monitoring.
      // Dynamic import so @edictum/server is only loaded when needed (optional dep).
      try {
        const serverModule = await import('@edictum/server')
        if (!('createServerGuard' in serverModule)) {
          throw new Error('createServerGuard not found — update @edictum/server to >=0.2.0')
        }
        const { guard: serverGuard } = await (serverModule as any).createServerGuard({
          url: config.serverUrl,
          apiKey: config.apiKey,
          agentId: config.agentId ?? 'openclaw',
          mode,
        })
        guard = serverGuard
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (message.includes('Cannot find module') || message.includes('MODULE_NOT_FOUND')) {
          throw new Error(
            'Edictum Console mode requires @edictum/server. Install it with: pnpm add @edictum/server',
          )
        }
        throw err
      }
    } else {
      // Local contracts
      const contractsPath = config.contractsPath ?? DEFAULT_CONTRACTS
      guard = Edictum.fromYaml(contractsPath, { mode })
    }

    // Delegate to the adapter's plugin factory — it registers hooks via api.on()
    const plugin = createEdictumPlugin(guard, {
      priority: 999, // Run before most other plugins
    })

    // The factory returns { register(api) } — call it with our api
    plugin.register(api as Parameters<typeof plugin.register>[0])
  },
}
