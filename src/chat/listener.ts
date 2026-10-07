import { Bot } from 'mineflayer'
import { Config } from '../config.js'
import { createLogger } from '../util/logger.js'

const log = createLogger('chat')

export type ChatSource = 'minecraft' | 'discord'
export type IncomingMessage = { source: ChatSource; username: string; message: string }

/** Discord bridge messages arrive as plain server messages like "Discord Chris: hello". */
const discordPattern = /^Discord\s+([^:]+):\s*(.*)$/

/** Forward messages from authorised owners (in-game or via the Discord bridge) to `onMessage`. */
export function listenForOwnerMessages(bot: Bot, owners: Config['owners'], onMessage: (msg: IncomingMessage) => void) {
  bot.on('chat', (username, message) => {
    if (username === bot.username) return
    if (username !== owners.minecraft) {
      log.debug(`Ignoring ${username}: ${message}`)
      return
    }
    onMessage({ source: 'minecraft', username, message: message.trim() })
  })

  if (!owners.discord) return

  bot.on('messagestr', raw => {
    const match = raw.match(discordPattern)
    if (!match) return
    const [, username, message] = match
    if (username.trim() !== owners.discord) {
      log.debug(`Ignoring Discord ${username}: ${message}`)
      return
    }
    // Requests from Discord are attributed to the in-game owner so player-relative commands ("come here") still work.
    onMessage({ source: 'discord', username: owners.minecraft, message: message.trim() })
  })
}
