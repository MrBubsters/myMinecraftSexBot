import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import AdmZip from 'adm-zip'
import { createLogger } from '../util/logger.js'

const log = createLogger('knowledge')

const manifestUrl = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'

export type Json = any

/** The parts of the vanilla server's built-in data pack the knowledge base is built from. */
export type VanillaData = {
  recipes: Map<string, Json>
  itemTags: Map<string, string[]>
  entityTags: Map<string, string[]>
  blockLoot: Map<string, Json>
  entityLoot: Map<string, Json>
  chestLoot: Map<string, Json>
  /** profession -> trades, each with the level it unlocks at. */
  trades: Map<string, Array<{ level: number; trade: Json }>>
}

async function fetchJson(url: string): Promise<Json> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`)
  return response.json()
}

/** Download the official server jar for `version` (verified against Mojang's SHA1) unless it is cached. */
export async function ensureServerJar(version: string, cacheDir: string): Promise<string> {
  const jarPath = path.join(cacheDir, `server-${version}.jar`)
  if (fs.existsSync(jarPath)) return jarPath

  const manifest = await fetchJson(manifestUrl)
  const entry = manifest.versions.find((v: { id: string }) => v.id === version)
  if (!entry) throw new Error(`Minecraft version ${version} is not in Mojang's version manifest`)
  const server = (await fetchJson(entry.url)).downloads?.server
  if (!server) throw new Error(`Mojang publishes no server jar for ${version}`)

  log.info(`Downloading the official ${version} server jar (${Math.round(server.size / 1e6)} MB) to read game data…`)
  const response = await fetch(server.url)
  if (!response.ok) throw new Error(`Server jar download failed: ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const sha1 = crypto.createHash('sha1').update(bytes).digest('hex')
  if (sha1 !== server.sha1) throw new Error(`Server jar checksum mismatch (got ${sha1}, expected ${server.sha1})`)

  fs.mkdirSync(cacheDir, { recursive: true })
  fs.writeFileSync(jarPath, bytes)
  return jarPath
}

/** Read recipes, tags, loot tables and villager trades from the server jar. */
export function readVanillaData(jarPath: string): VanillaData {
  // The download is a bundler jar; the real server (with the data pack) is nested inside it.
  const outer = new AdmZip(jarPath)
  const innerEntry = outer.getEntries().find(e => /^META-INF\/versions\/[^/]+\/server-[^/]+\.jar$/.test(e.entryName))
  const zip = innerEntry ? new AdmZip(innerEntry.getData()) : outer

  const data: VanillaData = {
    recipes: new Map(), itemTags: new Map(), entityTags: new Map(),
    blockLoot: new Map(), entityLoot: new Map(), chestLoot: new Map(), trades: new Map()
  }
  const prefix = 'data/minecraft/'

  for (const entry of zip.getEntries()) {
    const name = entry.entryName
    if (entry.isDirectory || !name.startsWith(prefix) || !name.endsWith('.json')) continue
    const rel = name.slice(prefix.length, -'.json'.length)
    const [folder, ...rest] = rel.split('/')
    const id = rest.join('/')
    const read = () => JSON.parse(entry.getData().toString('utf8'))

    if (folder === 'recipe') data.recipes.set(id, read())
    else if (rel.startsWith('tags/item/')) data.itemTags.set(rel.slice('tags/item/'.length), read().values ?? [])
    else if (rel.startsWith('tags/entity_type/')) data.entityTags.set(rel.slice('tags/entity_type/'.length), read().values ?? [])
    else if (rel.startsWith('loot_table/blocks/')) data.blockLoot.set(rel.slice('loot_table/blocks/'.length), read())
    else if (rel.startsWith('loot_table/entities/')) data.entityLoot.set(rel.slice('loot_table/entities/'.length), read())
    else if (rel.startsWith('loot_table/chests/')) data.chestLoot.set(rel.slice('loot_table/chests/'.length), read())
    else if (folder === 'villager_trade') {
      const [profession] = rest
      const level = Number(rest[1]) || 0
      const list = data.trades.get(profession) ?? []
      list.push({ level, trade: read() })
      data.trades.set(profession, list)
    }
  }

  log.info(`Read ${data.recipes.size} recipes, ${data.itemTags.size} item tags, ${data.blockLoot.size + data.entityLoot.size} loot tables, ` +
    `${[...data.trades.values()].reduce((n, t) => n + t.length, 0)} villager trades`)
  return data
}
