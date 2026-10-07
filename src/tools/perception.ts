import { Vec3 } from 'vec3'
import { requiredHarvestTools, summarizeInventory, freeSlots, canHarvest } from '../bot/inventory.js'
import { describeStatus } from '../bot/status.js'
import { entityLabel, formatPos, isHostile, nearbyEntities, resolveBlockFamily } from '../bot/world.js'
import { ToolInputError } from './args.js'
import { defineTool, positionParams, readPosition } from './types.js'

const category = 'Perception'

export const perceptionTools = [
  defineTool({
    name: 'get_status',
    category,
    description: 'Health, hunger, position, dimension, biome, time of day, weather and equipped gear.',
    params: {},
    async handler(_args, { bot }) {
      return describeStatus(bot)
    }
  }),

  defineTool({
    name: 'check_inventory',
    category,
    description: 'List everything in the inventory with counts.',
    params: {},
    async handler(_args, { bot }) {
      return `Inventory (${freeSlots(bot)} free slots): ${summarizeInventory(bot)}`
    }
  }),

  defineTool({
    name: 'look_around',
    category,
    description: 'List nearby players, mobs, animals and dropped items with positions and distances.',
    params: {
      radius: { type: 'number', description: 'Search radius in blocks (default 24)' }
    },
    async handler(args, { bot }) {
      const radius = args.optionalNumber('radius', { min: 1, max: 96 }) ?? 24
      const entities = nearbyEntities(bot, radius).slice(0, 25)
      if (entities.length === 0) return `Nothing within ${radius} blocks`
      return entities.map(e => {
        const tag = isHostile(e) ? ' [hostile]' : ''
        return `${entityLabel(e)}${tag} at ${formatPos(e.position)}, ${e.position.distanceTo(bot.entity.position).toFixed(1)}m`
      }).join('\n')
    }
  }),

  defineTool({
    name: 'find_blocks',
    category,
    description: 'Locate the nearest blocks of a type. Accepts exact names ("iron_ore") or families ("log", "iron", "bed", "water").',
    params: {
      block: { type: 'string', description: 'Block name or family', required: true },
      max_distance: { type: 'number', description: 'Search radius (default 64, max 128)' },
      count: { type: 'integer', description: 'Max results (default 5)' }
    },
    async handler(args, { bot }) {
      const { ids, names } = resolveBlockFamily(bot, args.string('block'))
      const positions = bot.findBlocks({
        matching: ids,
        maxDistance: args.optionalNumber('max_distance', { min: 1, max: 128 }) ?? 64,
        count: args.int('count', 5, { min: 1, max: 20 })
      })
      if (positions.length === 0) return `No ${names.slice(0, 4).join('/')} found nearby`
      return positions.map(pos => {
        const block = bot.blockAt(pos)
        return `${block?.name ?? '?'} at ${formatPos(pos)}, ${pos.distanceTo(bot.entity.position).toFixed(0)}m`
      }).join('\n')
    }
  }),

  defineTool({
    name: 'inspect_block',
    category,
    description: 'Describe the block at coordinates: name, hardness, which tools can harvest it, and whether the bot can.',
    params: positionParams('the block'),
    async handler(args, { bot }) {
      const pos = readPosition(args)
      const block = bot.blockAt(pos)
      if (!block) throw new ToolInputError(`Block at ${formatPos(pos)} is not loaded`)
      const tools = requiredHarvestTools(bot, block)
      return [
        `${block.name} at ${formatPos(pos)}`,
        `hardness: ${block.hardness ?? 'n/a'}${block.diggable ? '' : ' (not diggable)'}`,
        `harvest tools: ${tools ? tools.join(', ') : 'any / hand'}`,
        `can harvest now: ${canHarvest(bot, block) ? 'yes' : 'no'}`
      ].join('\n')
    }
  }),

  defineTool({
    name: 'block_below',
    category,
    description: 'Name the blocks directly under and around the bot\'s feet (useful to know what you are standing on).',
    params: {},
    async handler(_args, { bot }) {
      const base = bot.entity.position.floored()
      const describe = (dx: number, dy: number, dz: number) => bot.blockAt(base.plus(new Vec3(dx, dy, dz)))?.name ?? '?'
      return `below: ${describe(0, -1, 0)}, feet: ${describe(0, 0, 0)}, head: ${describe(0, 1, 0)}, above: ${describe(0, 2, 0)}`
    }
  }),

  defineTool({
    name: 'list_players',
    category,
    description: 'List online players and, if visible, their positions.',
    params: {},
    async handler(_args, { bot }) {
      return Object.values(bot.players)
        .filter(p => p.username !== bot.username)
        .map(p => p.entity ? `${p.username} at ${formatPos(p.entity.position)}` : `${p.username} (not in view)`)
        .join('\n') || 'No other players online'
    }
  })
]
