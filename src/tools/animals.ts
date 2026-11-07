import { Bot } from 'mineflayer'
import { Entity } from 'prismarine-entity'
import { goals } from 'mineflayer-pathfinder'
import { countItem, describeInventoryChange, findItem, snapshotInventory } from '../bot/inventory.js'
import { navigate } from '../bot/navigation.js'
import { formatPos } from '../bot/world.js'
import { TaskCancelledError, errorMessage, sleep, throwIfAborted, withTimeout } from '../util/async.js'
import { breedingFood, needsTaming } from '../knowledge/breeding.js'
import { ToolInputError } from './args.js'
import { defineTool } from './types.js'

const category = 'Farming'

/** Vanilla 26.2 AgeableMob.DATA_BABY_ID (entity metadata index); absent means adult. */
const babyMetadataIndex = 16
/** Adults can't breed again for 5 minutes after breeding. */
const breedingCooldownMs = 5 * 60_000
/** Animals look for a partner in love mode within about 8 blocks. */
const partnerRange = 8

/** When each entity was last fed by the bot; survives across tool calls. */
const fedAt = new Map<number, number>()

function isBaby(entity: Entity): boolean {
  return (entity.metadata as unknown as Record<number, unknown>)[babyMetadataIndex] === true
}

function speciesOf(raw: string | undefined): string[] {
  if (!raw || ['all', 'animals', 'any', 'everything'].includes(raw.toLowerCase())) return Object.keys(breedingFood)
  const name = raw.trim().toLowerCase().replace(/\s+/g, '_')
  const aliases: Record<string, string> = { cows: 'cow', cattle: 'cow', pigs: 'pig', sheeps: 'sheep', chickens: 'chicken', rabbits: 'rabbit', horses: 'horse', goats: 'goat', wolves: 'wolf', dogs: 'wolf', cats: 'cat', foxes: 'fox', pandas: 'panda', bees: 'bee', llamas: 'llama', turtles: 'turtle', frogs: 'frog' }
  const species = breedingFood[name] ? name : aliases[name] ?? (breedingFood[name.replace(/s$/, '')] ? name.replace(/s$/, '') : undefined)
  if (!species) throw new ToolInputError(`Don't know how to breed "${raw}". Known: ${Object.keys(breedingFood).join(', ')}`)
  return [species]
}

function heldFood(bot: Bot, species: string): string | undefined {
  return breedingFood[species].find(food => countItem(bot, food) > 0)
}

function canBreed(bot: Bot, entity: Entity, species: string, skip: Set<number>): boolean {
  return entity.name === species && entity.isValid && !isBaby(entity) && !skip.has(entity.id) &&
    Date.now() - (fedAt.get(entity.id) ?? 0) > breedingCooldownMs
}

/** Walk up to an animal and feed it. True when the server accepted the food. */
async function feed(bot: Bot, entity: Entity, food: string, signal: AbortSignal): Promise<boolean> {
  const item = findItem(bot, food)
  if (!item) return false
  await withTimeout(navigate(bot, new goals.GoalFollow(entity, 1.5), { signal }), 20_000, `Reaching the ${entity.name}`)
  throwIfAborted(signal)
  if (!entity.isValid) return false
  await bot.equip(item, 'hand')
  const before = countItem(bot, food)
  await bot.lookAt(entity.position.offset(0, entity.height * 0.6, 0), true)
  await bot.activateEntity(entity)
  await sleep(400, signal)
  // Food is used up only when the animal enters love mode (creative mode never uses it up).
  return countItem(bot, food) < before || bot.game.gameMode === 'creative'
}

export const animalTools = [
  defineTool({
    name: 'breed_animals',
    category,
    description:
      'Run around feeding pairs of adult animals their breeding food so they make babies. Picks the right food per species ' +
      '(wheat: cows/sheep/goats, carrots/potatoes/beetroot: pigs, seeds: chickens, ...), skips babies and animals fed in the ' +
      'last 5 minutes, and pairs animals that are close together. Use animal "all" to breed every species you have food for.',
    params: {
      animal: { type: 'string', description: 'Species to breed (e.g. "cow", "pig") or "all" (default all)' },
      pairs: { type: 'integer', description: 'Max pairs to breed per species (default 4, max 16)' },
      radius: { type: 'number', description: 'How far to look for animals (default 24)' }
    },
    async handler(args, { bot, signal, log }) {
      const requested = args.optionalString('animal')
      const pairsWanted = args.int('pairs', 4, { min: 1, max: 16 })
      const radius = args.optionalNumber('radius', { min: 4, max: 64 }) ?? 24
      const center = bot.entity.position.clone()
      const before = snapshotInventory(bot)
      const bred = new Map<string, number>()
      const notes: string[] = []

      const nearby = (species: string, skip: Set<number>) => Object.values(bot.entities)
        .filter(e => e.position.distanceTo(center) <= radius && canBreed(bot, e, species, skip))

      for (const species of speciesOf(requested)) {
        const skip = new Set<number>()
        const present = Object.values(bot.entities).filter(e => e.name === species && e.position.distanceTo(center) <= radius)
        if (present.length === 0) {
          if (requested && requested.toLowerCase() !== 'all') notes.push(`no ${species} within ${radius} blocks`)
          continue
        }
        if (!heldFood(bot, species)) {
          notes.push(`${present.length} ${species} nearby but no ${breedingFood[species].slice(0, 3).join('/')} to feed them`)
          continue
        }

        let pairs = 0
        let attempts = 0
        while (pairs < pairsWanted && attempts < pairsWanted * 4) {
          throwIfAborted(signal)
          attempts++
          const candidates = nearby(species, skip)
          if (candidates.length < 2) break
          if (!heldFood(bot, species)) {
            notes.push(`ran out of food for ${species}`)
            break
          }

          // Feed the closest animal first, then its nearest eligible neighbour so the pair can find each other.
          candidates.sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))
          const first = candidates[0]
          const second = candidates.slice(1).sort((a, b) => a.position.distanceTo(first.position) - b.position.distanceTo(first.position))[0]

          let fedBoth = true
          for (const animal of [first, second]) {
            const food = heldFood(bot, species)
            if (!food) { fedBoth = false; break }
            try {
              if (await feed(bot, animal, food, signal)) {
                fedAt.set(animal.id, Date.now())
              } else {
                // Not accepted: already in love mode, on cooldown, or (for tameable species) not tamed.
                skip.add(animal.id)
                fedBoth = false
              }
            } catch (error) {
              if (error instanceof TaskCancelledError) throw error
              log.debug(`breed: skipping ${species} ${animal.id}: ${errorMessage(error)}`)
              skip.add(animal.id)
              fedBoth = false
            }
          }

          if (fedBoth) {
            pairs++
            if (first.position.distanceTo(second.position) > partnerRange) {
              notes.push(`a ${species} pair near ${formatPos(first.position)} was ${first.position.distanceTo(second.position).toFixed(0)} blocks apart and may not find each other`)
            }
          }
        }

        if (pairs > 0) bred.set(species, pairs)
        if (pairs === 0) {
          const tame = needsTaming.has(species) ? ' (only tamed ones can breed)' : ''
          notes.push(`not enough ${species} ready to breed${tame}: babies and animals fed in the last 5 minutes are skipped`)
        }
      }

      const total = [...bred.values()].reduce((a, b) => a + b, 0)
      const extra = notes.length > 0 ? ` Notes: ${notes.join('; ')}.` : ''
      if (total === 0) {
        const hint = requested ? '' : ' Tip: get breeding food first (wheat, carrots, seeds) or name an animal.'
        return `Bred nothing.${extra}${hint}`
      }
      const breakdown = [...bred.entries()].map(([s, n]) => `${n} ${s} pair${n > 1 ? 's' : ''}`).join(', ')
      return `Fed ${breakdown}; babies should appear within a few seconds. Fed adults can breed again in 5 minutes.${extra} ` +
        `Inventory change: ${describeInventoryChange(before, snapshotInventory(bot))}`
    }
  })
]
