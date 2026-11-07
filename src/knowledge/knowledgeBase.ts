import fs from 'fs'
import path from 'path'
import minecraftData from 'minecraft-data'
import { createLogger } from '../util/logger.js'
import { breedingFood, needsTaming } from './breeding.js'
import { specialSources } from './mechanics.js'
import { Json, VanillaData, ensureServerJar, readVanillaData } from './vanillaData.js'

const log = createLogger('knowledge')

/** Bump when the document format changes so cached knowledge bases are rebuilt. */
const schemaVersion = 2

export type KnowledgeDoc = { title: string; kind: 'item' | 'block' | 'mob' | 'tag' | 'trades'; text: string }

const strip = (id: string) => id.replace(/^#?minecraft:/, '')
const human = (id: string) => (id.startsWith('#') ? `any ${strip(id).replace(/_/g, ' ')}` : strip(id))

function addTo<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key)
  if (list) { if (!list.includes(value)) list.push(value) } else map.set(key, [value])
}

/** Expand "#minecraft:logs"-style references into item names. */
function resolveTag(tags: Map<string, string[]>, name: string, seen = new Set<string>()): string[] {
  if (seen.has(name)) return []
  seen.add(name)
  return (tags.get(name) ?? []).flatMap(v => {
    const value = typeof v === 'string' ? v : (v as { id: string }).id
    return value.startsWith('#') ? resolveTag(tags, strip(value), seen) : [strip(value)]
  })
}

function ingredientText(ing: Json): string {
  if (typeof ing === 'string') return human(ing)
  if (Array.isArray(ing)) return ing.map(ingredientText).join(' or ')
  if (ing?.item) return human(ing.item)
  if (ing?.tag) return human(`#${ing.tag}`)
  if (ing?.id) return human(ing.id)
  return '?'
}

function ingredientIds(ing: Json, tags: Map<string, string[]>): string[] {
  if (typeof ing === 'string') return ing.startsWith('#') ? resolveTag(tags, strip(ing)) : [strip(ing)]
  if (Array.isArray(ing)) return ing.flatMap(i => ingredientIds(i, tags))
  if (ing?.item) return [strip(ing.item)]
  if (ing?.tag) return resolveTag(tags, strip(ing.tag))
  return []
}

function resultOf(recipe: Json): { id: string; count: number } | null {
  const r = recipe.result
  if (!r) return null
  if (typeof r === 'string') return { id: strip(r), count: 1 }
  return { id: strip(r.id ?? r.item ?? ''), count: r.count ?? 1 }
}

/** One-line description of a recipe, e.g. "craft: 3 any planks + 2 stick (crafting table)". */
function describeRecipe(recipe: Json): { text: string; inputs: Json[] } | null {
  const type = strip(recipe.type ?? '')
  const counts = (list: Json[]) => {
    const tally = new Map<string, number>()
    for (const ing of list) { const t = ingredientText(ing); tally.set(t, (tally.get(t) ?? 0) + 1) }
    return [...tally.entries()].map(([t, n]) => `${n} ${t}`).join(' + ')
  }
  if (type === 'crafting_shaped') {
    const pattern: string[] = recipe.pattern ?? []
    const inputs = pattern.join('').split('').filter(c => c !== ' ').map(c => recipe.key?.[c])
    const big = pattern.length > 2 || pattern.some(row => row.length > 2)
    return { text: `craft: ${counts(inputs)}${big ? ' (crafting table)' : ' (2x2, no table needed)'}`, inputs }
  }
  if (type === 'crafting_shapeless') {
    const inputs = recipe.ingredients ?? []
    return { text: `craft: ${counts(inputs)}${inputs.length > 4 ? ' (crafting table)' : ''}`, inputs }
  }
  if (type === 'crafting_transmute') return { text: `craft: ${ingredientText(recipe.input)} + ${ingredientText(recipe.material)}`, inputs: [recipe.input, recipe.material] }
  const station: Record<string, string> = { smelting: 'smelt in a furnace', blasting: 'blast furnace', smoking: 'smoker', campfire_cooking: 'cook on a campfire', stonecutting: 'stonecutter' }
  if (station[type]) return { text: `${station[type]}: ${ingredientText(recipe.ingredient)}`, inputs: [recipe.ingredient] }
  if (type === 'smithing_transform') {
    return { text: `smithing table: ${ingredientText(recipe.base)} + ${ingredientText(recipe.addition)} + ${ingredientText(recipe.template)}`, inputs: [recipe.base, recipe.addition, recipe.template] }
  }
  return null // special recipes (dyeing armour, map cloning, ...) have no fixed result
}

/** Items a loot table can produce, and whether some drops need a particular tool (silk touch, shears). */
function lootItems(table: Json): { items: string[]; toolDependent: boolean } {
  const items = new Set<string>()
  let toolDependent = false
  const walk = (node: Json) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node.condition === 'minecraft:match_tool') toolDependent = true
    if (node.type === 'minecraft:item' && typeof node.name === 'string') items.add(strip(node.name))
    for (const value of Object.values(node)) walk(value)
  }
  walk(table)
  return { items: [...items], toolDependent }
}

/** Everyday methods first: crafting and the regular furnace before blast furnaces, smokers and campfires. */
const sourceOrder = ['craft', 'smelt in a furnace', 'stonecutter', 'smithing table', 'blast furnace', 'smoker', 'cook on a campfire']
function rankSources(sources: string[]): string[] {
  const rank = (s: string) => { const i = sourceOrder.findIndex(p => s.startsWith(p)); return i === -1 ? sourceOrder.length : i }
  return [...sources].sort((a, b) => rank(a) - rank(b))
}

function list(values: string[], max = 10): string {
  const unique = [...new Set(values)]
  return unique.length > max ? `${unique.slice(0, max).join(', ')} (+${unique.length - max} more)` : unique.join(', ')
}

function buildDocs(version: string, data: VanillaData): KnowledgeDoc[] {
  const mc = minecraftData(version)
  const makes = new Map<string, string[]>() // item -> ways to obtain via recipes
  const usedIn = new Map<string, string[]>() // item -> recipe results using it
  for (const recipe of data.recipes.values()) {
    const result = resultOf(recipe)
    const described = describeRecipe(recipe)
    if (!result || !described) continue
    addTo(makes, result.id, `${described.text}${result.count > 1 ? ` -> ${result.count}` : ''}`)
    for (const input of described.inputs) for (const id of ingredientIds(input, data.itemTags)) addTo(usedIn, id, result.id)
  }

  const droppedByBlock = new Map<string, string[]>()
  const blockDrops = new Map<string, { items: string[]; toolDependent: boolean }>()
  for (const [block, table] of data.blockLoot) {
    const loot = lootItems(table)
    blockDrops.set(block, loot)
    for (const item of loot.items) if (item !== block) addTo(droppedByBlock, item, block)
  }
  const droppedByMob = new Map<string, string[]>()
  const mobDrops = new Map<string, string[]>()
  for (const [mob, table] of data.entityLoot) {
    const name = mob.split('/')[0] // sheep/white etc.
    const loot = lootItems(table)
    for (const item of loot.items) { addTo(droppedByMob, item, name); addTo(mobDrops, name, item) }
  }
  const inChests = new Map<string, string[]>()
  for (const [chest, table] of data.chestLoot) for (const item of lootItems(table).items) addTo(inChests, item, chest.replace(/\//g, ' '))

  const itemTagsOf = new Map<string, string[]>()
  for (const tag of data.itemTags.keys()) for (const item of resolveTag(data.itemTags, tag)) addTo(itemTagsOf, item, tag)

  const tradesFor = new Map<string, string[]>()
  const tradeText = (t: Json) => {
    const stack = (s: Json) => (s ? `${s.count ?? 1} ${strip(s.id ?? '?')}` : '')
    return `${[stack(t.wants), stack(t.additional_wants)].filter(Boolean).join(' + ')} -> ${stack(t.gives)}`
  }
  for (const [profession, trades] of data.trades) {
    for (const { trade } of trades) {
      if (trade.gives?.id) addTo(tradesFor, strip(trade.gives.id), `${profession.replace(/_/g, ' ')} villager sells it (${tradeText(trade)})`)
      if (trade.wants?.id && strip(trade.wants.id) !== 'emerald') addTo(tradesFor, strip(trade.wants.id), `${profession.replace(/_/g, ' ')} villager buys it (${tradeText(trade)})`)
    }
  }

  const docs: KnowledgeDoc[] = []

  // Items (block items include what mining the block gives and which tools harvest it).
  for (const item of mc.itemsArray) {
    const name = item.name
    const lines: string[] = [`${name} (item${mc.blocksByName[name] ? ', placeable block' : ''}), stacks to ${item.stackSize}`]
    const food = mc.foodsByName[name]
    if (food) lines.push(`Food: restores ${food.foodPoints} hunger, ${food.saturation.toFixed(1)} saturation`)
    if (specialSources[name]) lines.push(`Obtain: ${specialSources[name]}`)
    if (makes.has(name)) lines.push(`Made by: ${rankSources(makes.get(name)!).slice(0, 5).join(' | ')}`)
    if (droppedByBlock.has(name)) lines.push(`Dropped when mining: ${list(droppedByBlock.get(name)!, 8)}`)
    if (droppedByMob.has(name)) lines.push(`Dropped by mobs: ${list(droppedByMob.get(name)!, 8)}`)
    if (tradesFor.has(name)) lines.push(`Villagers: ${tradesFor.get(name)!.slice(0, 3).join('; ')}`)
    if (inChests.has(name)) lines.push(`Found in chests: ${list(inChests.get(name)!, 6)}`)
    const block = mc.blocksByName[name]
    if (block) {
      const tools = block.harvestTools ? Object.keys(block.harvestTools).map(id => mc.items[Number(id)]?.name).filter(Boolean) : []
      const drops = blockDrops.get(name)
      lines.push(`As a block: hardness ${block.hardness ?? 'n/a'}; ${tools.length ? `needs ${list(tools, 4)} to drop anything` : 'any tool or hand works'}` +
        (drops && drops.items.length ? `; mining drops ${list(drops.items, 5)}${drops.toolDependent ? ' (some drops depend on silk touch/shears/tool)' : ''}` : ''))
    }
    const eatenBy = (itemTagsOf.get(name) ?? []).filter(t => t.endsWith('_food')).map(t => t.replace(/_food$/, ''))
    const breeds = Object.entries(breedingFood).filter(([, foods]) => foods.includes(name)).map(([mob]) => mob)
    if (breeds.length) lines.push(`Breeds: ${breeds.join(', ')} (use breed_animals)`)
    if (eatenBy.length) lines.push(`Food/tempt item for: ${list(eatenBy, 8)}`)
    if (usedIn.has(name)) lines.push(`Used to make: ${list(usedIn.get(name)!, 12)}`)
    const tags = (itemTagsOf.get(name) ?? []).filter(t => !t.endsWith('_food'))
    if (tags.length) lines.push(`Tags: ${list(tags, 8)}`)
    if (lines.length === 1 && !block) lines.push('Not craftable, not dropped by blocks or mobs in loot tables (creative-only, rare, or obtained another way).')
    docs.push({ title: name, kind: 'item', text: lines.join('\n') })
  }

  // Blocks with no item of the same name (crops, fire, water, ...).
  for (const block of mc.blocksArray) {
    if (mc.itemsByName[block.name]) continue
    const drops = blockDrops.get(block.name)
    const tools = block.harvestTools ? Object.keys(block.harvestTools).map(id => mc.items[Number(id)]?.name).filter(Boolean) : []
    const lines = [`${block.name} (block, no item form)`]
    if (drops?.items.length) lines.push(`Breaking drops: ${list(drops.items, 6)}${drops.toolDependent ? ' (tool-dependent)' : ''}`)
    if (tools.length) lines.push(`Needs ${list(tools, 4)} to drop anything`)
    const age = block.states?.find((s: { name: string }) => s.name === 'age')
    if (age) lines.push(`Grows through ${age.num_values} stages (age 0-${age.num_values - 1}); ripe at the last stage — use harvest_crops`)
    docs.push({ title: block.name, kind: 'block', text: lines.join('\n') })
  }

  // Mobs.
  for (const entity of mc.entitiesArray) {
    if (entity.type !== 'mob' && !data.entityLoot.has(entity.name) && !breedingFood[entity.name]) continue
    const lines = [`${entity.name} (mob${entity.category ? `, ${entity.category.toLowerCase()}` : ''}), ${entity.width}x${entity.height} blocks`]
    if (breedingFood[entity.name]) {
      const tame = needsTaming.has(entity.name) ? ' (must be tamed first)' : ''
      lines.push(`Breeds with: ${list(breedingFood[entity.name], 14)}${tame}. Use breed_animals.`)
    }
    const eats = data.itemTags.has(`${entity.name}_food`) ? resolveTag(data.itemTags, `${entity.name}_food`) : []
    if (eats.length) lines.push(`Food/tempt items (#${entity.name}_food): ${list(eats, 14)}`)
    const drops = mobDrops.get(entity.name)
    lines.push(`Drops: ${drops?.length ? list(drops, 10) : 'nothing (or only XP)'}`)
    const tags = [...data.entityTags.keys()].filter(t => resolveTag(data.entityTags, t).includes(entity.name))
    if (tags.length) lines.push(`Entity tags: ${list(tags, 8)}`)
    docs.push({ title: entity.name, kind: 'mob', text: lines.join('\n') })
  }

  // Item tags (what counts as "any planks", "logs", fuel-ish groups, ...).
  for (const tag of data.itemTags.keys()) {
    docs.push({ title: `#${tag}`, kind: 'tag', text: `Item tag #${tag}: ${list(resolveTag(data.itemTags, tag), 30)}` })
  }

  // Villager professions.
  for (const [profession, trades] of data.trades) {
    const byLevel = [...trades].sort((a, b) => a.level - b.level)
      .map(({ level, trade }) => `${level ? `L${level} ` : ''}${tradeText(trade)}`)
    docs.push({ title: `${profession} trades`, kind: 'trades', text: `${profession.replace(/_/g, ' ')} villager trades: ${list(byLevel, 25)}` })
  }

  return docs
}

const tokenize = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1).map(t => t.replace(/ies$/, 'y').replace(/(ch|sh|x|z|ss)es$/, '$1').replace(/(?<!s)s$/, ''))

/** Words that say what to do rather than what it is about; ignored when matching requests to entries. */
const stopwords = new Set(['the', 'an', 'to', 'of', 'me', 'my', 'some', 'get', 'make', 'how', 'do', 'you', 'can', 'please', 'and', 'for',
  'with', 'in', 'on', 'is', 'it', 'thi', 'that', 'what', 'go', 'all', 'few', 'more', 'your', 'our', 'here', 'there', 'now', 'up', 'at', 'from', 'any'])

/** Searchable game knowledge built from the vanilla data pack for one version. */
export class KnowledgeBase {
  private readonly index = new Map<string, Map<number, number>>() // token -> doc -> weight
  private readonly byTitle = new Map<string, number>()

  constructor(readonly version: string, readonly docs: KnowledgeDoc[]) {
    docs.forEach((doc, i) => {
      this.byTitle.set(doc.title, i)
      const add = (token: string, weight: number) => {
        const postings = this.index.get(token) ?? new Map<number, number>()
        postings.set(i, (postings.get(i) ?? 0) + weight)
        this.index.set(token, postings)
      }
      for (const t of tokenize(doc.title)) add(t, 6)
      for (const t of tokenize(doc.text)) add(t, 1)
    })
  }

  search(query: string, limit = 3): KnowledgeDoc[] {
    const normalized = query.trim().toLowerCase().replace(/^minecraft:/, '').replace(/\s+/g, '_')
    const exact = this.byTitle.get(normalized) ?? this.byTitle.get(normalized.replace(/s$/, ''))
    const scores = new Map<number, number>()
    const tokens = [...new Set(tokenize(query))]
    for (const token of tokens) {
      const postings = this.index.get(token)
      if (!postings) continue
      const idf = Math.log(1 + this.docs.length / postings.size)
      for (const [doc, weight] of postings) scores.set(doc, (scores.get(doc) ?? 0) + idf * Math.min(weight, 8))
    }
    // Reward docs that match every query word.
    for (const [doc, score] of scores) {
      const title = tokenize(this.docs[doc].title)
      const covered = tokens.filter(t => title.includes(t) || this.index.get(t)?.has(doc)).length
      scores.set(doc, score * (covered / tokens.length) ** 2)
    }
    if (exact !== undefined) scores.set(exact, Infinity)
    return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([doc]) => this.docs[doc])
  }

  /**
   * Entries whose name appears in `text` (a player's request), best match first.
   * Unlike search(), this never returns loosely related entries, so it is safe to inject automatically.
   */
  relevant(text: string, limit = 3): KnowledgeDoc[] {
    const words = new Set(tokenize(text).filter(t => !stopwords.has(t)))
    if (words.size === 0) return []
    return this.search([...words].join(' '), limit * 2)
      .filter(doc => doc.kind !== 'tag' && tokenize(doc.title).every(t => words.has(t)))
      .slice(0, limit)
  }

  get(title: string): KnowledgeDoc | undefined {
    const i = this.byTitle.get(title)
    return i === undefined ? undefined : this.docs[i]
  }
}

/**
 * Load the knowledge base for `version`, building it from the official server
 * jar on first run (or when the format changes) and caching it in `cacheDir`.
 */
export async function loadKnowledgeBase(version: string, cacheDir: string, options: { rebuild?: boolean } = {}): Promise<KnowledgeBase> {
  const cachePath = path.join(cacheDir, `knowledge-${version}.json`)
  if (!options.rebuild && fs.existsSync(cachePath)) {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
    if (cached.schemaVersion === schemaVersion && cached.version === version) {
      log.info(`Loaded ${cached.docs.length} knowledge entries for ${version}`)
      return new KnowledgeBase(version, cached.docs)
    }
  }

  const started = Date.now()
  const jar = await ensureServerJar(version, cacheDir)
  const docs = buildDocs(version, readVanillaData(jar))
  fs.mkdirSync(cacheDir, { recursive: true })
  fs.writeFileSync(cachePath, JSON.stringify({ schemaVersion, version, builtAt: new Date().toISOString(), docs }))
  log.info(`Built ${docs.length} knowledge entries for ${version} in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  return new KnowledgeBase(version, docs)
}
