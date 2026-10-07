import { Message, Ollama, Tool, ToolCall } from 'ollama'
import { Config } from '../config.js'

export type { Message }

export class LlmClient {
  private readonly client: Ollama

  constructor(private readonly config: Config['llm']) {
    this.client = new Ollama({ host: config.host })
  }

  /**
   * Streams internally (ollama-js can only abort streamed requests) and
   * returns the assembled assistant message.
   */
  async chat(messages: Message[], tools: Tool[]): Promise<Message> {
    const stream = await this.client.chat({
      model: this.config.model,
      messages,
      tools,
      think: this.config.think,
      options: { num_ctx: this.config.numCtx },
      stream: true
    })

    let content = ''
    let thinking = ''
    const toolCalls: ToolCall[] = []
    for await (const chunk of stream) {
      content += chunk.message.content ?? ''
      thinking += chunk.message.thinking ?? ''
      toolCalls.push(...(chunk.message.tool_calls ?? []))
    }

    return {
      role: 'assistant',
      content,
      ...(thinking ? { thinking } : {}),
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
    }
  }

  /** Abort any in-flight request (used when a task is cancelled). */
  abort() {
    this.client.abort()
  }
}
