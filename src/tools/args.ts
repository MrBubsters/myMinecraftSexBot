/** Thrown for bad tool input; the message is shown to the LLM so it can correct itself. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolInputError'
  }
}

/** Typed, coercing accessor over the loosely-typed arguments an LLM produces. */
export class Args {
  constructor(private readonly raw: Record<string, unknown>) {}

  private value(key: string): unknown {
    const value = this.raw[key]
    return value === null || value === '' ? undefined : value
  }

  has(key: string): boolean {
    return this.value(key) !== undefined
  }

  string(key: string): string {
    const value = this.optionalString(key)
    if (value === undefined) throw new ToolInputError(`Missing required argument "${key}"`)
    return value
  }

  optionalString(key: string): string | undefined {
    const value = this.value(key)
    return value === undefined ? undefined : String(value).trim()
  }

  number(key: string, bounds?: { min?: number; max?: number }): number {
    const value = this.optionalNumber(key, bounds)
    if (value === undefined) throw new ToolInputError(`Missing required argument "${key}"`)
    return value
  }

  optionalNumber(key: string, bounds?: { min?: number; max?: number }): number | undefined {
    const value = this.value(key)
    if (value === undefined) return undefined
    const num = Number(value)
    if (!Number.isFinite(num)) throw new ToolInputError(`Argument "${key}" must be a number, got ${JSON.stringify(value)}`)
    const { min = -Infinity, max = Infinity } = bounds ?? {}
    return Math.max(min, Math.min(max, num))
  }

  int(key: string, fallback: number, bounds?: { min?: number; max?: number }): number {
    return Math.round(this.optionalNumber(key, bounds) ?? fallback)
  }

  boolean(key: string, fallback: boolean): boolean {
    const value = this.value(key)
    if (value === undefined) return fallback
    if (typeof value === 'boolean') return value
    return ['true', '1', 'yes'].includes(String(value).toLowerCase())
  }

  enumValue<T extends string>(key: string, allowed: readonly T[], fallback?: T): T {
    const value = this.optionalString(key)?.toLowerCase()
    if (value === undefined) {
      if (fallback !== undefined) return fallback
      throw new ToolInputError(`Missing required argument "${key}" (one of: ${allowed.join(', ')})`)
    }
    if (!allowed.includes(value as T)) {
      throw new ToolInputError(`Argument "${key}" must be one of: ${allowed.join(', ')}`)
    }
    return value as T
  }
}
