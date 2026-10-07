import { Vec3 } from 'vec3'
import { countItem } from '../bot/inventory.js'
import { placeBlockAt, placeBlockNearby } from '../bot/placement.js'
import { formatPos, resolveItem } from '../bot/world.js'
import { TaskCancelledError, errorMessage, throwIfAborted } from '../util/async.js'
import { ToolInputError } from './args.js'
import { defineTool, positionParams, readOptionalPosition } from './types.js'

const category = 'Building'
const maxFillVolume = 512

export const buildingTools = [
  defineTool({
    name: 'place_block',
    category,
    description: 'Place a block from the inventory at coordinates (needs a solid neighbouring block), or right next to the bot if coordinates are omitted.',
    params: {
      item: { type: 'string', description: 'Block item to place, e.g. "cobblestone", "torch", "crafting_table"', required: true },
      ...positionParams('where to place it (omit for next to the bot)', false)
    },
    async handler(args, { bot, signal }) {
      const name = resolveItem(bot, args.string('item')).name
      const pos = readOptionalPosition(args)
      const placed = pos ? await placeBlockAt(bot, name, pos, signal) : await placeBlockNearby(bot, name, signal)
      return `Placed ${placed.name} at ${formatPos(placed.position)}`
    }
  }),

  defineTool({
    name: 'fill_region',
    category,
    description:
      `Fill a cuboid between two corners with a block, building bottom layer first (max ${maxFillVolume} blocks). ` +
      'Use for walls (one axis thin), floors (y1 = y2), pillars and simple structures. Already-filled spots are skipped.',
    params: {
      item: { type: 'string', description: 'Block item to place', required: true },
      x1: { type: 'number', description: 'Corner 1 X', required: true },
      y1: { type: 'number', description: 'Corner 1 Y', required: true },
      z1: { type: 'number', description: 'Corner 1 Z', required: true },
      x2: { type: 'number', description: 'Corner 2 X', required: true },
      y2: { type: 'number', description: 'Corner 2 Y', required: true },
      z2: { type: 'number', description: 'Corner 2 Z', required: true },
      hollow: { type: 'boolean', description: 'Only build the outer shell (walls, floor and roof) of the box' }
    },
    async handler(args, { bot, signal, log }) {
      const name = resolveItem(bot, args.string('item')).name
      const [x1, y1, z1, x2, y2, z2] = ['x1', 'y1', 'z1', 'x2', 'y2', 'z2'].map(k => Math.floor(args.number(k)))
      const [minX, maxX] = [Math.min(x1, x2), Math.max(x1, x2)]
      const [minY, maxY] = [Math.min(y1, y2), Math.max(y1, y2)]
      const [minZ, maxZ] = [Math.min(z1, z2), Math.max(z1, z2)]
      const hollow = args.boolean('hollow', false)

      const targets: Vec3[] = []
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          for (let z = minZ; z <= maxZ; z++) {
            const shell = x === minX || x === maxX || y === minY || y === maxY || z === minZ || z === maxZ
            if (!hollow || shell) targets.push(new Vec3(x, y, z))
          }
        }
      }
      if (targets.length > maxFillVolume) throw new ToolInputError(`Region has ${targets.length} blocks; max is ${maxFillVolume}. Split it up.`)

      const needed = targets.filter(p => bot.blockAt(p)?.boundingBox === 'empty').length
      const have = countItem(bot, name)
      if (have === 0) throw new ToolInputError(`No ${name} in inventory (need about ${needed})`)

      let placed = 0
      let skipped = 0
      // Order each layer from nearest to farthest so the bot builds outward.
      targets.sort((a, b) => a.y - b.y || a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))
      for (const pos of targets) {
        throwIfAborted(signal)
        if (bot.blockAt(pos)?.boundingBox !== 'empty') continue
        if (countItem(bot, name) === 0) break
        try {
          await placeBlockAt(bot, name, pos, signal)
          placed++
        } catch (error) {
          if (error instanceof TaskCancelledError) throw error
          log.debug(`fill_region skip ${pos}: ${errorMessage(error)}`)
          skipped++
        }
      }

      const remaining = targets.filter(p => bot.blockAt(p)?.boundingBox === 'empty').length
      const shortage = remaining > 0 && countItem(bot, name) === 0 ? ` Ran out of ${name}.` : ''
      return `Placed ${placed} ${name}; ${remaining} spot(s) still empty, ${skipped} failed placement(s).${shortage}`
    }
  })
]
