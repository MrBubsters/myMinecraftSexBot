import minecraftData from 'minecraft-data'
import { createLogger } from '../util/logger.js'

const log = createLogger('protocol')

// Documented in docs/PROTOCOL_WORKAROUNDS.md (workaround 1); `npm run check:protocol` reports whether it is still needed.

/**
 * Serverbound play packet IDs 0x3e-0x44 for 26.2, as reported by the vanilla
 * 26.2 server (`java -DbundlerMainClass=net.minecraft.data.Main -jar server.jar --reports`),
 * using minecraft-data's packet names.
 *
 * The forked minecraft-data omits `teleport_to_entity` and misplaces `swing`
 * (arm_animation), shifting every ID from 0x3e upward. The server then
 * misreads them: block_place arrives as test_instance_block_action, use_item as
 * use_item_on and arm swings as spectator_action, and the bot is kicked with
 * "Failed to decode packet" on almost any interaction.
 */
const fixedTail: Record<string, string> = {
  '0x3e': 'spectator_action',
  '0x3f': 'arm_animation',
  '0x40': 'teleport_to_entity',
  '0x41': 'test_instance_block_action',
  '0x42': 'block_place',
  '0x43': 'use_item',
  '0x44': 'custom_click_action'
}

type PacketType = ['container', [{ name: string; type: [string, any] }, { name: string; type: [string, any] }]]

/**
 * Build a minecraft-protocol `customPackets` override that corrects the 26.2
 * serverbound packet table. Returns undefined when the table doesn't have the
 * known defect (another version, or the fork has been fixed upstream).
 */
export function serverboundTableFix(version: string): Record<string, unknown> | undefined {
  const data = minecraftData(version)
  if (!data) return undefined
  const types = data.protocol.play.toServer.types as Record<string, unknown>
  const packet = types.packet as PacketType
  const mappings: Record<string, string> = packet[1][0].type[1].mappings
  const broken = mappings['0x3e'] === 'arm_animation' && !Object.values(mappings).includes('teleport_to_entity')
  if (!broken) return undefined

  log.info(`Correcting serverbound play packet IDs 0x3e-0x44 for ${version}`)
  // Merged into minecraft-data's protocol with lodash.merge, so the structure mirrors the original.
  return {
    [String(data.version.majorVersion)]: {
      play: {
        toServer: {
          types: {
            packet_teleport_to_entity: ['container', [{ name: 'target', type: 'UUID' }]],
            packet: ['container', [
              { name: 'name', type: ['mapper', { type: 'varint', mappings: fixedTail }] },
              { name: 'params', type: ['switch', { compareTo: 'name', fields: { teleport_to_entity: 'packet_teleport_to_entity' } }] }
            ]]
          }
        }
      }
    }
  }
}
