import { Bot } from 'mineflayer'
import { Movements } from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'
import { createLogger } from '../util/logger.js'

const log = createLogger('doors')

/** Wooden doors and fence gates open by hand; iron ones need redstone, so they stay walls. */
export function isHandOpenable(name: string): boolean {
  return (name.endsWith('_door') || name.endsWith('_fence_gate')) && !name.startsWith('iron_')
}

function isOpen(block: { getProperties: () => Record<string, unknown> }): boolean {
  return block.getProperties().open === true
}

/**
 * mineflayer-pathfinder judges blocks by type, not state, so every door counts
 * as a wall (open or closed) and its own door support is disabled. Tell the
 * planner hand-openable doors and gates are walkable; `enableDoorOpener` then
 * opens them as the bot reaches them.
 */
export function teachDoors(movements: Movements) {
  const original = movements.getBlock.bind(movements)
  movements.getBlock = (pos, dx, dy, dz) => {
    const block = original(pos, dx, dy, dz)
    if (block?.name && isHandOpenable(block.name)) {
      block.physical = false
      block.safe = true
      block.replaceable = false
    }
    return block
  }
}

const lookAhead = 3 // path nodes
const reach = 3 // blocks
const retryMs = 1000

/**
 * While the pathfinder is moving, open closed doors/gates on the next few path
 * nodes. Doors the bot opened are closed again once it is clear of them, so
 * houses stay shut against mobs; doors that were already open are left alone.
 */
export function enableDoorOpener(bot: Bot) {
  let path: Array<{ x: number; y: number; z: number }> = []
  const opened = new Map<string, Vec3>()
  const lastToggle = new Map<string, number>()
  let busy = false

  // The pathfinder shifts nodes off this same array as it walks, so it stays current.
  bot.on('path_update', (result: { path: Array<{ x: number; y: number; z: number }> }) => { path = result.path })
  bot.on('path_reset', () => { path = [] })

  const toggle = async (pos: Vec3, action: 'open' | 'close') => {
    const key = pos.toString()
    if (busy || Date.now() - (lastToggle.get(key) ?? 0) < retryMs) return
    const block = bot.blockAt(pos)
    if (!block || !isHandOpenable(block.name) || isOpen(block) === (action === 'open')) return
    busy = true
    lastToggle.set(key, Date.now())
    try {
      await bot.activateBlock(block)
      if (action === 'open') opened.set(key, pos)
      else opened.delete(key)
      log.debug(`${action === 'open' ? 'Opened' : 'Closed'} ${block.name} at ${key}`)
    } catch (error) {
      log.debug(`Could not ${action} ${block.name} at ${key}`, error)
    } finally {
      busy = false
    }
  }

  bot.on('physicsTick', () => {
    if (!bot.entity) return
    const feet = bot.entity.position

    if (bot.pathfinder.isMoving()) {
      for (const node of path.slice(0, lookAhead)) {
        // Path nodes are feet positions, which is where the lower half of a door (or a gate) sits.
        const pos = new Vec3(Math.floor(node.x), Math.floor(node.y), Math.floor(node.z))
        if (feet.distanceTo(pos.offset(0.5, 0, 0.5)) > reach) continue
        const block = bot.blockAt(pos)
        if (block && isHandOpenable(block.name) && !isOpen(block)) {
          void toggle(pos, 'open')
          return
        }
      }
    }

    // Close doors we opened once we are through and not about to walk back through them.
    for (const [key, pos] of opened) {
      const upcoming = path.slice(0, lookAhead).some(n => Math.floor(n.x) === pos.x && Math.floor(n.y) === pos.y && Math.floor(n.z) === pos.z)
      const inside = feet.floored().equals(pos) || feet.distanceTo(pos.offset(0.5, 0, 0.5)) < 1.6
      if (upcoming || inside) continue
      if (feet.distanceTo(pos.offset(0.5, 0, 0.5)) > 8) {
        opened.delete(key) // too far to bother; leave it
        continue
      }
      void toggle(pos, 'close')
      return
    }
  })
}
