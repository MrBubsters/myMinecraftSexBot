import { Bot } from 'mineflayer'
import { stopAllMovement } from '../bot/navigation.js'
import { describeWorldState } from '../bot/status.js'
import { Config } from '../config.js'
import { ToolRegistry } from '../tools/registry.js'
import { TaskCancelledError, errorMessage } from '../util/async.js'
import { createLogger } from '../util/logger.js'
import { LlmClient, Message } from './llm.js'
import { buildSystemPrompt, buildUserMessage } from './prompt.js'

const log = createLogger('agent')

/** Tool output beyond this is cut so one verbose result can't flood the context window. */
const maxToolOutput = 2000
/** Past request/reply pairs kept so follow-ups like "do it again" make sense. */
const historyTurns = 6

export type AgentRequest = {
  username: string
  message: string
}

export class Agent {
  private readonly queue: AgentRequest[] = []
  private readonly history: Message[] = []
  private controller: AbortController | null = null
  private systemPrompt: string | null = null

  constructor(
    private readonly bot: Bot,
    private readonly registry: ToolRegistry,
    private readonly llm: LlmClient,
    private readonly config: Config['agent']
  ) {}

  get busy(): boolean {
    return this.controller !== null
  }

  submit(request: AgentRequest) {
    this.queue.push(request)
    if (this.busy) {
      this.bot.chat(`Queued (${this.queue.length} waiting). Say "stop" to cancel the current task.`)
      return
    }
    void this.drain()
  }

  /** Cancel the running task and everything queued behind it. */
  cancel(): boolean {
    const hadWork = this.busy || this.queue.length > 0
    this.queue.length = 0
    this.controller?.abort()
    this.llm.abort()
    stopAllMovement(this.bot)
    return hadWork
  }

  private async drain() {
    while (this.queue.length > 0) {
      const request = this.queue.shift()!
      this.controller = new AbortController()
      try {
        await this.run(request, this.controller.signal)
      } catch (error) {
        if (error instanceof TaskCancelledError || this.controller.signal.aborted) {
          log.info('Task cancelled')
        } else {
          log.error('Agent error', error)
          this.bot.chat(`Something went wrong: ${errorMessage(error).slice(0, 120)}`)
        }
      } finally {
        this.controller = null
      }
    }
  }

  private async run(request: AgentRequest, signal: AbortSignal) {
    log.info(`${request.username}: ${request.message}`)
    this.systemPrompt ??= buildSystemPrompt(this.bot.username, this.registry)

    const userMessage: Message = {
      role: 'user',
      content: buildUserMessage(request.username, request.message, describeWorldState(this.bot))
    }
    const messages: Message[] = [
      { role: 'system', content: this.systemPrompt },
      ...this.history,
      userMessage
    ]
    const tools = this.registry.toOllamaTools()
    const ctx = { bot: this.bot, signal, log, requester: request.username }

    let reply = ''
    let step = 0
    for (; step < this.config.maxSteps; step++) {
      const response = await this.llm.chat(messages, tools)
      if (signal.aborted) throw new TaskCancelledError()
      messages.push(response)

      const calls = response.tool_calls ?? []
      if (calls.length === 0) {
        reply = response.content.trim()
        break
      }

      for (const call of calls) {
        const name = call.function.name
        log.info(`→ ${name} ${JSON.stringify(call.function.arguments)}`)
        const outcome = await this.registry.execute({ name, arguments: call.function.arguments }, ctx)
        const output = outcome.output.length > maxToolOutput ? `${outcome.output.slice(0, maxToolOutput)}… (truncated)` : outcome.output
        log.info(`${outcome.ok ? '✓' : '✗'} ${name}: ${output.split('\n')[0]}`)
        messages.push({ role: 'tool', tool_name: name, content: output })
      }
    }

    if (step >= this.config.maxSteps) {
      reply = `I stopped after ${this.config.maxSteps} steps without finishing. Tell me how to continue.`
    }
    if (reply) this.bot.chat(reply.slice(0, 256))

    this.remember(request, reply)
  }

  /** Keep a compact record: the request without the bulky state dump, and the final reply. */
  private remember(request: AgentRequest, reply: string) {
    this.history.push(
      { role: 'user', content: `${request.username} says: ${request.message}` },
      { role: 'assistant', content: reply || '(done)' }
    )
    while (this.history.length > historyTurns * 2) this.history.shift()
  }
}
