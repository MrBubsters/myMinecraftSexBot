import { Bot } from 'mineflayer'
import { Block } from 'prismarine-block'
import { countItem, describeInventoryChange, snapshotInventory } from '../bot/inventory.js'
import { goToBlock } from '../bot/navigation.js'
import { formatPos, resolveItem } from '../bot/world.js'
import { errorMessage } from '../util/async.js'
import { Args, ToolInputError } from './args.js'
import { defineTool, positionParams, readOptionalPosition } from './types.js'

const category = 'Storage'

function isContainer(name: string): boolean {
  return name === 'chest' || name === 'trapped_chest' || name === 'barrel' || name === 'ender_chest' || name.endsWith('shulker_box')
}

async function openTargetContainer(bot: Bot, args: Args, signal: AbortSignal) {
  const pos = readOptionalPosition(args)
  let block: Block | null
  if (pos) {
    block = bot.blockAt(pos)
    if (!block || !isContainer(block.name)) throw new ToolInputError(`No container at ${formatPos(pos)} (found ${block?.name ?? 'nothing'})`)
  } else {
    block = bot.findBlock({ matching: b => isContainer(b.name), maxDistance: 32 })
    if (!block) throw new ToolInputError('No chest, barrel or shulker box within 32 blocks')
  }
  await goToBlock(bot, block.position, { signal })
  const window = await bot.openContainer(block)
  return { block, window }
}

function listItems(items: Array<{ name: string; count: number }>): string {
  const totals = new Map<string, number>()
  for (const item of items) totals.set(item.name, (totals.get(item.name) ?? 0) + item.count)
  return [...totals.entries()].map(([name, count]) => `${name} x${count}`).join(', ') || 'empty'
}

const containerParams = positionParams('the container (omit to use the nearest one)', false)

export const containerTools = [
  defineTool({
    name: 'view_container',
    category,
    description: 'Open a chest/barrel/shulker box and list its contents.',
    params: containerParams,
    async handler(args, { bot, signal }) {
      const { block, window } = await openTargetContainer(bot, args, signal)
      try {
        return `${block.name} at ${formatPos(block.position)} contains: ${listItems(window.containerItems())}`
      } finally {
        window.close()
      }
    }
  }),

  defineTool({
    name: 'deposit_items',
    category,
    description: 'Put items from the inventory into a container. Use item "all" to store everything except equipped tools.',
    params: {
      item: { type: 'string', description: 'Item name, or "all"', required: true },
      count: { type: 'integer', description: 'How many (default: all of that item)' },
      ...containerParams
    },
    async handler(args, { bot, signal }) {
      const requested = args.string('item')
      const before = snapshotInventory(bot)
      const { block, window } = await openTargetContainer(bot, args, signal)
      const errors: string[] = []
      try {
        const names = requested.toLowerCase() === 'all'
          ? [...new Set(bot.inventory.items().filter(i => i.slot !== bot.quickBarSlot + 36).map(i => i.name))]
          : [resolveItem(bot, requested).name]
        for (const name of names) {
          const have = countItem(bot, name)
          if (have === 0) { errors.push(`no ${name} in inventory`); continue }
          const count = requested.toLowerCase() === 'all' ? have : Math.min(args.int('count', have, { min: 1 }), have)
          try {
            await window.deposit(bot.registry.itemsByName[name].id, null, count)
          } catch (error) {
            errors.push(`${name}: ${errorMessage(error)}`)
          }
        }
      } finally {
        window.close()
      }
      const issues = errors.length > 0 ? ` Problems: ${errors.join('; ')}` : ''
      return `Deposited into ${block.name} at ${formatPos(block.position)}. Inventory change: ${describeInventoryChange(before, snapshotInventory(bot))}.${issues}`
    }
  }),

  defineTool({
    name: 'withdraw_items',
    category,
    description: 'Take items out of a container.',
    params: {
      item: { type: 'string', description: 'Item name', required: true },
      count: { type: 'integer', description: 'How many (default: all available)' },
      ...containerParams
    },
    async handler(args, { bot, signal }) {
      const item = resolveItem(bot, args.string('item'))
      const before = snapshotInventory(bot)
      const { block, window } = await openTargetContainer(bot, args, signal)
      try {
        const available = window.containerItems().filter(i => i.name === item.name).reduce((s, i) => s + i.count, 0)
        if (available === 0) throw new ToolInputError(`${block.name} has no ${item.name}. Contents: ${listItems(window.containerItems())}`)
        const count = Math.min(args.int('count', available, { min: 1 }), available)
        await window.withdraw(item.id, null, count)
      } finally {
        window.close()
      }
      return `Inventory change: ${describeInventoryChange(before, snapshotInventory(bot))}`
    }
  })
]
