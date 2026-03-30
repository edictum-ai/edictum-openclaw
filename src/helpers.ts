// @edictum/edictum — helper functions extracted from adapter.ts

import { classifyViolation, createViolation } from '@edictum/core'
import type { Violation } from './types.js'

// ---------------------------------------------------------------------------
// buildViolations
// ---------------------------------------------------------------------------

export function buildViolations(postDecision: {
  postconditionsPassed: boolean
  warnings: string[]
  contractsEvaluated: Record<string, unknown>[]
  policyError: boolean
}): Violation[] {
  if (
    postDecision.postconditionsPassed &&
    !postDecision.policyError &&
    postDecision.warnings.length === 0
  ) {
    return []
  }
  const violations: Violation[] = []
  for (const w of postDecision.warnings) {
    violations.push(
      createViolation({
        type: 'warning',
        ruleId: 'warning',
        field: 'output',
        message: w,
      }),
    )
  }
  for (const c of postDecision.contractsEvaluated) {
    if (c.passed === false || c.policyError === true) {
      const metadata = {
        ...((c.metadata as Record<string, unknown> | undefined) ?? {}),
      }
      if (!Array.isArray(metadata.tags) && Array.isArray(c.tags)) {
        metadata.tags = c.tags
      }
      const ruleId =
        (c.name as string | undefined) ??
        (c.ruleId as string | undefined) ??
        (c.contractId as string | undefined) ??
        'output'

      violations.push(
        createViolation({
          type: (c.policyError as boolean)
            ? 'policy_error'
            : classifyViolation(ruleId, (c.message as string | undefined) ?? 'Output check failed.'),
          ruleId,
          field: (metadata.field as string | undefined) ?? 'output',
          message: (c.message as string) ?? 'Output check failed.',
          metadata,
        }),
      )
    }
  }
  return violations
}

// ---------------------------------------------------------------------------
// summarizeResult
// ---------------------------------------------------------------------------

export function summarizeResult(result: unknown): string | null {
  if (result === null || result === undefined) return null
  try {
    // For strings, truncate directly — avoid serializing large objects just
    // to take 200 chars (#71).
    if (typeof result === 'string') {
      return result.length > 200 ? result.slice(0, 197) + '...' : result
    }
    const str = JSON.stringify(result)
    return str.length > 200 ? str.slice(0, 197) + '...' : str
  } catch {
    // Circular references or other serialization errors must not propagate
    return '[unserializable result]'
  }
}
