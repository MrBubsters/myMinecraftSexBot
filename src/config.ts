import path from 'path'

export type ThinkSetting = boolean | 'low' | 'medium' | 'high'

export type Config = {
  minecraft: {
    host: string
    port: number
    account: string
    auth: 'microsoft' | 'offline'
    version: string
    profilesFolder: string
  }
  owners: {
    minecraft: string
    discord: string | null
  }
  llm: {
    host: string
    model: string
    think: ThinkSetting
    numCtx: number
  }
  agent: {
    maxSteps: number
    autoEat: boolean
  }
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable ${name}`)
  return value
}

function optional(name: string): string | undefined {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

function int(name: string, fallback: number): number {
  const raw = optional(name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer, got "${raw}"`)
  return value
}

function bool(name: string, fallback: boolean): boolean {
  const raw = optional(name)
  if (raw === undefined) return fallback
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase())
}

function think(model: string): ThinkSetting {
  const raw = optional('OLLAMA_THINK')?.toLowerCase()
  // gpt-oss cannot fully disable reasoning; it only accepts levels.
  if (raw === undefined) return model.startsWith('gpt-oss') ? 'low' : false
  if (raw === 'low' || raw === 'medium' || raw === 'high') return raw
  return ['1', 'true', 'yes', 'on'].includes(raw)
}

export function loadConfig(): Config {
  const auth = optional('MC_AUTH') ?? 'microsoft'
  if (auth !== 'microsoft' && auth !== 'offline') {
    throw new Error(`MC_AUTH must be "microsoft" or "offline", got "${auth}"`)
  }

  const model = optional('OLLAMA_MODEL') ?? 'gpt-oss:20b'

  return {
    minecraft: {
      host: required('MC_HOST'),
      port: int('MC_PORT', 25565),
      account: required('MC_ACCOUNT'),
      auth,
      version: optional('MC_VERSION') ?? '26.2',
      profilesFolder: path.resolve(process.cwd(), '.auth-cache')
    },
    owners: {
      minecraft: required('MC_OWNER'),
      discord: optional('DISCORD_OWNER') ?? null
    },
    llm: {
      host: optional('OLLAMA_HOST') ?? 'http://127.0.0.1:11434',
      model,
      think: think(model),
      numCtx: int('OLLAMA_NUM_CTX', 16384)
    },
    agent: {
      maxSteps: int('AGENT_MAX_STEPS', 40),
      autoEat: bool('AUTO_EAT', true)
    }
  }
}
