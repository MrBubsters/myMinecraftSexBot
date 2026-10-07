import minecraftData from 'minecraft-data'
import { Bot } from 'mineflayer'
import { Entity } from 'prismarine-entity'
import { Vec3 } from 'vec3'
import { createLogger } from '../util/logger.js'

const log = createLogger('protocol')

type Location = { x: number; y: number; z: number }

type LastSeenRing = Array<{ signature: Buffer; pending: boolean } | null | undefined> & {
  capacity: number
  offset: number
  pending: number
}

/**
 * Work around protocol bugs in the 26.2 mineflayer / minecraft-protocol forks.
 * Documented in docs/PROTOCOL_WORKAROUNDS.md; `npm run check:protocol` reports which are still needed.
 */
export function applyProtocolFixes(bot: Bot) {
  fixEntityPackets(bot)
  fixChatChecksum(bot)
}

/**
 * The 26.2 mineflayer fork still sends the pre-26.x `use_entity` packet
 * ({ target, mouse, sneaking }). Since 26.x, attacking is a separate `attack`
 * packet and `use_entity` requires { target, hand, location, usingSecondaryAction };
 * the old shape fails to serialize and wedges the connection until the server
 * times the bot out. Replace the affected methods when the new packets exist.
 */
function fixEntityPackets(bot: Bot) {
  const toServer = minecraftData(bot.version).protocol.play.toServer.types as Record<string, unknown>
  if (!toServer.packet_attack) return

  const useEntity = (target: Entity, location: Location = { x: 0, y: 0, z: 0 }) => {
    bot._client.write('use_entity', {
      target: target.id,
      hand: 0,
      location,
      usingSecondaryAction: bot.getControlState('sneak')
    })
  }

  bot.attack = (target: Entity, swing = true) => {
    bot._client.write('attack', { entityId: target.id })
    if (swing) bot.swingArm('right')
  }
  bot.useOn = target => useEntity(target)
  bot.mount = target => useEntity(target)
  bot.activateEntity = async (entity: Entity) => {
    await bot.lookAt(entity.position.offset(0, 1, 0), false)
    useEntity(entity)
  }
  bot.activateEntityAt = async (entity: Entity, position: Vec3) => {
    await bot.lookAt(position, false)
    useEntity(entity, position.minus(entity.position))
  }

  log.info(`Applied entity-interaction packet fixes for ${bot.version}`)
}

/**
 * Signed chat (1.21.5+) sends a checksum of the last-seen message signatures.
 * Vanilla hashes the 20-slot ring oldest-first starting at its tail; the fork
 * iterates the raw array from index 0. The two agree until the ring wraps, so
 * after ~20 signed chat messages every message the bot sends fails the server's
 * check and it is kicked with "chat_validation_failed". Make the ring iterate in
 * vanilla order, and keep its position counters when the fork replaces it on
 * hide_message (it rebuilds it with .map(), which resets offset/pending to 0).
 */
function fixChatChecksum(bot: Bot) {
  const client = bot._client as unknown as { _lastSeenMessages?: LastSeenRing }
  const ring = client._lastSeenMessages
  if (!ring || typeof ring.offset !== 'number') return

  Object.defineProperty(ring, Symbol.iterator, {
    value: function* (this: LastSeenRing) {
      for (let i = 0; i < this.capacity; i++) {
        const entry = this[(this.offset + i) % this.capacity]
        if (entry) yield entry
      }
    }
  })

  Object.defineProperty(client, '_lastSeenMessages', {
    configurable: true,
    get: () => ring,
    set: (next: LastSeenRing) => {
      for (let i = 0; i < ring.capacity; i++) ring[i] = next[i] ?? null
    }
  })

  log.info('Applied signed-chat checksum fix')
}
