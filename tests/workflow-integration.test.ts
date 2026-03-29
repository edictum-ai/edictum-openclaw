import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApprovalStatus,
  CollectingAuditSink,
  Edictum,
  MemoryBackend,
  createCompiledState,
} from '@edictum/core'
import type { ApprovalBackend } from '@edictum/core'
import type { Session, ToolEnvelope } from '@edictum/core'

import { createEdictumPlugin } from '../src/plugin.js'
import type {
  AfterToolCallEvent,
  BeforeToolCallEvent,
  OpenClawPluginApi,
  ToolHookContext,
} from '../src/types.js'
import type { WorkflowRuntimeLike } from '../src/workflow-compat.js'

interface WorkflowState {
  readonly reads: readonly string[]
  readonly calls: Readonly<Record<string, readonly string[]>>
}

function makeCtx(overrides: Partial<ToolHookContext> = {}): ToolHookContext {
  return {
    toolName: 'Read',
    agentId: 'mimi',
    sessionKey: 'sk-mimi',
    sessionId: 'sid-mimi',
    runId: 'run-mimi',
    toolCallId: 'tc-default',
    ...overrides,
  }
}

function makeReadEvent(overrides: Partial<BeforeToolCallEvent> = {}): BeforeToolCallEvent {
  return {
    toolName: 'Read',
    params: { path: 'spec.md' },
    runId: 'run-mimi',
    toolCallId: 'tc-read',
    ...overrides,
  }
}

function makeEditEvent(overrides: Partial<BeforeToolCallEvent> = {}): BeforeToolCallEvent {
  return {
    toolName: 'Edit',
    params: { path: 'src/app.ts' },
    runId: 'run-mimi',
    toolCallId: 'tc-edit',
    ...overrides,
  }
}

function makeAfterEvent(overrides: Partial<AfterToolCallEvent> = {}): AfterToolCallEvent {
  return {
    toolName: 'Read',
    params: { path: 'spec.md' },
    runId: 'run-mimi',
    toolCallId: 'tc-read',
    result: 'workflow spec contents',
    durationMs: 5,
    ...overrides,
  }
}

function capturePluginHandlers(runtime: WorkflowRuntimeLike, backend: MemoryBackend) {
  const handlers: Record<
    string,
    { handler: (...args: unknown[]) => unknown; opts?: { priority?: number } }
  > = {}

  const plugin = createEdictumPlugin(new Edictum({ backend, auditSink: new CollectingAuditSink() }), {
    workflowRuntime: runtime,
  })

  const api: OpenClawPluginApi = {
    id: 'edictum',
    name: 'Edictum',
    config: {},
    on: vi.fn(
      (
        hookName: string,
        handler: (...args: unknown[]) => unknown,
        opts?: { priority?: number },
      ) => {
        handlers[hookName] = { handler, opts }
      },
    ),
  }

  plugin.register(api)
  return handlers
}

function normalizeEvaluateArgs(args: unknown[]): { session: Session; envelope: ToolEnvelope } {
  if (args.length >= 3) {
    return {
      session: args[1] as Session,
      envelope: args[2] as ToolEnvelope,
    }
  }
  return {
    session: args[0] as Session,
    envelope: args[1] as ToolEnvelope,
  }
}

function normalizeRecordResultArgs(
  args: unknown[],
): { session: Session; stageId: string; envelope: ToolEnvelope } {
  if (args.length >= 4) {
    return {
      session: args[1] as Session,
      stageId: args[2] as string,
      envelope: args[3] as ToolEnvelope,
    }
  }
  return {
    session: args[0] as Session,
    stageId: args[1] as string,
    envelope: args[2] as ToolEnvelope,
  }
}

class FakeWorkflowRuntime implements WorkflowRuntimeLike {
  constructor(private readonly backend: MemoryBackend) {}

  async evaluate(...args: unknown[]) {
    const { session, envelope } = normalizeEvaluateArgs(args)
    const state = await this.getState(session.sessionId)
    const hasRead = state.reads.includes('spec.md')

    if (!hasRead) {
      if (envelope.toolName === 'Read' && envelope.filePath === 'spec.md') {
        return { action: 'allow' as const, stageId: 'read-context' }
      }
      return {
        action: 'block' as const,
        stageId: 'read-context',
        reason: 'Read the spec first',
      }
    }

    if (envelope.toolName === 'Edit') {
      return { action: 'allow' as const, stageId: 'implement' }
    }

    return {
      action: 'block' as const,
      stageId: 'implement',
      reason: 'Only Edit is allowed after the spec is read',
    }
  }

  async recordResult(...args: unknown[]) {
    const { session, stageId, envelope } = normalizeRecordResultArgs(args)
    const state = await this.getState(session.sessionId)

    if (stageId === 'read-context' && envelope.toolName === 'Read' && envelope.filePath) {
      const reads = state.reads.includes(envelope.filePath)
        ? state.reads
        : [...state.reads, envelope.filePath]
      await this.saveState(session.sessionId, {
        reads,
        calls: state.calls,
      })
      return
    }

    const stageCalls = state.calls[stageId] ?? []
    const nextCall =
      envelope.toolName === 'Bash' && envelope.bashCommand ? envelope.bashCommand : envelope.toolName
    const calls = stageCalls.includes(nextCall)
      ? stageCalls
      : [...stageCalls, nextCall]
    await this.saveState(session.sessionId, {
      reads: state.reads,
      calls: {
        ...state.calls,
        [stageId]: calls,
      },
    })
  }

  async getState(sessionId: string): Promise<WorkflowState> {
    const raw = await this.backend.get(this.key(sessionId))
    if (raw === null) {
      return {
        reads: [],
        calls: {},
      }
    }
    return JSON.parse(raw) as WorkflowState
  }

  private async saveState(sessionId: string, state: WorkflowState): Promise<void> {
    await this.backend.set(this.key(sessionId), JSON.stringify(state))
  }

  private key(sessionId: string): string {
    return `workflow:test:${sessionId}`
  }
}

describe('workflow integration', () => {
  let backend: MemoryBackend

  beforeEach(() => {
    backend = new MemoryBackend()
  })

  it('blocks before evidence exists and only unlocks after a successful after_tool_call', async () => {
    const runtime = new FakeWorkflowRuntime(backend)
    const handlers = capturePluginHandlers(runtime, backend)

    const blocked = await handlers['before_tool_call'].handler(
      makeEditEvent({ toolCallId: 'tc-edit-1' }),
      makeCtx({ toolName: 'Edit', toolCallId: 'tc-edit-1' }),
    )
    expect(blocked).toEqual({ block: true, blockReason: 'Read the spec first' })

    const allowedRead = await handlers['before_tool_call'].handler(
      makeReadEvent({ toolCallId: 'tc-read-1' }),
      makeCtx({ toolCallId: 'tc-read-1' }),
    )
    expect(allowedRead).toBeUndefined()
    expect(await runtime.getState('sid-mimi')).toEqual({ reads: [], calls: {} })

    const stillBlocked = await handlers['before_tool_call'].handler(
      makeEditEvent({ toolCallId: 'tc-edit-2' }),
      makeCtx({ toolName: 'Edit', toolCallId: 'tc-edit-2' }),
    )
    expect(stillBlocked).toEqual({ block: true, blockReason: 'Read the spec first' })

    await handlers['after_tool_call'].handler(
      makeAfterEvent({ toolCallId: 'tc-read-1' }),
      makeCtx({ toolCallId: 'tc-read-1' }),
    )

    expect(await runtime.getState('sid-mimi')).toEqual({
      reads: ['spec.md'],
      calls: {},
    })

    const allowedEdit = await handlers['before_tool_call'].handler(
      makeEditEvent({ toolCallId: 'tc-edit-3' }),
      makeCtx({ toolName: 'Edit', toolCallId: 'tc-edit-3' }),
    )
    expect(allowedEdit).toBeUndefined()
  })

  it('persists workflow state across plugin instances when the backend and session are stable', async () => {
    const runtime1 = new FakeWorkflowRuntime(backend)
    const handlers1 = capturePluginHandlers(runtime1, backend)

    await handlers1['before_tool_call'].handler(
      makeReadEvent({ toolCallId: 'tc-read-persist' }),
      makeCtx({ toolCallId: 'tc-read-persist' }),
    )
    await handlers1['after_tool_call'].handler(
      makeAfterEvent({ toolCallId: 'tc-read-persist' }),
      makeCtx({ toolCallId: 'tc-read-persist' }),
    )

    const runtime2 = new FakeWorkflowRuntime(backend)
    const handlers2 = capturePluginHandlers(runtime2, backend)

    const allowed = await handlers2['before_tool_call'].handler(
      makeEditEvent({ toolCallId: 'tc-edit-persist' }),
      makeCtx({ toolName: 'Edit', toolCallId: 'tc-edit-persist' }),
    )
    expect(allowed).toBeUndefined()

    const otherSessionBlocked = await handlers2['before_tool_call'].handler(
      makeEditEvent({ toolCallId: 'tc-edit-other' }),
      makeCtx({
        toolName: 'Edit',
        toolCallId: 'tc-edit-other',
        sessionId: 'sid-other',
        sessionKey: 'sk-other',
      }),
    )
    expect(otherSessionBlocked).toEqual({ block: true, blockReason: 'Read the spec first' })
  })

  it('allows workflow-blocked calls through in observe mode and audits them as would-deny', async () => {
    const runtime = new FakeWorkflowRuntime(backend)
    const sink = new CollectingAuditSink()
    const handlers: Record<
      string,
      { handler: (...args: unknown[]) => unknown; opts?: { priority?: number } }
    > = {}

    const plugin = createEdictumPlugin(
      new Edictum({
        backend,
        auditSink: sink,
        mode: 'observe',
      }),
      { workflowRuntime: runtime },
    )

    const api: OpenClawPluginApi = {
      id: 'edictum',
      name: 'Edictum',
      config: {},
      on: vi.fn(
        (
          hookName: string,
          handler: (...args: unknown[]) => unknown,
          opts?: { priority?: number },
        ) => {
          handlers[hookName] = { handler, opts }
        },
      ),
    }

    plugin.register(api)

    const result = await handlers['before_tool_call'].handler(
      makeEditEvent({ toolCallId: 'tc-observe-workflow' }),
      makeCtx({ toolName: 'Edit', toolCallId: 'tc-observe-workflow' }),
    )

    expect(result).toBeUndefined()
    expect(sink.events.some((event) => event.action === 'call_would_deny')).toBe(true)
  })

  it('evaluates workflow sequencing before contract HITL approval', async () => {
    const sink = new CollectingAuditSink()
    const approvalBackend: ApprovalBackend = {
      requestApproval: vi.fn(async (_toolName, _toolArgs, _message, _opts) => ({
        approvalId: 'mock-approval-1',
        toolName: _toolName,
        toolArgs: Object.freeze({ ..._toolArgs }),
        message: _message,
        timeout: _opts?.timeout ?? 300,
        timeoutEffect: _opts?.timeoutEffect ?? 'deny',
        principal: _opts?.principal ?? null,
        metadata: Object.freeze({}),
        createdAt: new Date(),
      })),
      waitForDecision: vi.fn(async () => ({
        approved: true,
        approver: 'workflow-reviewer',
        reason: null,
        status: ApprovalStatus.APPROVED,
        timestamp: new Date(),
      })),
    }

    const guard = new Edictum({
      backend,
      auditSink: sink,
      approvalBackend,
    })

    guard._replaceState(
      createCompiledState({
        preconditions: [
          {
            type: 'precondition',
            name: 'require-approval',
            tool: 'Edit',
            effect: 'approve',
            check: () => ({
              passed: false,
              message: 'Needs approval',
              metadata: Object.freeze({}),
            }),
          },
        ],
      }),
    )

    const handlers: Record<
      string,
      { handler: (...args: unknown[]) => unknown; opts?: { priority?: number } }
    > = {}
    const plugin = createEdictumPlugin(guard, {
      workflowRuntime: new FakeWorkflowRuntime(backend),
    })
    const api: OpenClawPluginApi = {
      id: 'edictum',
      name: 'Edictum',
      config: {},
      on: vi.fn(
        (
          hookName: string,
          handler: (...args: unknown[]) => unknown,
          opts?: { priority?: number },
        ) => {
          handlers[hookName] = { handler, opts }
        },
      ),
    }
    plugin.register(api)

    const result = await handlers['before_tool_call'].handler(
      makeEditEvent({ toolCallId: 'tc-workflow-before-hitl' }),
      makeCtx({ toolName: 'Edit', toolCallId: 'tc-workflow-before-hitl' }),
    )

    expect(result).toEqual({ block: true, blockReason: 'Read the spec first' })
    expect(approvalBackend.requestApproval).not.toHaveBeenCalled()
    expect(approvalBackend.waitForDecision).not.toHaveBeenCalled()
  })
})
