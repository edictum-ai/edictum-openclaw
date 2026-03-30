import { describe, expect, it, vi } from 'vitest'

import nativePlugin from '../src/native-plugin.js'
import type {
  BeforeToolCallEvent,
  BeforeToolCallResult,
  OpenClawPluginApi,
  ToolHookContext,
} from '../src/types.js'

function makeCtx(overrides: Partial<ToolHookContext> = {}): ToolHookContext {
  return {
    toolName: 'exec',
    agentId: 'agent-1',
    sessionKey: 'sk-test',
    sessionId: 'sid-test',
    runId: 'run-test',
    toolCallId: 'tc-1',
    ...overrides,
  }
}

function makeEvent(overrides: Partial<BeforeToolCallEvent> = {}): BeforeToolCallEvent {
  return {
    toolName: 'exec',
    params: { command: 'cat ~/.openclaw/credentials/token' },
    runId: 'run-test',
    toolCallId: 'tc-1',
    ...overrides,
  }
}

function createApi(pluginConfig: Record<string, unknown> = {}) {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {}

  const api: OpenClawPluginApi & {
    pluginConfig: Record<string, unknown>
    logger: {
      debug: ReturnType<typeof vi.fn>
      info: ReturnType<typeof vi.fn>
      warn: ReturnType<typeof vi.fn>
      error: ReturnType<typeof vi.fn>
    }
    registerCommand: ReturnType<typeof vi.fn>
  } = {
    id: 'edictum',
    name: 'Edictum',
    config: {},
    pluginConfig,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    on: vi.fn((hookName: string, handler: (...args: unknown[]) => unknown) => {
      handlers[hookName] = handler
    }),
    registerCommand: vi.fn(),
  }

  return { api, handlers }
}

describe('native plugin', () => {
  it('loads the bundled rules file on the local path and blocks a matching call', async () => {
    const { api, handlers } = createApi()

    nativePlugin.register(api)

    const before = handlers['before_tool_call'] as
      | ((event: BeforeToolCallEvent, ctx: ToolHookContext) => Promise<BeforeToolCallResult | undefined>)
      | undefined

    expect(before).toBeTypeOf('function')

    const result = await before!(makeEvent(), makeCtx())

    expect(result).toEqual({
      block: true,
      blockReason: 'Shell access to credential store is denied.',
    })
  })

  it('fails closed during local registration when rulesPath does not exist', () => {
    const { api } = createApi({
      rulesPath: '/tmp/edictum-openclaw-missing-rules.yaml',
    })

    expect(() => nativePlugin.register(api)).toThrow()
  })

  it('rejects legacy contractsPath config instead of silently falling back to bundled rules', () => {
    const { api } = createApi({
      contractsPath: '/tmp/legacy-contracts.yaml',
    })

    expect(() => nativePlugin.register(api)).toThrow(
      'contractsPath was removed in v0.4.0. Rename it to rulesPath before loading the plugin.',
    )
  })
})
