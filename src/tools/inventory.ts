import { EquipmentDestination } from 'mineflayer'
import { goals } from 'mineflayer-pathfinder'
import { countItem, equipBestArmor, findItem } from '../bot/inventory.js'
import { navigate } from '../bot/navigation.js'
import { findEntity, resolveItem } from '../bot/world.js'
import { sleep } from '../util/async.js'
import { ToolInputError } from './args.js'
import { defineTool } from './types.js'

const category = 'Inventory'
const destinations = ['hand', 'off-hand', 'head', 'torso', 'legs', 'feet'] as const

export const inventoryTools = [
  defineTool({
    name: 'equip_item',
    category,
    description: 'Hold or wear an item from the inventory.',
    params: {
      item: { type: 'string', description: 'Item name', required: true },
      slot: { type: 'string', description: 'Where to equip it (default hand)', enum: destinations }
    },
    async handler(args, { bot }) {
      const name = resolveItem(bot, args.string('item')).name
      const item = findItem(bot, name)
      if (!item) throw new ToolInputError(`No ${name} in inventory`)
      const slot = args.enumValue('slot', destinations, 'hand') as EquipmentDestination
      await bot.equip(item, slot)
      return `Equipped ${name} in ${slot}`
    }
  }),

  defineTool({
    name: 'unequip',
    category,
    description: 'Take off armour or empty a hand.',
    params: {
      slot: { type: 'string', description: 'Slot to clear', enum: destinations, required: true }
    },
    async handler(args, { bot }) {
      const slot = args.enumValue('slot', destinations) as EquipmentDestination
      await bot.unequip(slot)
      return `Cleared ${slot}`
    }
  }),

  defineTool({
    name: 'equip_best_armor',
    category,
    description: 'Put on the best armour pieces in the inventory.',
    params: {},
    async handler(_args, { bot }) {
      const equipped = await equipBestArmor(bot)
      return equipped.length > 0 ? `Equipped ${equipped.join(', ')}` : 'No better armour in inventory'
    }
  }),

  defineTool({
    name: 'drop_item',
    category,
    description: 'Throw items on the ground at the bot\'s location.',
    params: {
      item: { type: 'string', description: 'Item name', required: true },
      count: { type: 'integer', description: 'How many (default: all)' }
    },
    async handler(args, { bot }) {
      const item = resolveItem(bot, args.string('item'))
      const have = countItem(bot, item.name)
      if (have === 0) throw new ToolInputError(`No ${item.name} in inventory`)
      const count = Math.min(args.int('count', have, { min: 1 }), have)
      await bot.toss(item.id, null, count)
      return `Dropped ${count} ${item.name}`
    }
  }),

  defineTool({
    name: 'give_item',
    category,
    description: 'Walk to a player and toss them items.',
    params: {
      player: { type: 'string', description: 'Player username', required: true },
      item: { type: 'string', description: 'Item name', required: true },
      count: { type: 'integer', description: 'How many (default: all)' }
    },
    async handler(args, { bot, signal }) {
      const username = args.string('player')
      const target = findEntity(bot, username, 256)
      if (!target || target.type !== 'player') throw new ToolInputError(`Player ${username} is not visible`)
      const item = resolveItem(bot, args.string('item'))
      const have = countItem(bot, item.name)
      if (have === 0) throw new ToolInputError(`No ${item.name} in inventory`)
      const count = Math.min(args.int('count', have, { min: 1 }), have)

      const { x, y, z } = target.position
      await navigate(bot, new goals.GoalNear(x, y, z, 2), { signal })
      await bot.lookAt(target.position.offset(0, target.height * 0.8, 0), true)
      await bot.toss(item.id, null, count)
      await sleep(300, signal)
      return `Gave ${count} ${item.name} to ${username}`
    }
  }),

  defineTool({
    name: 'select_hotbar_slot',
    category,
    description: 'Switch the held hotbar slot (0-8).',
    params: {
      slot: { type: 'integer', description: 'Hotbar slot 0-8', required: true }
    },
    async handler(args, { bot }) {
      const slot = args.int('slot', 0, { min: 0, max: 8 })
      bot.setQuickBarSlot(slot)
      return `Holding slot ${slot}: ${bot.heldItem?.name ?? 'empty'}`
    }
  }),

  defineTool({
    name: 'count_item',
    category,
    description: 'Count how many of a specific item the bot has.',
    params: {
      item: { type: 'string', description: 'Item name', required: true }
    },
    async handler(args, { bot }) {
      const item = resolveItem(bot, args.string('item'))
      return `${countItem(bot, item.name)} ${item.name}`
    }
  })
]
