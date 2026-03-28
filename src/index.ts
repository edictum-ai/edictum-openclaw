// @edictum/edictum — OpenClaw adapter + plugin for Edictum behavior enforcement
// Single package: use as an OpenClaw plugin (default export) or wire manually.

export const VERSION = '0.1.0' as const

// Native OpenClaw plugin (default export for `openclaw plugins install`)
export { default } from './native-plugin.js'

// Adapter
export { EdictumOpenClawAdapter } from './adapter.js'
export type { OpenClawAdapterOptions } from './adapter.js'

// Plugin factory
export { createEdictumPlugin, defaultPrincipalFromContext } from './plugin.js'
export type { EdictumPluginOptions } from './plugin.js'

// Types
export type {
  AfterToolCallEvent,
  BeforeToolCallEvent,
  BeforeToolCallResult,
  Finding,
  OpenClawPluginApi,
  PostCallResult,
  SessionHookContext,
  ToolHookContext,
} from './types.js'
