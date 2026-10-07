import { Bot } from 'mineflayer'
import { Agent } from '../agent/agent.js'
import { summarizeInventory } from '../bot/inventory.js'
import { formatPos } from '../bot/world.js'

type Command = { description: string; run: (bot: Bot, agent: Agent) => void }

/** Instant commands that bypass the LLM. Everything else goes to the agent. */
const commands: Record<string, Command> = {
  stop: {
    description: 'cancel the current task and queue',
    run: (bot, agent) => bot.chat(agent.cancel() ? 'Stopped.' : 'Nothing to stop.')
  },
  ping: {
    description: 'check the bot is alive',
    run: bot => bot.chat('Pong!')
  },
  where: {
    description: 'current coordinates',
    run: bot => bot.chat(`I'm at ${formatPos(bot.entity.position)}`)
  },
  inv: {
    description: 'inventory summary',
    run: bot => bot.chat(summarizeInventory(bot).slice(0, 250))
  },
  status: {
    description: 'health, food, busy state',
    run: (bot, agent) => bot.chat(`HP ${Math.round(bot.health)}/20, food ${bot.food}/20, ${agent.busy ? 'busy' : 'idle'}`)
  },
  help: {
    description: 'list commands',
    run: bot => bot.chat(`Commands: ${Object.entries(commands).map(([n, c]) => `!${n} (${c.description})`).join(', ')}. Anything else is handled by the AI.`)
  }
}

/** Handle a "!command" (or a bare "stop"). Returns true if the message was consumed. */
export function tryHandleCommand(bot: Bot, agent: Agent, message: string): boolean {
  const text = message.trim().toLowerCase()
  if (text === 'stop') {
    commands.stop.run(bot, agent)
    return true
  }
  if (!text.startsWith('!')) return false
  const command = commands[text.slice(1).split(/\s+/)[0]]
  if (!command) return false
  command.run(bot, agent)
  return true
}
