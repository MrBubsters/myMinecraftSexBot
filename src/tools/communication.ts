import { ToolInputError } from './args.js'
import { defineTool } from './types.js'

const category = 'Communication'

export const communicationTools = [
  defineTool({
    name: 'say',
    category,
    description: 'Send a short message in Minecraft chat. Use for answers, progress updates and questions.',
    params: {
      message: { type: 'string', description: 'The message (keep under ~200 characters)', required: true }
    },
    async handler(args, { bot }) {
      const message = args.string('message')
      // Chat starting with "/" would run a server command; the bot must not do that on its own.
      if (message.startsWith('/')) throw new ToolInputError('Messages may not start with "/"')
      bot.chat(message.slice(0, 256))
      return 'Message sent'
    }
  })
]
