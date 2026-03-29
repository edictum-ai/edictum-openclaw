// @edictum/edictum — native OpenClaw plugin entry point
// Uses the formal Plugin SDK definePluginEntry for full integration.

import * as EdictumCore from '@edictum/core'
import { createEdictumPlugin } from './plugin.js'
import { EdictumOpenClawAdapter } from './adapter.js'
import type {
  AfterToolCallEvent,
  BeforeToolCallEvent,
  EdictumNativePluginConfig,
  ToolHookContext,
} from './types.js'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isWorkflowTestMode, loadWorkflowRuntime } from './workflow-compat.js'
import type { WorkflowCoreModuleLike, WorkflowRuntimeLike } from './workflow-compat.js'
import type * as EdictumServerModule from '@edictum/server'

type PluginConfig = EdictumNativePluginConfig
type GuardInstance = InstanceType<typeof EdictumCore.Edictum>
type GuardFromYamlCompatOptions = NonNullable<Parameters<typeof EdictumCore.Edictum.fromYaml>[1]> & {
  workflowRuntime?: WorkflowRuntimeLike
}
type ServerModuleLike = typeof EdictumServerModule

// Resolve __dirname for both ESM and CJS contexts
const currentDir =
  typeof __dirname !== 'undefined'
    ? __dirname
    : dirname(fileURLToPath(import.meta.url))

/** Default contracts: bundled governance YAML shipped with this plugin. */
const DEFAULT_CONTRACTS = resolve(currentDir, '..', 'contracts', 'openclaw-governance.yaml')

/** Hook priority — run before most other plugins. */
const HOOK_PRIORITY = 999

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
  const mod = require('openclaw/plugin-sdk/plugin-entry')
  if (mod && typeof mod.definePluginEntry === 'function') {
    defineEntry = mod.definePluginEntry
  }
} catch (err) {
  // Only swallow module-not-found — rethrow unexpected errors.
  // In bundled ESM, esbuild's __require shim throws "Dynamic require of X is not supported"
  // which is functionally equivalent to module-not-found.
  const msg = err instanceof Error ? err.message : ''
  if (
    !msg.includes('Cannot find module') &&
    !msg.includes('MODULE_NOT_FOUND') &&
    !msg.includes('Dynamic require')
  ) {
    throw err
  }
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
// Plugin config schema — matches openclaw.plugin.json
// ---------------------------------------------------------------------------

const configSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    enabled: { type: 'boolean' },
    contractsPath: { type: 'string' },
    workflowPath: { type: 'string' },
    mode: { type: 'string', enum: ['enforce', 'observe'] },
    serverUrl: { type: 'string' },
    apiKey: { type: 'string' },
    agentId: { type: 'string' },
  },
}

// ---------------------------------------------------------------------------
// Adapter initialization
// ---------------------------------------------------------------------------

async function loadServerModule(
  message: string,
  log?: PluginLogger,
): Promise<ServerModuleLike> {
  let serverModule: ServerModuleLike
  try {
    serverModule = await import('@edictum/server')
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    if (detail.includes('Cannot find module') || detail.includes('MODULE_NOT_FOUND')) {
      log?.error(message)
      throw new Error(message)
    }
    throw err
  }
  return serverModule
}

async function initServerAdapter(
  config: PluginConfig,
  mode: 'enforce' | 'observe',
  log?: PluginLogger,
): Promise<EdictumOpenClawAdapter> {
  const serverModule = await loadServerModule(
    'Edictum Console mode requires @edictum/server. Install it with: npm install @edictum/server',
    log,
  )

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

async function initWorkflowAdapter(
  config: PluginConfig,
  mode: 'enforce' | 'observe',
  log?: PluginLogger,
): Promise<EdictumOpenClawAdapter> {
  const contractsPath = config.contractsPath ?? DEFAULT_CONTRACTS
  const workflowPath = config.workflowPath
  if (!workflowPath) {
    throw new Error('workflowPath is required for workflow-enabled OpenClaw integration')
  }

  const workflowRuntime = loadWorkflowRuntime(
    EdictumCore as unknown as WorkflowCoreModuleLike,
    workflowPath,
  )
  let guardOptions: GuardFromYamlCompatOptions = {
    mode,
    workflowRuntime,
  }

  if (config.serverUrl && config.apiKey) {
    const serverModule = await loadServerModule(
      'Edictum Console-backed workflow persistence requires @edictum/server. Install it with: npm install @edictum/server',
      log,
    )
    const {
      EdictumServerClient,
      ServerApprovalBackend,
      ServerAuditSink,
      ServerBackend,
    } = serverModule

    if (
      typeof EdictumServerClient !== 'function' ||
      typeof ServerBackend !== 'function' ||
      typeof ServerApprovalBackend !== 'function' ||
      typeof ServerAuditSink !== 'function'
    ) {
      throw new Error(
        'Workflow persistence requires @edictum/server exports: EdictumServerClient, ServerBackend, ServerApprovalBackend, and ServerAuditSink',
      )
    }

    const client = new EdictumServerClient({
      baseUrl: config.serverUrl,
      apiKey: config.apiKey,
      agentId: config.agentId ?? 'openclaw',
    })

    guardOptions = {
      ...guardOptions,
      backend: new ServerBackend(client),
      approvalBackend: new ServerApprovalBackend(client),
      auditSink: new ServerAuditSink(client),
    }
  } else if (!isWorkflowTestMode()) {
    throw new Error(
      'workflowPath requires serverUrl and apiKey for persistent Mimi/OpenClaw workflow state. MemoryBackend is test-only for workflow-enabled runs.',
    )
  }

  const fromYamlWithWorkflow = EdictumCore.Edictum.fromYaml as unknown as (
    path: string,
    options?: GuardFromYamlCompatOptions,
  ) => GuardInstance
  const guard = fromYamlWithWorkflow(contractsPath, guardOptions)

  log?.info(`loaded workflow ${workflowPath} with contracts ${contractsPath} in ${mode} mode`)
  return new EdictumOpenClawAdapter(guard, { workflowRuntime })
}

// ---------------------------------------------------------------------------
// Shared hook registration
// ---------------------------------------------------------------------------

function registerAsyncHooks(
  api: any,
  getAdapter: () => Promise<EdictumOpenClawAdapter>,
) {
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
}

function registerServerHooks(
  api: any,
  config: PluginConfig,
  mode: 'enforce' | 'observe',
  log?: PluginLogger,
  onReady?: (adapter: EdictumOpenClawAdapter) => void,
) {
  let adapterPromise: Promise<EdictumOpenClawAdapter> | null = null

  const getAdapter = (): Promise<EdictumOpenClawAdapter> => {
    if (!adapterPromise) {
      adapterPromise = initServerAdapter(config, mode, log).then((adapter) => {
        onReady?.(adapter)
        return adapter
      })
    }
    return adapterPromise
  }

  registerAsyncHooks(api, getAdapter)
}

function registerWorkflowHooks(
  api: any,
  config: PluginConfig,
  mode: 'enforce' | 'observe',
  log?: PluginLogger,
  onReady?: (adapter: EdictumOpenClawAdapter) => void,
) {
  let adapterPromise: Promise<EdictumOpenClawAdapter> | null = null

  const getAdapter = (): Promise<EdictumOpenClawAdapter> => {
    if (!adapterPromise) {
      adapterPromise = initWorkflowAdapter(config, mode, log).then((adapter) => {
        onReady?.(adapter)
        return adapter
      })
    }
    return adapterPromise
  }

  registerAsyncHooks(api, getAdapter)
}

function registerLocalHooks(
  api: any,
  config: PluginConfig,
  mode: 'enforce' | 'observe',
  log?: PluginLogger,
): GuardInstance {
  const contractsPath = config.contractsPath ?? DEFAULT_CONTRACTS
  const guard = EdictumCore.Edictum.fromYaml(contractsPath, { mode })

  const plugin = createEdictumPlugin(guard, { priority: HOOK_PRIORITY })
  plugin.register(api as Parameters<typeof plugin.register>[0])

  log?.info(`loaded ${contractsPath} in ${mode} mode`)
  return guard
}

// ---------------------------------------------------------------------------
// Register function — shared between SDK and raw export paths
// ---------------------------------------------------------------------------

function registerPlugin(api: any) {
  const log: PluginLogger | undefined = api.logger
  const config = (api.pluginConfig ?? {}) as PluginConfig

  if (config.enabled === false) {
    log?.info('plugin disabled via config')
    return
  }

  const mode = config.mode ?? 'enforce'
  let activeGuard: GuardInstance | null = null

  if (typeof api.registerCommand === 'function') {
    api.registerCommand({
      name: 'edictum',
      description: 'Show Edictum governance status',
      handler: () => {
        if (!activeGuard) {
          return { text: 'Edictum guard not initialized yet.' }
        }
        const lines = [
          `**Edictum Governance Status**`,
          ``,
          `Mode: \`${activeGuard.mode}\``,
          `Policy version: \`${activeGuard.policyVersion ?? 'unknown'}\``,
          `Contracts path: \`${config.contractsPath ?? DEFAULT_CONTRACTS}\``,
        ]
        if (config.workflowPath) {
          lines.push(`Workflow path: \`${config.workflowPath}\``)
        }
        if (config.serverUrl) {
          lines.push(`Console: \`${config.serverUrl}\``)
        }
        return { text: lines.join('\n') }
      },
    })
  }

  if (config.workflowPath) {
    registerWorkflowHooks(api, config, mode, log, (adapter) => {
      activeGuard = (adapter as unknown as { readonly _guard?: GuardInstance })._guard ?? null
    })
    return
  }

  if (config.serverUrl && config.apiKey) {
    registerServerHooks(api, config, mode, log, (adapter) => {
      activeGuard = (adapter as unknown as { readonly _guard?: GuardInstance })._guard ?? null
    })
    return
  }

  activeGuard = registerLocalHooks(api, config, mode, log)
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
