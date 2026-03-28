// @edictum/edictum — helper functions extracted from adapter.ts

import type { Finding } from './types.js'

// ---------------------------------------------------------------------------
// buildFindings
// ---------------------------------------------------------------------------

export function buildFindings(postDecision: {
  postconditionsPassed: boolean
  warnings: string[]
  rulesEvaluated: Record<string, unknown>[]
  policyError: boolean
}): Finding[] {
  if (
    postDecision.postconditionsPassed &&
    !postDecision.policyError &&
    postDecision.warnings.length === 0
  ) {
    return []
  }
  const findings: Finding[] = []
  for (const w of postDecision.warnings) {
    findings.push({
      ruleId: null,
      message: w,
      tags: [],
      severity: 'warn',
    })
  }
  for (const c of postDecision.rulesEvaluated) {
    if (c.passed === false || c.policyError === true) {
      findings.push({
        ruleId: (c.name as string) ?? (c.ruleId as string) ?? null,
        message: (c.message as string) ?? 'Postcondition failed.',
        tags: (() => {
          const meta = c.metadata as Record<string, unknown> | undefined
          const tags = meta?.tags ?? c.tags
          return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : []
        })(),
        severity: (c.policyError as boolean) ? 'error' : 'warn',
      })
    }
  }
  return findings
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
