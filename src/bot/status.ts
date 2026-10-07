import { Bot } from 'mineflayer'
import { summarizeInventory, freeSlots } from './inventory.js'
import { entityLabel, formatPos, nearbyEntities } from './world.js'

export function timeOfDayLabel(bot: Bot): string {
  const t = bot.time.timeOfDay
  if (t < 1000) return 'sunrise'
  if (t < 6000) return 'morning'
  if (t < 12000) return 'afternoon'
  if (t < 13000) return 'sunset (beds usable soon)'
  if (t < 23000) return 'night (hostile mobs spawn, beds usable)'
  return 'dawn'
}

export function describeEquipment(bot: Bot): string {
  const slots = bot.inventory.slots
  const parts = [
    `hand: ${bot.heldItem?.name ?? 'empty'}`,
    `off-hand: ${slots[45]?.name ?? 'empty'}`,
    `head: ${slots[5]?.name ?? 'none'}`,
    `chest: ${slots[6]?.name ?? 'none'}`,
    `legs: ${slots[7]?.name ?? 'none'}`,
    `feet: ${slots[8]?.name ?? 'none'}`
  ]
  return parts.join(', ')
}

export function describeStatus(bot: Bot): string {
  const pos = bot.entity.position
  const biome = bot.blockAt(pos)?.biome?.name ?? 'unknown'
  return [
    `Position: ${formatPos(pos)} (${bot.game.dimension}, biome ${biome})`,
    `Health: ${Math.round(bot.health)}/20, Food: ${bot.food}/20, Saturation: ${bot.foodSaturation.toFixed(1)}, Oxygen: ${bot.oxygenLevel}/20`,
    `XP level: ${bot.experience.level}`,
    `Time: ${timeOfDayLabel(bot)} (tick ${bot.time.timeOfDay}), weather: ${bot.thunderState > 0 ? 'thunder' : bot.isRaining ? 'rain' : 'clear'}`,
    `Game mode: ${bot.game.gameMode}`,
    `Equipment: ${describeEquipment(bot)}`
  ].join('\n')
}

/** Compact snapshot sent to the LLM with every request. */
export function describeWorldState(bot: Bot): string {
  const entities = nearbyEntities(bot, 24)
    .slice(0, 15)
    .map(e => `${entityLabel(e)} @ ${formatPos(e.position)} (${e.position.distanceTo(bot.entity.position).toFixed(0)}m)`)

  return [
    describeStatus(bot),
    `Inventory (${freeSlots(bot)} free slots): ${summarizeInventory(bot)}`,
    `Nearby entities: ${entities.length > 0 ? entities.join('; ') : 'none'}`
  ].join('\n')
}
