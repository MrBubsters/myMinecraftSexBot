import mineflayer, { Bot } from 'mineflayer'
import { pathfinder } from 'mineflayer-pathfinder'
import { Config } from '../config.js'
import { createLogger } from '../util/logger.js'
import { configureMovements } from './navigation.js'
import { applyProtocolFixes } from './protocolFixes.js'
import { installDiagnostics } from './diagnostics.js'
import { serverboundTableFix } from './packetTablePatch.js'

const log = createLogger('bot')

export function createBot(config: Config): Bot {
  const { minecraft } = config

  const bot = mineflayer.createBot({
    host: minecraft.host,
    port: minecraft.port,
    username: minecraft.account,
    auth: minecraft.auth,
    version: minecraft.version,
    profilesFolder: minecraft.profilesFolder,
    customPackets: serverboundTableFix(minecraft.version)
  })

  bot.loadPlugin(pathfinder)
  installDiagnostics(bot, config.diagnostics)

  // Internal plugins are injected once the version is known; patch them after that.
  bot.once('login', () => applyProtocolFixes(bot))

  bot.once('spawn', () => {
    configureMovements(bot)
    log.info(`Connected as ${bot.username}`)
  })

  bot.on('death', () => log.warn('Bot died'))
  bot.on('messagestr', (message, position) => {
    if (position !== 'chat') log.debug(`[server] ${message}`)
  })
  bot.on('end', reason => log.info(`Disconnected: ${reason}`))

  return bot
}
