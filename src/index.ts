// @edictum/openclaw-plugin — native OpenClaw plugin entry point
// Wraps @edictum/openclaw's createEdictumPlugin with config-driven setup.

import { Edictum } from '@edictum/core'
import { createEdictumPlugin } from '@edictum/openclaw'
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

    const contractsPath = config.contractsPath ?? DEFAULT_CONTRACTS
    const mode = config.mode ?? 'enforce'

    const guard = Edictum.fromYaml(contractsPath, { mode })

    // Delegate to the adapter's plugin factory — it registers hooks via api.on()
    const plugin = createEdictumPlugin(guard, {
      priority: 999, // Run before most other plugins
    })

    // The factory returns { register(api) } — call it with our api
    plugin.register(api as Parameters<typeof plugin.register>[0])
  },
}
