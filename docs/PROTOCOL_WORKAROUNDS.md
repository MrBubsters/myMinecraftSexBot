# Protocol workarounds for the 26.2 forks

The bot runs on community forks of the mineflayer stack, because the official packages didn't support Minecraft 26.2 yet. The forks have protocol bugs that get the bot kicked, so this repo works around them at runtime. Nothing in `node_modules` is edited.

When you upgrade these packages (most importantly, when official 26.2 support is released), run the check below. Remove each workaround it reports as fixed.

## Installed versions the workarounds were written against

| Package | Version | Source |
| --- | --- | --- |
| mineflayer | 4.37.1+complexity.26.2.3 | github.com/Complexity-ML/mineflayer-26.2 |
| minecraft-protocol | 1.66.2+complexity.26.2.3 | github.com/Complexity-ML/node-minecraft-protocol-26.2 |
| minecraft-data | 3.111.0+complexity.26.2.5 | github.com/Complexity-ML/node-minecraft-data-26.2 |
| mineflayer-pathfinder | 2.4.5 | npm (unaffected) |

Server tested: Paper 26.2. All findings were checked against the vanilla 26.2 server (packet IDs) and vanilla 26.3 classes (chat validation logic).

## Checking whether the workarounds are still needed

```bash
npm run check:protocol
```

This probes the installed packages for each bug and prints `NEEDED` or `FIXED UPSTREAM` for each workaround. To also compare every packet the bot sends against vanilla's real packet IDs, generate the report from the official server jar for your version and pass it in:

```bash
# from an empty folder; the jar comes from Mojang's version manifest (piston-meta.mojang.com)
java -DbundlerMainClass=net.minecraft.data.Main -jar server.jar --reports --output out
npm run check:protocol -- out/reports/packets.json
```

The workarounds also check for the defect at runtime and switch themselves off once it's gone, so a fixed upstream release won't break anything. Still remove the dead code. Startup logs show which workarounds were applied (look for `[protocol]` lines).

---

## 1. Serverbound packet ID table is shifted

**File:** `src/bot/packetTablePatch.ts`, passed as `customPackets` in `src/bot/createBot.ts`

**Symptom:** almost every interaction gets the bot kicked: eating, placing blocks, opening crafting tables or chests, attacking, digging. The kick reason looks like:

```
Internal Exception: io.netty.handler.codec.DecoderException:
Failed to decode packet 'serverbound/minecraft:test_instance_block_action'
```

**Cause:** minecraft-data's 26.2 `play.toServer` table has 68 packets; vanilla has 69. It's missing `teleport_to_entity` and puts `swing` (`arm_animation`) in the wrong slot, so every packet from ID `0x3e` up gets the wrong number:

| Packet (minecraft-data name) | Fork sends ID | Vanilla 26.2 ID | Server reads it as |
| --- | --- | --- | --- |
| `arm_animation` (swing) | 62 | 63 | `spectator_action` |
| `block_place` (use_item_on) | 65 | 66 | `test_instance_block_action` |
| `use_item` | 66 | 67 | `use_item_on` |
| `custom_click_action` | 67 | 68 | `use_item` |
| `teleport_to_entity` | missing | 64 | — |

Chat, movement, inventory clicks and every packet below `0x3e` are numbered correctly. The clientbound, configuration and login tables match vanilla.

**Workaround:** a `customPackets` override (minecraft-protocol deep-merges it into minecraft-data's protocol) rewrites mappings `0x3e`–`0x44` to vanilla's order and adds the `packet_teleport_to_entity` type (`{ target: UUID }`).

**Applies only when:** mapping `0x3e` is `arm_animation` and `teleport_to_entity` is absent.

**To remove:** delete `packetTablePatch.ts` and the `customPackets` line in `createBot.ts`.

---

## 2. `use_entity` still uses the pre-26.x layout; attacks have their own packet

**File:** `src/bot/protocolFixes.ts` → `fixEntityPackets`, applied on `login` in `createBot.ts`

**Symptom:** the first attack (or breeding, shearing, mounting, trading) crashes the connection's packet writer:

```
TypeError: SizeOf error for undefined : Cannot read properties of undefined (reading 'x')
    at Object.sizeOfLpVec3 ... packet_use_entity
```

After that the bot sends nothing, and the server kicks it with `disconnect.timeout`.

**Cause:** since 26.x, attacking an entity is a separate `attack { entityId }` packet, and `use_entity` is `{ target, hand, location (lpVec3), usingSecondaryAction }`. mineflayer's `lib/plugins/entities.js` (`useEntity`) and `lib/plugins/inventory.js` (`activateEntity`, `activateEntityAt`) still send the old `{ target, mouse, sneaking }` layout, which can't be encoded.

**Workaround:** replace `bot.attack`, `bot.useOn`, `bot.mount`, `bot.activateEntity` and `bot.activateEntityAt` with versions that send the 26.x packets (`attack` followed by an arm swing for attacks; `use_entity` with a main hand and a location relative to the entity otherwise).

**Applies only when:** the protocol defines a `packet_attack` type.

**To remove:** delete `fixEntityPackets` once mineflayer's `useEntity` sends `hand`, `location` and `usingSecondaryAction`.

---

## 3. Signed-chat last-seen checksum uses the wrong order

**File:** `src/bot/protocolFixes.ts` → `fixChatChecksum`

**Symptom:** chat works for a while, then the bot is kicked the next time it speaks:

```
multiplayer.disconnect.chat_validation_failed
```

**Cause:** since 1.21.5, each chat message the client sends includes a one-byte checksum of the last-seen message signatures it acknowledges. Vanilla (`LastSeenMessagesTracker` / `LastSeenMessages.computeChecksum`) hashes its 20-slot ring oldest-first, starting from the ring's tail. minecraft-protocol's `computeChatChecksum` (`src/datatypes/checksums.js`) iterates the raw array from index 0. The two orders agree until 20 signed messages have arrived (both players' messages and the bot's own echoed messages count). From the 21st on, every checksum is wrong.

A second, related bug: on `hide_message` (a deleted chat message), `src/client/chat.js` rebuilds the ring with `.map()`. That produces a new instance whose `offset` and `pending` counters reset to 0, desyncing the bot from the server the same way.

The hash function itself matches vanilla; only the order is wrong. This was verified by running vanilla's `LastSeenMessagesTracker` on the same random signatures: identical for messages 1–20, different from 21 on.

**Workaround:** give `client._lastSeenMessages` an iterator that yields entries in vanilla's order, which the existing checksum code then uses. Also replace the `_lastSeenMessages` property with an accessor that copies the entries back into the original ring on assignment, keeping its counters.

**Applies only when:** `client._lastSeenMessages` is the offset-based ring (1.19.3+ chat sessions).

**To remove:** delete `fixChatChecksum` once `computeChatChecksum` walks the ring from its offset and `hide_message` no longer replaces the ring.

---

## Related safety net: outgoing packet validation

**File:** `src/bot/diagnostics.ts`

This isn't a workaround for one bug, so keep it after upgrading. Every outgoing packet is test-encoded against the protocol schema before it's sent. A packet that can't be encoded is dropped and logged with the code location that sent it (plus `logs/serialize-*.log`), instead of freezing the connection like bug 2 did. Kicks and connection errors write `logs/kick-*.log` with the reason, the running tool and the most recent packets in each direction. Set `LOG_PACKETS=all` to log packets live.

## If a new kick shows up

1. Read the newest `logs/kick-*.log`. Look at the last few `→` (sent) packets before the kick.
2. `Failed to decode packet 'serverbound/minecraft:X'` where the bot never sends X means a packet ID is wrong. Run `npm run check:protocol -- packets.json`.
3. `chat_validation_failed`, `out_of_order_chat` or similar means signed-chat state is off. Check `fixChatChecksum` against the current minecraft-protocol `client/chat.js`.
4. A `[diag] Dropped outgoing …` error means mineflayer built a packet that doesn't match the protocol schema. The logged stack shows which plugin sent it.
5. Paper-specific rejections (movement, reach, rate limits) usually show up as server system messages with `LOG_LEVEL=debug`.
