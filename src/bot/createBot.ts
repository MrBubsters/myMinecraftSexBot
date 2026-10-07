import mineflayer, { Bot } from 'mineflayer'
import { pathfinder } from 'mineflayer-pathfinder'
import { Config } from '../config.js'
import { createLogger } from '../util/logger.js'
import { configureMovements } from './navigation.js'

const log = createLogger('bot')

export function createBot(config: Config): Bot {
  const { minecraft } = config

  const bot = mineflayer.createBot({
    host: minecraft.host,
    port: minecraft.port,
    username: minecraft.account,
    auth: minecraft.auth,
    version: minecraft.version,
    profilesFolder: minecraft.profilesFolder
  })

  bot.loadPlugin(pathfinder)

  bot.once('spawn', () => {
    configureMovements(bot)
    log.info(`Connected as ${bot.username}`)
  })

  bot.on('death', () => log.warn('Bot died'))
  bot.on('kicked', reason => log.error('Kicked:', reason))
  bot.on('error', error => log.error('Error:', error))
  bot.on('end', reason => log.info(`Disconnected: ${reason}`))

  return bot
}
