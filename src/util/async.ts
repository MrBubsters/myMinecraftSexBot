export class TaskCancelledError extends Error {
  constructor() {
    super('Task was cancelled')
    this.name = 'TaskCancelledError'
  }
}

export function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new TaskCancelledError()
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new TaskCancelledError())
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new TaskCancelledError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Rejects if `promise` does not settle within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
