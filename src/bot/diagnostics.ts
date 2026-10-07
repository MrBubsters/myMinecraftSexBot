import fs from 'fs'
import path from 'path'
import { Bot } from 'mineflayer'
import { Config } from '../config.js'
import { createLogger } from '../util/logger.js'

const log = createLogger('diag')

type Direction = 'out' | 'in'
type PacketRecord = { seq: number; time: number; dir: Direction; state: string; name: string; params: string }

/** Packets that arrive or are sent many times per second; kept in the recorder but not logged live. */
const noisy = new Set([
  // outgoing
  'position', 'position_look', 'look', 'flying', 'keep_alive', 'tick_end', 'client_tick_end', 'chunk_batch_received', 'player_input',
  // incoming
  'map_chunk', 'level_chunk_with_light', 'unload_chunk', 'light_update', 'rel_entity_move', 'entity_move_look', 'entity_look',
  'entity_head_rotation', 'entity_velocity', 'entity_teleport', 'sync_entity_position', 'entity_metadata', 'entity_update_attributes',
  'update_attributes', 'update_time', 'bundle_delimiter', 'chunk_batch_start', 'chunk_batch_finished', 'sound_effect',
  'entity_sound_effect', 'world_particles', 'damage_event', 'animation', 'move_minecart'
])

let activity = 'idle'

/** What the bot is doing right now; included in kick reports. */
export function setActivity(description: string) {
  activity = description
}

/** Compact, JSON-safe rendering of packet params (buffers, bigints and long arrays summarised). */
export function summarize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'bigint') return `${value}n`
  if (Buffer.isBuffer(value)) return `<Buffer ${value.length}b>`
  if (typeof value === 'string') return value.length > 200 ? `${value.slice(0, 200)}…` : value
  if (typeof value !== 'object') return value
  if (depth >= 4) return '…'
  if (Array.isArray(value)) {
    const items = value.slice(0, 10).map(v => summarize(v, depth + 1))
    return value.length > 10 ? [...items, `…+${value.length - 10}`] : items
  }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, summarize(v, depth + 1)]))
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(summarize(value))
  } catch {
    return '<unserializable>'
  }
}

/** Turn an NBT/JSON chat component (as sent in kick packets) into plain text plus the translation key. */
export function describeReason(reason: unknown): string {
  const plain = (node: unknown): unknown => {
    if (node && typeof node === 'object') {
      const n = node as { type?: string; value?: unknown }
      if ('type' in n && 'value' in n) return plain(n.value)
      if (Array.isArray(node)) return node.map(plain)
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, plain(v)]))
    }
    return node
  }
  let parsed: unknown = reason
  if (typeof reason === 'string') {
    try { parsed = JSON.parse(reason) } catch { return reason }
  }
  const component = plain(parsed) as { translate?: string; text?: string; with?: unknown[]; extra?: unknown[] }
  if (typeof component === 'string') return component
  const parts = [component.translate, component.text, component.with && `args=${JSON.stringify(component.with)}`, component.extra && `extra=${JSON.stringify(component.extra)}`]
  return parts.filter(Boolean).join(' ') || JSON.stringify(component)
}

/**
 * Packet flight recorder. Keeps the last N packets in each direction, validates
 * every outgoing packet against the protocol schema before it hits the wire
 * (dropping and logging ones that would fail to serialize, which otherwise
 * wedges the connection), and writes a report to logs/ on kick or error.
 */
export function installDiagnostics(bot: Bot, config: Config['diagnostics']) {
  const client = bot._client as unknown as {
    write: (name: string, params: unknown) => void
    serializer: { createPacketBuffer: (packet: unknown) => Buffer }
    state: string
    on: (event: string, cb: (...args: any[]) => void) => void
  }
  // Separate buffers so a flood of incoming entity updates can't push out what the bot sent.
  const buffers: Record<Direction, PacketRecord[]> = { out: [], in: [] }
  let sequence = 0
  const record = (dir: Direction, name: string, params: unknown) => {
    const buffer = buffers[dir]
    buffer.push({ seq: sequence++, time: Date.now(), dir, state: client.state, name, params: stringify(params) })
    if (buffer.length > config.bufferSize) buffer.shift()
  }
  const allRecords = () => [...buffers.out, ...buffers.in].sort((a, b) => a.seq - b.seq)

  const originalWrite = client.write.bind(client)
  client.write = (name: string, params: unknown) => {
    try {
      client.serializer.createPacketBuffer({ name, params })
    } catch (error) {
      record('out', `${name} [DROPPED: does not serialize]`, params)
      const caller = new Error('caller').stack?.split('\n').slice(2, 9).join('\n')
      log.error(`Dropped outgoing ${client.state}.${name}: it does not match the ${bot.version} protocol schema.\n` +
        `  params: ${stringify(params)}\n  error: ${(error as Error).message.split('\n')[0]}\n  sent from:\n${caller}`)
      writeReport(`serialize-${name}`, `Outgoing ${name} failed to serialize: ${(error as Error).message}`)
      return
    }
    record('out', name, params)
    if (config.packets === 'all' && !noisy.has(name)) log.info(`→ ${name} ${stringify(params)}`)
    originalWrite(name, params)
  }

  client.on('packet', (data: unknown, meta: { name: string; state: string }) => {
    if (meta.state !== 'play' && meta.state !== 'configuration') return
    record('in', meta.name, data)
    if (config.packets === 'all' && !noisy.has(meta.name)) log.info(`← ${meta.name} ${stringify(data)}`)
  })

  function formatRecords(): string {
    // Collapse runs of the same noisy packet so the interesting ones stand out.
    const lines: string[] = []
    let run: { rec: PacketRecord; count: number } | null = null
    const flush = () => {
      if (!run) return
      const { rec, count } = run
      const time = new Date(rec.time).toISOString().slice(11, 23)
      lines.push(count > 1 ? `${time} ${rec.dir === 'out' ? '→' : '←'} ${rec.name} ×${count}` : `${time} ${rec.dir === 'out' ? '→' : '←'} ${rec.state}.${rec.name} ${rec.params}`)
      run = null
    }
    for (const rec of allRecords()) {
      if (run && noisy.has(rec.name) && run.rec.name === rec.name && run.rec.dir === rec.dir) {
        run.count++
        continue
      }
      flush()
      run = { rec, count: 1 }
    }
    flush()
    return lines.join('\n')
  }

  function writeReport(kind: string, summary: string) {
    if (config.packets === 'off') return
    try {
      const dir = path.resolve(process.cwd(), 'logs')
      fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, `${kind}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`)
      const pos = bot.entity?.position
      const body = [
        summary,
        `version: ${bot.version}  activity: ${activity}`,
        pos ? `position: ${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}  held: ${bot.heldItem?.name ?? 'empty'}  health: ${bot.health}  food: ${bot.food}` : '',
        '',
        `Last ${buffers.out.length} sent and ${buffers.in.length} received packets (→ sent, ← received):`,
        formatRecords()
      ].join('\n')
      fs.writeFileSync(file, body)
      log.warn(`Diagnostic report written to ${path.relative(process.cwd(), file)}`)
    } catch (error) {
      log.error('Could not write diagnostic report', error)
    }
  }

  bot.on('kicked', reason => {
    const text = describeReason(reason)
    log.error(`Kicked: ${text} (while: ${activity})`)
    const recent = buffers.out.filter(r => !noisy.has(r.name)).slice(-8)
    for (const r of recent) log.error(`  recent → ${r.name} ${r.params}`)
    writeReport('kick', `Kicked: ${text}`)
  })

  bot.on('error', error => {
    log.error(`Connection error while: ${activity}`, error)
    writeReport('error', `Error: ${error.message}`)
  })

  log.info(`Packet diagnostics: ${config.packets} (buffer ${config.bufferSize})`)
}
