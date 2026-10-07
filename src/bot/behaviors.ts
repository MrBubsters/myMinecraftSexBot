import { Bot } from 'mineflayer'
import { createLogger } from '../util/logger.js'
import { bestFood } from './inventory.js'

const log = createLogger('behaviors')
const hungerThreshold = 14

/**
 * Eat automatically when hungry, but only while idle so it never swaps the
 * held item in the middle of a task.
 */
export function enableAutoEat(bot: Bot, isBusy: () => boolean) {
  let eating = false
  bot.on('health', async () => {
    if (eating || isBusy() || bot.food >= hungerThreshold) return
    const food = bestFood(bot)
    if (!food) return
    eating = true
    try {
      await bot.equip(food, 'hand')
      await bot.consume()
      log.info(`Auto-ate ${food.name} (food now ${bot.food})`)
    } catch (error) {
      log.debug('Auto-eat failed', error)
    } finally {
      eating = false
    }
  })
}
