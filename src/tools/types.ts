import { Bot } from 'mineflayer'
import { Vec3 } from 'vec3'
import { Logger } from '../util/logger.js'
import { Args, ToolInputError } from './args.js'

export type ParamSpec = {
  type: 'string' | 'number' | 'integer' | 'boolean'
  description: string
  enum?: readonly string[]
  required?: boolean
}

export type ToolContext = {
  bot: Bot
  signal: AbortSignal
  log: Logger
  /** The player who issued the current request. */
  requester: string
}

export type ToolDefinition = {
  name: string
  /** Groups tools in the generated ability guide. */
  category: string
  description: string
  params: Record<string, ParamSpec>
  handler: (args: Args, ctx: ToolContext) => Promise<string>
}

export function defineTool(tool: ToolDefinition): ToolDefinition {
  return tool
}

/** Common x/y/z parameter block. */
export function positionParams(description: string, required = true): Record<string, ParamSpec> {
  return {
    x: { type: 'number', description: `X coordinate of ${description}`, required },
    y: { type: 'number', description: `Y coordinate of ${description}`, required },
    z: { type: 'number', description: `Z coordinate of ${description}`, required }
  }
}

export function readPosition(args: Args): Vec3 {
  return new Vec3(Math.floor(args.number('x')), Math.floor(args.number('y')), Math.floor(args.number('z')))
}

export function readOptionalPosition(args: Args): Vec3 | null {
  const present = ['x', 'y', 'z'].filter(k => args.has(k))
  if (present.length === 0) return null
  if (present.length !== 3) throw new ToolInputError('Provide all of x, y and z, or none of them')
  return readPosition(args)
}
