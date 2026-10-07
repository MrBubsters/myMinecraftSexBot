import { Bot } from 'mineflayer'
import { Movements, goals } from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'
import { TaskCancelledError, errorMessage } from '../util/async.js'

/**
 * Two movement profiles: normal travel never breaks blocks (so the bot does not
 * wreck builds), while resource gathering may dig through terrain.
 */
const profiles = new WeakMap<Bot, { travel: Movements; dig: Movements }>()

export function configureMovements(bot: Bot) {
  const travel = new Movements(bot)
  travel.canDig = false
  travel.allow1by1towers = false
  travel.allowParkour = true
  travel.allowSprinting = true

  const dig = new Movements(bot)
  dig.canDig = true
  dig.allow1by1towers = true
  dig.allowParkour = true
  dig.allowSprinting = true

  profiles.set(bot, { travel, dig })
  bot.pathfinder.setMovements(travel)
}

export type NavigateOptions = {
  allowDig?: boolean
  signal: AbortSignal
}

export async function navigate(bot: Bot, goal: goals.Goal, options: NavigateOptions): Promise<void> {
  const profile = profiles.get(bot)
  if (profile) bot.pathfinder.setMovements(options.allowDig ? profile.dig : profile.travel)

  const onAbort = () => bot.pathfinder.stop()
  options.signal.addEventListener('abort', onAbort, { once: true })

  try {
    await bot.pathfinder.goto(goal)
  } catch (error) {
    if (options.signal.aborted) throw new TaskCancelledError()
    throw new Error(`Could not reach destination: ${errorMessage(error)}`)
  } finally {
    options.signal.removeEventListener('abort', onAbort)
    if (profile) bot.pathfinder.setMovements(profile.travel)
  }
}

export function goToPosition(bot: Bot, pos: Vec3, range: number, options: NavigateOptions) {
  return navigate(bot, new goals.GoalNear(pos.x, pos.y, pos.z, range), options)
}

/** Move within reach of a block so it can be dug or interacted with. */
export function goToBlock(bot: Bot, pos: Vec3, options: NavigateOptions) {
  if (bot.entity.position.distanceTo(pos.offset(0.5, 0.5, 0.5)) <= 4) return Promise.resolve()
  return navigate(bot, new goals.GoalLookAtBlock(pos, bot.world, { reach: 4 }), options)
}

export function stopAllMovement(bot: Bot) {
  if (!bot.entity) return // not spawned (or already disconnected)
  bot.pathfinder.stop()
  bot.pathfinder.setGoal(null)
  bot.clearControlStates()
  bot.stopDigging()
}
