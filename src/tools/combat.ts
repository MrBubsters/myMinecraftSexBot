import { Bot } from 'mineflayer'
import { Entity } from 'prismarine-entity'
import { goals } from 'mineflayer-pathfinder'
import { bestWeapon, describeInventoryChange, snapshotInventory } from '../bot/inventory.js'
import { entityLabel, findEntity, isHostile, nearbyEntities } from '../bot/world.js'
import { sleep, throwIfAborted } from '../util/async.js'
import { ToolInputError } from './args.js'
import { pickUpDrops } from './gathering.js'
import { defineTool } from './types.js'

const category = 'Combat'
const lowHealth = 6

function isAlive(bot: Bot, entity: Entity): boolean {
  return entity.isValid && bot.entities[entity.id] === entity
}

/** Chase and hit an entity until it dies, escapes, or the bot gets too hurt. */
export async function fight(bot: Bot, entity: Entity, signal: AbortSignal, timeoutMs: number): Promise<'killed' | 'escaped' | 'low_health' | 'timeout'> {
  const weapon = bestWeapon(bot)
  if (weapon && bot.heldItem?.type !== weapon.type) await bot.equip(weapon, 'hand')

  const deadline = Date.now() + timeoutMs
  let lastHit = 0
  bot.pathfinder.setGoal(new goals.GoalFollow(entity, 2), true)
  try {
    while (Date.now() < deadline) {
      throwIfAborted(signal)
      if (!isAlive(bot, entity)) return 'killed'
      if (bot.health <= lowHealth) return 'low_health'
      const distance = bot.entity.position.distanceTo(entity.position)
      if (distance > 32) return 'escaped'
      // Respect the attack cooldown (~0.6s for swords) so hits do full damage.
      if (distance <= 3.2 && Date.now() - lastHit >= 650) {
        await bot.lookAt(entity.position.offset(0, entity.height * 0.8, 0), true)
        bot.attack(entity)
        lastHit = Date.now()
      }
      await sleep(100, signal)
    }
    return 'timeout'
  } finally {
    bot.pathfinder.setGoal(null)
  }
}

export const combatTools = [
  defineTool({
    name: 'attack',
    category,
    description:
      'Fight a mob or player with the best weapon available, chasing it until it dies. Can repeat for several of the same mob ' +
      '(e.g. hunt 3 cows for food). Use target "hostile" for the nearest monster. Picks up drops afterwards. Stops if health gets low.',
    params: {
      target: { type: 'string', description: 'Mob name ("zombie", "cow"), player username, or "hostile"', required: true },
      count: { type: 'integer', description: 'How many to kill (default 1, max 10)' }
    },
    async handler(args, { bot, signal, requester }) {
      const target = args.string('target')
      if (target.toLowerCase() === requester.toLowerCase()) throw new ToolInputError('Refusing to attack the player giving me orders')
      const count = args.int('count', 1, { min: 1, max: 10 })
      const before = snapshotInventory(bot)
      let kills = 0
      let outcome = ''

      while (kills < count) {
        const entity = findEntity(bot, target, 48)
        if (!entity) {
          outcome = kills === 0 ? `No ${target} within 48 blocks.` : `No more ${target} nearby.`
          break
        }
        const result = await fight(bot, entity, signal, 45_000)
        if (result !== 'killed') {
          outcome = result === 'low_health' ? 'Stopped: health is low.' : `Stopped: target ${result}.`
          break
        }
        kills++
        await pickUpDrops(bot, entity.position, 6, signal)
      }

      if (kills === 0 && outcome) throw new ToolInputError(outcome)
      return `Killed ${kills} ${target}. ${outcome} Inventory change: ${describeInventoryChange(before, snapshotInventory(bot))}`.trim()
    }
  }),

  defineTool({
    name: 'defend',
    category,
    description: 'Fight every hostile mob within a radius until the area is clear.',
    params: {
      radius: { type: 'number', description: 'Radius to clear (default 16)' }
    },
    async handler(args, { bot, signal }) {
      const radius = args.optionalNumber('radius', { min: 4, max: 32 }) ?? 16
      const killed: string[] = []
      for (let i = 0; i < 15; i++) {
        const enemy = nearbyEntities(bot, radius).find(isHostile)
        if (!enemy) break
        const result = await fight(bot, enemy, signal, 30_000)
        if (result === 'low_health') return `Retreat advised: health ${Math.round(bot.health)}/20. Killed: ${killed.join(', ') || 'none'}`
        if (result === 'killed') killed.push(entityLabel(enemy))
      }
      return killed.length > 0 ? `Area clear. Killed: ${killed.join(', ')}` : 'No hostile mobs nearby'
    }
  })
]
