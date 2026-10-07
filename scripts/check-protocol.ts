/**
 * Reports whether each protocol workaround in src/bot/ is still needed with the
 * currently installed mineflayer / minecraft-protocol / minecraft-data.
 * See docs/PROTOCOL_WORKAROUNDS.md.
 *
 *   npm run check:protocol                          # probe the installed packages
 *   npm run check:protocol -- path/to/packets.json  # also compare packet IDs with a vanilla report
 */
import fs from 'fs'
import minecraftData from 'minecraft-data'
import { serverboundTableFix } from '../src/bot/packetTablePatch.js'

const version = process.env.MC_VERSION ?? '26.2'
const reportPath = process.argv[2]
const results: Array<{ name: string; needed: boolean; detail: string }> = []

// 1. Serverbound packet ID table (src/bot/packetTablePatch.ts)
results.push({
  name: 'Serverbound packet ID table',
  needed: serverboundTableFix(version) !== undefined,
  detail: 'minecraft-data play.toServer mappings missing teleport_to_entity / swing misplaced'
})

// 2. use_entity / attack packets (src/bot/protocolFixes.ts: fixEntityPackets)
{
  const types = minecraftData(version).protocol.play.toServer.types as Record<string, any>
  const useEntityFields: string[] = (types.packet_use_entity?.[1] ?? []).map((f: { name: string }) => f.name)
  const source = fs.readFileSync(require.resolve('mineflayer/lib/plugins/entities.js'), 'utf8')
  const sendsOldShape = /write\('use_entity',\s*\{[^}]*mouse/.test(source)
  results.push({
    name: 'use_entity / attack packets',
    needed: useEntityFields.includes('location') && sendsOldShape,
    detail: `protocol use_entity fields: ${useEntityFields.join(', ')}; mineflayer still sends {mouse}: ${sendsOldShape}`
  })
}

// 3. Signed-chat last-seen checksum order (src/bot/protocolFixes.ts: fixChatChecksum)
{
  const { computeChatChecksum } = require('minecraft-protocol/src/datatypes/checksums')
  const signature = (seed: number) => {
    const b = Buffer.alloc(256)
    let x = BigInt(seed) * 2654435761n
    for (let i = 0; i < 256; i++) { x = (x * 1103515245n + 12345n) & 0x7fffffffn; b[i] = Number((x >> 16n) & 0xffn) }
    return b
  }
  // Mirror of the fork's 20-slot ring after 25 messages (it has wrapped).
  const ring: any = Object.assign([], { capacity: 20, offset: 0, pending: 0 })
  for (let n = 1; n <= 25; n++) { ring[ring.offset] = { pending: true, signature: signature(n) }; ring.offset = (ring.offset + 1) % 20 }
  // Vanilla: Arrays.hashCode of each signature, combined oldest-first from the ring's tail.
  let expected = 1
  for (let i = 0; i < 20; i++) {
    let h = 1
    for (const byte of ring[(ring.offset + i) % 20].signature) h = (Math.imul(31, h) + ((byte << 24) >> 24)) | 0
    expected = (Math.imul(31, expected) + h) | 0
  }
  const want = (expected & 0xff) || 1
  const got = computeChatChecksum(ring)
  const chatSource = fs.readFileSync(require.resolve('minecraft-protocol/src/client/chat.js'), 'utf8')
  const resetsOnHide = /_lastSeenMessages\s*=\s*client\._lastSeenMessages\.map\(/.test(chatSource)
  results.push({
    name: 'Signed-chat checksum order',
    needed: got !== want || resetsOnHide,
    detail: `checksum after ring wrap: fork ${got}, vanilla ${want}; hide_message resets ring counters: ${resetsOnHide}`
  })
}

for (const r of results) console.log(`${r.needed ? 'NEEDED        ' : 'FIXED UPSTREAM'}  ${r.name}\n                ${r.detail}`)

// Optional: compare the IDs of every packet the bot sends with a vanilla packets.json report.
if (reportPath) {
  const vanilla = JSON.parse(fs.readFileSync(reportPath, 'utf8')).play.serverbound as Record<string, { protocol_id: number }>
  const mappings: Record<string, string> = (minecraftData(version).protocol.play.toServer.types as any).packet[1][0].type[1].mappings
  const idOf = Object.fromEntries(Object.entries(mappings).map(([hex, name]) => [name, parseInt(hex, 16)]))
  // minecraft-data name -> vanilla registry name, for the packets this bot sends.
  const aliases: Record<string, string> = {
    teleport_confirm: 'accept_teleportation', attack: 'attack', use_entity: 'interact', arm_animation: 'swing',
    block_place: 'use_item_on', use_item: 'use_item', block_dig: 'player_action', window_click: 'container_click',
    close_window: 'container_close', held_item_slot: 'set_carried_item', chat_message: 'chat', chat_command: 'chat_command',
    message_acknowledgement: 'chat_ack', position: 'move_player_pos', position_look: 'move_player_pos_rot',
    look: 'move_player_rot', flying: 'move_player_status_only', keep_alive: 'keep_alive', entity_action: 'player_command',
    client_command: 'client_command', craft_recipe_request: 'place_recipe', settings: 'client_information',
    set_creative_slot: 'set_creative_mode_slot', player_input: 'player_input', tick_end: 'client_tick_end',
    chunk_batch_received: 'chunk_batch_received', vehicle_move: 'move_vehicle', update_sign: 'sign_update'
  }
  const fix = serverboundTableFix(version) as any
  const fixed: Record<string, string> = fix?.[version]?.play.toServer.types.packet[1][0].type[1].mappings ?? {}
  for (const [hex, name] of Object.entries(fixed)) idOf[name] = parseInt(hex, 16)

  console.log(`\nPacket IDs vs ${reportPath} (with the table fix applied${fix ? '' : ' — not needed'}):`)
  let bad = 0
  for (const [name, vanillaName] of Object.entries(aliases)) {
    const want = vanilla[`minecraft:${vanillaName}`]?.protocol_id
    if (want === undefined) { console.log(`  ?    ${name} (no minecraft:${vanillaName} in report)`); continue }
    if (idOf[name] !== want) { bad++; console.log(`  BAD  ${name.padEnd(24)} sent as ${idOf[name]}, vanilla ${vanillaName} = ${want}`) }
  }
  console.log(bad === 0 ? `  All ${Object.keys(aliases).length} packets match.` : `  ${bad} mismatched packet(s).`)
  console.log(`  Vanilla has ${Object.keys(vanilla).length} serverbound play packets; minecraft-data has ${Object.keys(mappings).length}.`)
}
