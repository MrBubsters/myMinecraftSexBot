import { goals } from 'mineflayer-pathfinder'
import { bestFood, findItem } from '../bot/inventory.js'
import { navigate } from '../bot/navigation.js'
import { resolveBlockFamily, resolveItem } from '../bot/world.js'
import { ToolInputError } from './args.js'
import { defineTool } from './types.js'

const category = 'Survival'

export const survivalTools = [
  defineTool({
    name: 'eat',
    category,
    description: 'Eat food from the inventory (best food automatically unless one is named).',
    params: {
      food: { type: 'string', description: 'Food item to eat (optional)' }
    },
    async handler(args, { bot }) {
      if (bot.food >= 20) return 'Not hungry (food is full)'
      const requested = args.optionalString('food')
      const item = requested ? findItem(bot, resolveItem(bot, requested).name) : bestFood(bot)
      if (!item) throw new ToolInputError(requested ? `No ${requested} in inventory` : 'No food in inventory. Hunt animals, then cook the meat with smelt_item.')
      const before = bot.food
      await bot.equip(item, 'hand')
      await bot.consume()
      return `Ate ${item.name}; food ${before} -> ${bot.food}`
    }
  }),

  defineTool({
    name: 'sleep',
    category,
    description: 'Find a nearby bed and sleep in it (only works at night or during thunderstorms). Skips the night.',
    params: {},
    async handler(_args, { bot, signal }) {
      const { ids } = resolveBlockFamily(bot, 'bed')
      const bed = bot.findBlock({ matching: ids, maxDistance: 48 })
      if (!bed) throw new ToolInputError('No bed within 48 blocks. Craft one from 3 wool + 3 planks and place it.')
      const { x, y, z } = bed.position
      await navigate(bot, new goals.GoalNear(x, y, z, 2), { signal })
      await bot.sleep(bed)
      return 'Sleeping in bed'
    }
  }),

  defineTool({
    name: 'wake_up',
    category,
    description: 'Get out of bed.',
    params: {},
    async handler(_args, { bot }) {
      if (!bot.isSleeping) return 'Not sleeping'
      await bot.wake()
      return 'Woke up'
    }
  })
]
