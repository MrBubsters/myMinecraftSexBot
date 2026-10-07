import { Bot } from 'mineflayer'
import { goals } from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'
import { canHarvest, describeInventoryChange, equipBestToolFor, requiredHarvestTools, snapshotInventory } from '../bot/inventory.js'
import { goToBlock, navigate } from '../bot/navigation.js'
import { formatPos, resolveBlockFamily } from '../bot/world.js'
import { TaskCancelledError, errorMessage, sleep, throwIfAborted, withTimeout } from '../util/async.js'
import { ToolInputError } from './args.js'
import { defineTool, positionParams, readPosition } from './types.js'

const category = 'Gathering'

/** Walk over dropped items near `around` so they get picked up. */
export async function pickUpDrops(bot: Bot, around: Vec3, radius: number, signal: AbortSignal): Promise<number> {
  await sleep(250, signal)
  let visited = 0
  for (let attempt = 0; attempt < 8; attempt++) {
    const drop = Object.values(bot.entities)
      .filter(e => e.name === 'item' && e.position.distanceTo(around) <= radius)
      .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0]
    if (!drop) break
    const { x, y, z } = drop.position
    try {
      await withTimeout(navigate(bot, new goals.GoalBlock(Math.floor(x), Math.floor(y), Math.floor(z)), { signal }), 8000, 'Pickup')
      await sleep(200, signal)
      visited++
    } catch (error) {
      if (error instanceof TaskCancelledError) throw error
      break
    }
  }
  return visited
}

async function digAt(bot: Bot, pos: Vec3, signal: AbortSignal) {
  const block = bot.blockAt(pos)
  if (!block || block.name === 'air' || block.name === 'cave_air') throw new ToolInputError(`No block at ${formatPos(pos)}`)
  if (!block.diggable) throw new ToolInputError(`${block.name} cannot be broken`)
  if (!canHarvest(bot, block)) {
    throw new ToolInputError(`${block.name} needs one of: ${requiredHarvestTools(bot, block)!.join(', ')} (it would drop nothing otherwise)`)
  }

  await goToBlock(bot, pos, { signal, allowDig: true })
  throwIfAborted(signal)
  await equipBestToolFor(bot, block)

  const onAbort = () => bot.stopDigging()
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    await bot.dig(block, true)
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
  throwIfAborted(signal)
  return block.name
}

export const gatheringTools = [
  defineTool({
    name: 'collect_block',
    category,
    description:
      'Find, walk to, mine and pick up blocks of a type. Picks the best tool automatically. ' +
      'Accepts families: "log"/"wood" (any tree), "stone" (drops cobblestone), "iron"/"coal"/"diamond" (ores incl. deepslate), "sand", "dirt".',
    params: {
      block: { type: 'string', description: 'Block name or family to mine', required: true },
      count: { type: 'integer', description: 'How many blocks to mine (default 1, max 64)' },
      max_distance: { type: 'number', description: 'Search radius (default 64)' }
    },
    async handler(args, { bot, signal, log }) {
      const { ids, names } = resolveBlockFamily(bot, args.string('block'))
      const count = args.int('count', 1, { min: 1, max: 64 })
      const maxDistance = args.optionalNumber('max_distance', { min: 4, max: 128 }) ?? 64
      const before = snapshotInventory(bot)
      const skipped = new Set<string>()
      let mined = 0
      let failures = 0
      let lastError = ''

      while (mined < count && failures < 5) {
        throwIfAborted(signal)
        const candidates = bot.findBlocks({ matching: ids, maxDistance, count: 32 })
          .filter(pos => !skipped.has(pos.toString()))
        if (candidates.length === 0) break

        const pos = candidates[0]
        const block = bot.blockAt(pos)!
        if (!canHarvest(bot, block)) {
          throw new ToolInputError(`${block.name} needs one of: ${requiredHarvestTools(bot, block)!.join(', ')}. Craft or obtain one first.`)
        }

        try {
          await digAt(bot, pos, signal)
          await pickUpDrops(bot, pos, 6, signal)
          mined++
          failures = 0
        } catch (error) {
          if (error instanceof TaskCancelledError) throw error
          lastError = errorMessage(error)
          log.debug(`Skipping block at ${pos}: ${lastError}`)
          skipped.add(pos.toString())
          failures++
        }
      }

      const change = describeInventoryChange(before, snapshotInventory(bot))
      if (mined === 0) {
        const reason = lastError ? ` Last error: ${lastError}` : ' Try explore to find more.'
        return `Mined nothing: no reachable ${names.slice(0, 4).join('/')} within ${maxDistance} blocks.${reason}`
      }
      const shortfall = mined < count ? ` (wanted ${count}; ran out of reachable blocks)` : ''
      return `Mined ${mined} block(s)${shortfall}. Inventory change: ${change}`
    }
  }),

  defineTool({
    name: 'dig_block',
    category,
    description: 'Break the single block at coordinates (and pick up its drop).',
    params: positionParams('the block to break'),
    async handler(args, { bot, signal }) {
      const pos = readPosition(args)
      const before = snapshotInventory(bot)
      const name = await digAt(bot, pos, signal)
      await pickUpDrops(bot, pos, 5, signal)
      return `Broke ${name} at ${formatPos(pos)}. Inventory change: ${describeInventoryChange(before, snapshotInventory(bot))}`
    }
  }),

  defineTool({
    name: 'pick_up_items',
    category,
    description: 'Collect dropped items lying on the ground nearby.',
    params: {
      radius: { type: 'number', description: 'Search radius (default 16)' }
    },
    async handler(args, { bot, signal }) {
      const before = snapshotInventory(bot)
      const radius = args.optionalNumber('radius', { min: 1, max: 32 }) ?? 16
      await pickUpDrops(bot, bot.entity.position, radius, signal)
      return `Inventory change: ${describeInventoryChange(before, snapshotInventory(bot))}`
    }
  })
]
