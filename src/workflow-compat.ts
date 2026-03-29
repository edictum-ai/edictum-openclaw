import { EdictumConfigError } from '@edictum/core'
import type { Session, ToolEnvelope } from '@edictum/core'

export interface WorkflowDecisionLike {
  readonly action: 'allow' | 'block' | 'pending_approval'
  readonly reason?: string | null
  readonly stageId?: string | null
  readonly stageID?: string | null
  readonly workflowStageId?: string | null
  readonly workflowStageID?: string | null
  readonly approvalMessage?: string | null
  readonly approvalTimeout?: number
  readonly approvalTimeoutEffect?: string
  readonly workflow?: {
    readonly stageId?: string | null
    readonly stageID?: string | null
    readonly approvalMessage?: string | null
    readonly approvalTimeout?: number
    readonly approvalTimeoutEffect?: string
  } | null
}

export interface NormalizedWorkflowDecision {
  readonly action: 'allow' | 'block' | 'pending_approval'
  readonly reason: string | null
  readonly stageId: string | null
  readonly approvalMessage: string | null
  readonly approvalTimeout: number | null
  readonly approvalTimeoutEffect: string | null
}

export interface WorkflowRuntimeLike {
  evaluate: (session: Session, envelope: ToolEnvelope) => Promise<WorkflowDecisionLike>
  recordResult?: (session: Session, stageId: string, envelope: ToolEnvelope) => Promise<unknown>
  recordApproval?: (session: Session, stageId: string) => Promise<unknown>
}

export interface WorkflowCoreModuleLike {
  readonly loadWorkflow?: (path: string) => unknown
  readonly WorkflowRuntime?: new (
    definition: unknown,
    options?: Record<string, unknown>,
  ) => WorkflowRuntimeLike
}

export function hasNativeWorkflowSupport(guard: unknown): boolean {
  if (!guard || typeof guard !== 'object') {
    return false
  }
  const candidate = guard as Record<string, unknown>
  return '_workflowRuntime' in candidate || 'workflowRuntime' in candidate
}

export function loadWorkflowRuntime(
  core: WorkflowCoreModuleLike,
  workflowPath: string,
): WorkflowRuntimeLike {
  if (typeof core.loadWorkflow !== 'function' || typeof core.WorkflowRuntime !== 'function') {
    throw new EdictumConfigError(
      'workflowPath requires an @edictum/core build that exports loadWorkflow and WorkflowRuntime',
    )
  }
  const definition = core.loadWorkflow(workflowPath)
  return new core.WorkflowRuntime(definition)
}

export async function evaluateWorkflow(
  runtime: WorkflowRuntimeLike,
  session: Session,
  envelope: ToolEnvelope,
): Promise<NormalizedWorkflowDecision> {
  const raw = await runtime.evaluate(session, envelope)
  const action = normalizeWorkflowAction(raw.action)

  return {
    action,
    reason:
      action === 'block' && raw.reason == null
        ? `Workflow runtime returned unsupported action ${JSON.stringify(raw.action)}`
        : raw.reason ?? null,
    stageId: extractWorkflowStageId(raw),
    approvalMessage: extractWorkflowApprovalMessage(raw),
    approvalTimeout: extractWorkflowApprovalTimeout(raw),
    approvalTimeoutEffect: extractWorkflowApprovalTimeoutEffect(raw),
  }
}

export async function recordWorkflowResult(
  runtime: WorkflowRuntimeLike,
  session: Session,
  stageId: string,
  envelope: ToolEnvelope,
): Promise<void> {
  if (!stageId || typeof runtime.recordResult !== 'function') {
    return
  }
  await runtime.recordResult(session, stageId, envelope)
}

export async function recordWorkflowApproval(
  runtime: WorkflowRuntimeLike,
  session: Session,
  stageId: string,
): Promise<void> {
  if (!stageId || typeof runtime.recordApproval !== 'function') {
    return
  }
  await runtime.recordApproval(session, stageId)
}

export function extractWorkflowStageId(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const record = value as Record<string, unknown>
  for (const candidate of [
    record['stageId'],
    record['stageID'],
    record['workflowStageId'],
    record['workflowStageID'],
  ]) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate
    }
  }
  const workflow = record['workflow']
  if (workflow && typeof workflow === 'object') {
    const nested = workflow as Record<string, unknown>
    for (const candidate of [nested['stageId'], nested['stageID']]) {
      if (typeof candidate === 'string' && candidate.length > 0) {
        return candidate
      }
    }
  }
  return null
}

function extractWorkflowApprovalMessage(value: WorkflowDecisionLike): string | null {
  if (typeof value.approvalMessage === 'string') {
    return value.approvalMessage
  }
  if (value.workflow && typeof value.workflow.approvalMessage === 'string') {
    return value.workflow.approvalMessage
  }
  return null
}

function extractWorkflowApprovalTimeout(value: WorkflowDecisionLike): number | null {
  if (typeof value.approvalTimeout === 'number') {
    return value.approvalTimeout
  }
  if (value.workflow && typeof value.workflow.approvalTimeout === 'number') {
    return value.workflow.approvalTimeout
  }
  return null
}

function extractWorkflowApprovalTimeoutEffect(value: WorkflowDecisionLike): string | null {
  if (typeof value.approvalTimeoutEffect === 'string') {
    return value.approvalTimeoutEffect
  }
  if (value.workflow && typeof value.workflow.approvalTimeoutEffect === 'string') {
    return value.workflow.approvalTimeoutEffect
  }
  return null
}

export function isWorkflowTestMode(): boolean {
  return process.env.EDICTUM_WORKFLOW_TEST_MODE === 'true'
}

function normalizeWorkflowAction(action: unknown): NormalizedWorkflowDecision['action'] {
  if (action === 'allow' || action === 'block' || action === 'pending_approval') {
    return action
  }
  return 'block'
}
