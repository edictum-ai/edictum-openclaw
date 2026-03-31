import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApprovalStatus,
  AuditAction,
  CollectingAuditSink,
  Edictum,
  MemoryBackend,
  Session,
  WorkflowRuntime,
  createCompiledState,
  loadWorkflowString,
} from '@edictum/core'
import type { ApprovalBackend } from '@edictum/core'
import type { ToolCall } from '@edictum/core'

import { createEdictumPlugin } from '../src/plugin.js'
import type {
  AfterToolCallEvent,
  BeforeToolCallEvent,
  OpenClawPluginApi,
  ToolHookContext,
} from '../src/types.js'
import type { WorkflowRuntimeLike } from '../src/workflow-compat.js'

const requireFromTest = createRequire(import.meta.url)

interface WorkflowState {
  readonly reads: readonly string[]
  readonly calls: Readonly<Record<string, readonly string[]>>
}

interface ApprovalWorkflowState {
  readonly approvals: readonly string[]
}

type RegisteredHandlers = Record<
  string,
  { handler: (...args: unknown[]) => unknown; opts?: { priority?: number } }
>

const NATIVE_GIT_WORKFLOW = String.raw`apiVersion: edictum/v1
kind: Workflow
metadata:
  name: lily-openclaw-hard-enforcement
stages:
  - id: local-review
    description: Review the final diff before pushing
    tools: [Read, Grep, Bash]
    checks:
      - command_matches: '^git\s+(status|diff|show|log)\b'
        message: 'Only review-safe git commands are allowed before approval'
    approval:
      message: 'Approve only after the final diff has been reviewed locally'

  - id: commit-push
    entry:
      - condition: 'stage_complete("local-review")'
    tools: [Bash]
    checks:
      - command_matches: '^git\s+(status|diff|add|commit|push)\b'
        message: 'Only git status/diff/add/commit/push are allowed in commit-push'
      - command_not_matches: '^git\s+push\b.*\bmain\b'
        message: 'Push to a branch, not main'
`

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

function makeExecEvent(
  command: string,
  overrides: Partial<BeforeToolCallEvent> = {},
): BeforeToolCallEvent {
  return {
    toolName: 'exec',
    params: { command },
    runId: 'run-mimi',
    toolCallId: 'tc-exec',
    ...overrides,
  }
}

function makeExecAfterEvent(
  command: string,
  overrides: Partial<AfterToolCallEvent> = {},
): AfterToolCallEvent {
  return {
    toolName: 'exec',
    params: { command },
    runId: 'run-mimi',
    toolCallId: 'tc-exec',
    result: 'ok',
    durationMs: 5,
    ...overrides,
  }
}

function capturePluginHandlers(runtime: WorkflowRuntimeLike, backend: MemoryBackend) {
  const handlers: RegisteredHandlers = {}

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

function capturePluginHandlersForGuard(
  guard: Edictum,
  options: { workflowRuntime?: WorkflowRuntimeLike } = {},
): RegisteredHandlers {
  const handlers: RegisteredHandlers = {}
  const plugin = createEdictumPlugin(guard, options)

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

function createNativeWorkflowRuntime(): WorkflowRuntime {
  return new WorkflowRuntime(loadWorkflowString(NATIVE_GIT_WORKFLOW))
}

function readCoreWorkflowApprovalRoundCeiling(): number {
  const coreIndex = requireFromTest.resolve('@edictum/core')
  const source = readFileSync(coreIndex, 'utf8')
  const match = source.match(/MAX_WORKFLOW_APPROVAL_ROUNDS\s*=\s*(\d+);/)
  if (!match) {
    throw new Error('Could not locate @edictum/core workflow approval round ceiling')
  }
  return Number(match[1])
}

function createApprovalLoopWorkflow(stageCount: number): string {
  const stages = Array.from({ length: stageCount }, (_value, index) => {
    const stageId = `approval-${index + 1}`
    const lines = [`  - id: ${stageId}`]

    if (index > 0) {
      lines.push('    entry:')
      lines.push(`      - condition: 'stage_complete("approval-${index}")'`)
    }

    lines.push('    tools: [Bash]')
    lines.push('    checks:')
    lines.push(`      - command_matches: '^git\\s+status\\b'`)
    lines.push(`        message: 'Only git status is allowed in ${stageId}'`)
    lines.push('    approval:')
    lines.push(`      message: 'Approve ${stageId}'`)
    return lines.join('\n')
  }).join('\n')

  return `apiVersion: edictum/v1
kind: Workflow
metadata:
  name: approval-loop
stages:
${stages}
`
}

function createApprovalLoopRuntime(stageCount: number): WorkflowRuntime {
  return new WorkflowRuntime(loadWorkflowString(createApprovalLoopWorkflow(stageCount)))
}

function createApprovalBackend(
  decisions: ReadonlyArray<{
    readonly approved: boolean
    readonly reason: string | null
    readonly status: ApprovalStatus
  }>,
): ApprovalBackend {
  let index = 0

  return {
    requestApproval: vi.fn(async (toolName, toolArgs, message, opts) => ({
      approvalId: `workflow-approval-${index + 1}`,
      toolName,
      toolArgs: Object.freeze({ ...toolArgs }),
      message,
      timeout: opts?.timeout ?? 300,
      timeoutEffect: opts?.timeoutEffect ?? 'deny',
      principal: opts?.principal ?? null,
      metadata: Object.freeze({}),
      createdAt: new Date(),
    })),
    waitForDecision: vi.fn(async () => {
      const decision = decisions[index] ?? decisions[decisions.length - 1]
      index += 1
      return {
        approved: decision.approved,
        approver: decision.approved ? 'workflow-reviewer' : 'workflow-denier',
        reason: decision.reason,
        status: decision.status,
        timestamp: new Date(),
      }
    }),
  }
}

function normalizeEvaluateArgs(args: unknown[]): { session: Session; toolCall: ToolCall } {
  if (args.length >= 3) {
    return {
      session: args[1] as Session,
      toolCall: args[2] as ToolCall,
    }
  }
  return {
    session: args[0] as Session,
    toolCall: args[1] as ToolCall,
  }
}

function normalizeRecordResultArgs(
  args: unknown[],
): { session: Session; stageId: string; toolCall: ToolCall } {
  if (args.length >= 4) {
    return {
      session: args[1] as Session,
      stageId: args[2] as string,
      toolCall: args[3] as ToolCall,
    }
  }
  return {
    session: args[0] as Session,
    stageId: args[1] as string,
    toolCall: args[2] as ToolCall,
  }
}

class FakeWorkflowRuntime implements WorkflowRuntimeLike {
  constructor(private readonly backend: MemoryBackend) {}

  async evaluate(...args: unknown[]) {
    const { session, toolCall } = normalizeEvaluateArgs(args)
    const state = await this.getState(session.sessionId)
    const hasRead = state.reads.includes('spec.md')

    if (!hasRead) {
      if (toolCall.toolName === 'Read' && toolCall.filePath === 'spec.md') {
        return { action: 'allow' as const, stageId: 'read-context' }
      }
      return {
        action: 'block' as const,
        stageId: 'read-context',
        reason: 'Read the spec first',
      }
    }

    if (toolCall.toolName === 'Edit') {
      return { action: 'allow' as const, stageId: 'implement' }
    }

    return {
      action: 'block' as const,
      stageId: 'implement',
      reason: 'Only Edit is allowed after the spec is read',
    }
  }

  async recordResult(...args: unknown[]) {
    const { session, stageId, toolCall } = normalizeRecordResultArgs(args)
    const state = await this.getState(session.sessionId)

    if (stageId === 'read-context' && toolCall.toolName === 'Read' && toolCall.filePath) {
      const reads = state.reads.includes(toolCall.filePath)
        ? state.reads
        : [...state.reads, toolCall.filePath]
      await this.saveState(session.sessionId, {
        reads,
        calls: state.calls,
      })
      return
    }

    const stageCalls = state.calls[stageId] ?? []
    const nextCall =
      toolCall.toolName === 'Bash' && toolCall.bashCommand ? toolCall.bashCommand : toolCall.toolName
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

class ObserveApprovalWorkflowRuntime implements WorkflowRuntimeLike {
  async evaluate(session: Session, toolCall: ToolCall) {
    void session
    void toolCall
    return {
      action: 'pending_approval' as const,
      stageId: 'review',
      reason: 'Review required',
      approvalMessage: 'Review required',
    }
  }
}

class DeferredApprovalWorkflowRuntime implements WorkflowRuntimeLike {
  constructor(private readonly backend: MemoryBackend) {}

  async evaluate(...args: unknown[]) {
    const { session, toolCall } = normalizeEvaluateArgs(args)
    if (toolCall.toolName !== 'Edit') {
      return { action: 'allow' as const, stageId: 'noop' }
    }

    const state = await this.getState(session.sessionId)
    if (!state.approvals.includes('review-gate')) {
      return {
        action: 'pending_approval' as const,
        stageId: 'review-gate',
        reason: 'Workflow review required',
        approvalMessage: 'Workflow review required',
      }
    }

    return { action: 'allow' as const, stageId: 'implement' }
  }

  async recordApproval(session: Session, stageId: string) {
    const state = await this.getState(session.sessionId)
    if (state.approvals.includes(stageId)) {
      return
    }
    await this.saveState(session.sessionId, {
      approvals: [...state.approvals, stageId],
    })
  }

  async getState(sessionId: string): Promise<ApprovalWorkflowState> {
    const raw = await this.backend.get(this.key(sessionId))
    if (raw === null) {
      return { approvals: [] }
    }
    return JSON.parse(raw) as ApprovalWorkflowState
  }

  private async saveState(sessionId: string, state: ApprovalWorkflowState): Promise<void> {
    await this.backend.set(this.key(sessionId), JSON.stringify(state))
  }

  private key(sessionId: string): string {
    return `workflow:approval:${sessionId}`
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
    expect(sink.events.some((event) => event.action === 'call_allowed')).toBe(false)

    await handlers['after_tool_call'].handler(
      makeAfterEvent({
        toolCallId: 'tc-observe-workflow',
        toolName: 'Edit',
        params: { path: 'src/app.ts' },
        result: 'edited',
      }),
      makeCtx({ toolName: 'Edit', toolCallId: 'tc-observe-workflow' }),
    )

    expect(await runtime.getState('sid-mimi')).toEqual({ reads: [], calls: {} })
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

  it('allows workflow approval gates through in observe mode without denying or mutating state', async () => {
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
      { workflowRuntime: new ObserveApprovalWorkflowRuntime() },
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
      makeEditEvent({ toolCallId: 'tc-observe-approval' }),
      makeCtx({ toolName: 'Edit', toolCallId: 'tc-observe-approval' }),
    )

    expect(result).toBeUndefined()
    expect(sink.events.some((event) => event.action === 'call_would_deny')).toBe(true)
    expect(sink.events.some((event) => event.action === 'call_denied')).toBe(false)
    expect(sink.events.some((event) => event.action === 'call_allowed')).toBe(false)
  })

  it('defers workflow approval persistence until contract approval succeeds', async () => {
    const approvalBackend: ApprovalBackend = {
      requestApproval: vi.fn(async (_toolName, _toolArgs, _message, _opts) => ({
        approvalId: `mock-approval-${(_opts?.principal ?? null) === null ? 'none' : 'principal'}`,
        toolName: _toolName,
        toolArgs: Object.freeze({ ..._toolArgs }),
        message: _message,
        timeout: _opts?.timeout ?? 300,
        timeoutEffect: _opts?.timeoutEffect ?? 'deny',
        principal: _opts?.principal ?? null,
        metadata: Object.freeze({}),
        createdAt: new Date(),
      })),
      waitForDecision: vi
        .fn()
        .mockResolvedValueOnce({
          approved: true,
          approver: 'workflow-reviewer',
          reason: null,
          status: ApprovalStatus.APPROVED,
          timestamp: new Date(),
        })
        .mockResolvedValueOnce({
          approved: false,
          approver: 'contract-reviewer',
          reason: 'Contract denied',
          status: ApprovalStatus.DENIED,
          timestamp: new Date(),
        })
        .mockResolvedValueOnce({
          approved: true,
          approver: 'workflow-reviewer',
          reason: null,
          status: ApprovalStatus.APPROVED,
          timestamp: new Date(),
        })
        .mockResolvedValueOnce({
          approved: true,
          approver: 'contract-reviewer',
          reason: null,
          status: ApprovalStatus.APPROVED,
          timestamp: new Date(),
        }),
    }

    const guard = new Edictum({
      backend,
      auditSink: new CollectingAuditSink(),
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
    const runtime = new DeferredApprovalWorkflowRuntime(backend)
    const plugin = createEdictumPlugin(guard, { workflowRuntime: runtime })
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

    const denied = await handlers['before_tool_call'].handler(
      makeEditEvent({ toolCallId: 'tc-workflow-contract-denied' }),
      makeCtx({ toolName: 'Edit', toolCallId: 'tc-workflow-contract-denied' }),
    )
    expect(denied).toEqual({ block: true, blockReason: 'Contract denied' })
    expect(await runtime.getState('sid-mimi')).toEqual({ approvals: [] })

    const allowed = await handlers['before_tool_call'].handler(
      makeEditEvent({ toolCallId: 'tc-workflow-contract-approved' }),
      makeCtx({ toolName: 'Edit', toolCallId: 'tc-workflow-contract-approved' }),
    )
    expect(allowed).toBeUndefined()
    expect(await runtime.getState('sid-mimi')).toEqual({ approvals: ['review-gate'] })

    expect(approvalBackend.requestApproval).toHaveBeenCalledTimes(4)
    expect(approvalBackend.waitForDecision).toHaveBeenCalledTimes(4)
  })

  it('blocks push-before-approval before execution with a workflow gate message', async () => {
    const sink = new CollectingAuditSink()
    const approvalBackend = createApprovalBackend([
      {
        approved: false,
        reason: null,
        status: ApprovalStatus.DENIED,
      },
    ])
    const runtime = createNativeWorkflowRuntime()
    const guard = new Edictum({
      backend,
      auditSink: sink,
      approvalBackend,
      workflowRuntime: runtime,
    })
    const handlers = capturePluginHandlersForGuard(guard, { workflowRuntime: runtime })

    const result = await handlers['before_tool_call'].handler(
      makeExecEvent('git push origin HEAD --dry-run', {
        toolCallId: 'tc-push-before-approval',
      }),
      makeCtx({ toolName: 'exec', toolCallId: 'tc-push-before-approval' }),
    )

    expect(result).toEqual({
      block: true,
      blockReason: 'Approve only after the final diff has been reviewed locally',
    })
    expect(approvalBackend.requestApproval).toHaveBeenCalledOnce()
    expect(approvalBackend.waitForDecision).toHaveBeenCalledOnce()

    const state = await runtime.state(new Session('sid-mimi', backend))
    expect(state.approvals).toEqual({})
    expect(state.evidence.stageCalls).toEqual({})
    expect(
      sink.events.some(
        (event) =>
          event.callId === 'tc-push-before-approval' && event.action === AuditAction.CALL_EXECUTED,
      ),
    ).toBe(false)
    expect(
      sink.events.some(
        (event) =>
          event.callId === 'tc-push-before-approval' &&
          event.action === AuditAction.CALL_APPROVAL_REQUESTED &&
          event.decisionSource === 'workflow',
      ),
    ).toBe(true)
  })

  it('still allows review-safe git commands in local-review', async () => {
    const runtime = createNativeWorkflowRuntime()
    const guard = new Edictum({
      backend,
      auditSink: new CollectingAuditSink(),
      workflowRuntime: runtime,
    })
    const handlers = capturePluginHandlersForGuard(guard, { workflowRuntime: runtime })

    const before = await handlers['before_tool_call'].handler(
      makeExecEvent('git diff --stat', { toolCallId: 'tc-review-safe' }),
      makeCtx({ toolName: 'exec', toolCallId: 'tc-review-safe' }),
    )
    expect(before).toBeUndefined()

    await handlers['after_tool_call'].handler(
      makeExecAfterEvent('git diff --stat', {
        toolCallId: 'tc-review-safe',
        result: 'diff output',
      }),
      makeCtx({ toolName: 'exec', toolCallId: 'tc-review-safe' }),
    )

    const state = await runtime.state(new Session('sid-mimi', backend))
    expect(state.activeStage).toBe('local-review')
    expect(state.evidence.stageCalls['local-review']).toContain('git diff --stat')
  })

  it('blocks push-to-main before execution after approval advances into commit-push', async () => {
    const sink = new CollectingAuditSink()
    const approvalBackend = createApprovalBackend([
      {
        approved: true,
        reason: null,
        status: ApprovalStatus.APPROVED,
      },
    ])
    const runtime = createNativeWorkflowRuntime()
    const guard = new Edictum({
      backend,
      auditSink: sink,
      approvalBackend,
      workflowRuntime: runtime,
    })
    const handlers = capturePluginHandlersForGuard(guard, { workflowRuntime: runtime })

    const result = await handlers['before_tool_call'].handler(
      makeExecEvent('git push origin main --dry-run', {
        toolCallId: 'tc-push-main',
      }),
      makeCtx({ toolName: 'exec', toolCallId: 'tc-push-main' }),
    )

    expect(result).toEqual({
      block: true,
      blockReason: 'Push to a branch, not main',
    })
    expect(approvalBackend.requestApproval).toHaveBeenCalledOnce()
    expect(approvalBackend.waitForDecision).toHaveBeenCalledOnce()

    const state = await runtime.state(new Session('sid-mimi', backend))
    expect(state.approvals['local-review']).toBe('approved')
    expect(
      sink.events.some(
        (event) => event.callId === 'tc-push-main' && event.action === AuditAction.CALL_EXECUTED,
      ),
    ).toBe(false)
  })

  it('still allows a valid branch push in principle after approval and in commit-push', async () => {
    const sink = new CollectingAuditSink()
    const approvalBackend = createApprovalBackend([
      {
        approved: true,
        reason: null,
        status: ApprovalStatus.APPROVED,
      },
    ])
    const runtime = createNativeWorkflowRuntime()
    const guard = new Edictum({
      backend,
      auditSink: sink,
      approvalBackend,
      workflowRuntime: runtime,
    })
    const handlers = capturePluginHandlersForGuard(guard, { workflowRuntime: runtime })

    const before = await handlers['before_tool_call'].handler(
      makeExecEvent('git push origin feature/spec-014 --dry-run', {
        toolCallId: 'tc-push-branch',
      }),
      makeCtx({ toolName: 'exec', toolCallId: 'tc-push-branch' }),
    )
    expect(before).toBeUndefined()

    await handlers['after_tool_call'].handler(
      makeExecAfterEvent('git push origin feature/spec-014 --dry-run', {
        toolCallId: 'tc-push-branch',
        result: 'pushed',
      }),
      makeCtx({ toolName: 'exec', toolCallId: 'tc-push-branch' }),
    )

    const state = await runtime.state(new Session('sid-mimi', backend))
    expect(state.approvals['local-review']).toBe('approved')
    expect(state.evidence.stageCalls['commit-push']).toContain(
      'git push origin feature/spec-014 --dry-run',
    )
    expect(
      sink.events.some(
        (event) =>
          event.callId === 'tc-push-branch' && event.action === AuditAction.CALL_EXECUTED,
      ),
    ).toBe(true)
  })

  it('denies after exceeding the native workflow approval round ceiling', async () => {
    const coreApprovalRoundCeiling = readCoreWorkflowApprovalRoundCeiling()
    const sink = new CollectingAuditSink()
    const approvalBackend = createApprovalBackend([
      {
        approved: true,
        reason: null,
        status: ApprovalStatus.APPROVED,
      },
    ])
    const runtime = createApprovalLoopRuntime(coreApprovalRoundCeiling + 2)
    const guard = new Edictum({
      backend,
      auditSink: sink,
      approvalBackend,
      workflowRuntime: runtime,
    })
    const handlers = capturePluginHandlersForGuard(guard, { workflowRuntime: runtime })

    const result = await handlers['before_tool_call'].handler(
      makeExecEvent('git push origin feature/spec-014 --dry-run', {
        toolCallId: 'tc-push-loop',
      }),
      makeCtx({ toolName: 'exec', toolCallId: 'tc-push-loop' }),
    )

    expect(result).toEqual({
      block: true,
      blockReason: `workflow: exceeded maximum approval rounds (${coreApprovalRoundCeiling})`,
    })
    expect(approvalBackend.requestApproval).toHaveBeenCalledTimes(coreApprovalRoundCeiling + 1)
    expect(approvalBackend.waitForDecision).toHaveBeenCalledTimes(coreApprovalRoundCeiling + 1)

    const state = await runtime.state(new Session('sid-mimi', backend))
    expect(Object.keys(state.approvals)).toHaveLength(coreApprovalRoundCeiling)
    expect(state.approvals[`approval-${coreApprovalRoundCeiling}`]).toBe('approved')
    expect(state.approvals[`approval-${coreApprovalRoundCeiling + 1}`]).toBeUndefined()

    const denied = sink.events.find(
      (event) => event.callId === 'tc-push-loop' && event.action === AuditAction.CALL_DENIED,
    )
    expect(denied).toBeDefined()
    expect(denied?.reason).toBe(
      `workflow: exceeded maximum approval rounds (${coreApprovalRoundCeiling})`,
    )
    expect(denied?.decisionSource).toBe('workflow')
    expect(
      sink.events.some(
        (event) => event.callId === 'tc-push-loop' && event.action === AuditAction.CALL_EXECUTED,
      ),
    ).toBe(false)
  })
})
