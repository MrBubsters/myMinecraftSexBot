import { Agent } from './agent/agent.js'
import { LlmClient } from './agent/llm.js'
import { enableAutoEat } from './bot/behaviors.js'
import { createBot } from './bot/createBot.js'
import { tryHandleCommand } from './chat/commands.js'
import { listenForOwnerMessages } from './chat/listener.js'
import { loadConfig } from './config.js'
import path from 'path'
import { loadKnowledgeBase } from './knowledge/knowledgeBase.js'
import { setKnowledgeBase, setKnowledgeUnavailable } from './tools/knowledge.js'
import { createToolRegistry } from './tools/registry.js'
import { createLogger } from './util/logger.js'

const log = createLogger('main')

function main() {
  const config = loadConfig()
  const bot = createBot(config)
  const registry = createToolRegistry()
  const agent = new Agent(bot, registry, new LlmClient(config.llm), config.agent)

  log.info(`Loaded ${registry.list().length} tools; model ${config.llm.model}`)

  // Built from the official server jar on first run (downloads it), then cached in .cache/.
  // Loads in the background so it never delays connecting.
  loadKnowledgeBase(config.minecraft.version, path.resolve(process.cwd(), '.cache'))
    .then(setKnowledgeBase)
    .catch(error => {
      log.warn(`Knowledge base unavailable: ${(error as Error).message}`)
      setKnowledgeUnavailable((error as Error).message)
    })

  bot.once('spawn', () => {
    if (config.agent.autoEat) enableAutoEat(bot, () => agent.busy)

    listenForOwnerMessages(bot, config.owners, ({ source, username, message }) => {
      log.info(`[${source}] ${username}: ${message}`)
      if (tryHandleCommand(bot, agent, message)) return
      agent.submit({ username, message })
    })
  })

  bot.on('end', () => {
    agent.cancel()
  })
  process.on('SIGINT', () => {
    agent.cancel()
    bot.quit()
    process.exit(0)
  })
}

main()
