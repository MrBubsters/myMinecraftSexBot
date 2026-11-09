# minecraft-ai

A Minecraft bot (mineflayer) controlled by a local LLM (Ollama). The owner gives requests in chat ("get me a stone pickaxe", "build a hut here"), and the LLM carries them out by calling tools in a loop, reading each result before choosing the next step.

## Setup

```bash
npm install
cp .env.example .env
```

In `.env`, set the required `MC_HOST` (server address), `MC_ACCOUNT` (account name/email) and `MC_OWNER` (your in-game username). Choose `MC_AUTH=microsoft` or `MC_AUTH=offline` as appropriate; optional settings and defaults are listed in `.env.example`. The npm start/dev commands load `.env` automatically. Requires Node 22+, a reachable Minecraft server matching `MC_VERSION`, and Ollama running with the configured model pulled (by default, `ollama pull gpt-oss:20b`). `OLLAMA_NUM_CTX` should be at least 16k because the system prompt and tool schemas use about 7k tokens.

Run the bot with `npm start`, or use `npm run dev` to restart it when files change. On first start it downloads the official Minecraft server jar in the background to build the knowledge base; the result is cached in `.cache/`.

## npm scripts

- `npm start` — start the bot, loading settings from `.env` if present.
- `npm run dev` — start the bot in watch mode, restarting when files change.
- `npm run typecheck` — run TypeScript checks without emitting files.
- `npm run check:protocol` — report which protocol workarounds are still needed.
- `npm run build:knowledge` — rebuild the game knowledge base, optionally showing results for a query.

## Game knowledge

The LLM's built-in Minecraft knowledge is often outdated for new versions. On first start the bot downloads the official server jar for `MC_VERSION` from Mojang (verified against Mojang's SHA1) and builds a knowledge base from the game's own data: every recipe (crafting, smelting, stonecutting, smithing), item and entity tags, block and mob loot tables, chest loot and villager trades. That's combined with minecraft-data (food values, harvest tools) and a few hand-written mechanics (`src/knowledge/mechanics.ts`, for things like shearing beehives). The result is about 2,000 short entries, cached in `.cache/`.

The model gets these entries in two ways:
- **Automatically:** entries for anything a request names (e.g. "breed the bees" → bee) are added to that request as trusted facts.
- **On demand:** the `lookup` tool searches the knowledge base, and the prompt tells the model to use it instead of its memory.

A new `MC_VERSION` builds a new knowledge base automatically. To force a rebuild, or to see what a query returns:

```bash
npm run build:knowledge
npm run build:knowledge -- "honeycomb"
```

## Protocol workarounds

Minecraft 26.2 support comes from community forks of mineflayer, minecraft-protocol and minecraft-data. Those forks have bugs that get the bot kicked, and `src/bot/packetTablePatch.ts` and `src/bot/protocolFixes.ts` work around them at runtime. [docs/PROTOCOL_WORKAROUNDS.md](docs/PROTOCOL_WORKAROUNDS.md) describes each one and how to remove it. After upgrading those packages, run:

```bash
npm run check:protocol
```

## Chat commands

These are handled instantly, without the LLM:

| Command | Effect |
| --- | --- |
| `stop` / `!stop` | Cancel the current task and anything queued |
| `!ping`, `!where`, `!inv`, `!status`, `!help` | Quick info |

Anything else from the owner goes to the agent. Requests are queued and run one at a time.

## Layout

```
src/
  index.ts              wiring: config → bot → agent → chat
  config.ts             env parsing and validation
  agent/
    agent.ts            request queue, cancellation, the LLM ↔ tool loop, short history
    llm.ts              Ollama client (streams so requests can be aborted)
    prompt.ts           system prompt = rules + generated tool catalog + guide.md
  bot/
    createBot.ts        mineflayer + pathfinder setup, lifecycle logging
    packetTablePatch.ts corrects the fork's serverbound packet IDs (see docs/PROTOCOL_WORKAROUNDS.md)
    protocolFixes.ts    runtime fixes for attack/use_entity packets and the signed-chat checksum
    diagnostics.ts      packet recorder, pre-send validation, kick reports in logs/
    navigation.ts       cancellable pathfinding; travel (no digging) vs. dig movement profiles
    crafting.ts         recursive crafter (ensureItem) and dry-run material planner (planMaterials)
    placement.ts        block placement with reach and reference-face handling
    inventory.ts        counts, diffs, best tool/weapon/armour/food
    world.ts            name resolution ("wood" → every log type), entity and block lookup
    status.ts           status text and the world-state snapshot sent with each request
    behaviors.ts        background behaviours (auto-eat while idle)
  chat/
    listener.ts         in-game chat and Discord-bridge messages from the owner
    commands.ts         built-in ! commands
  tools/                one file per category; registry.ts collects them
  knowledge/
    knowledgeBase.ts    builds/caches/searches game knowledge from the vanilla data pack
    vanillaData.ts      downloads the official server jar and reads recipes, tags, loot, trades
    breeding.ts         breeding food per species
    mechanics.ts        ways to obtain items that aren't recipes or loot (shearing hives, milking)
    guide.md            Minecraft know-how for the LLM (progression, tiers, worked examples)
    smelting.ts         furnace recipes and fuel values (missing from minecraft-data)
scripts/
  check-protocol.ts     reports which protocol workarounds are still needed
  build-knowledge.ts    rebuilds the knowledge base (optionally shows a query's results)
docs/
  PROTOCOL_WORKAROUNDS.md
```

## Design notes

- **Tools are high level.** `collect_block`, `craft_item` and `smelt_item` each do a whole job: path, choose the tool, dig, pick up drops, craft intermediates, set up a table or furnace. Small models do much better with five meaningful calls than with forty low-level ones.
- **Errors are instructions.** Tool failures go back to the LLM as `Error: ...` text that says how to fix the problem. For example, `craft_item` runs the material planner first and answers "Still need to gather in total: 2 log, 3 cobblestone … Suggested: collect_block log count 2, then collect_block stone count 3".
- **Everything is cancellable.** Each task gets an `AbortSignal`. `stop` aborts the LLM request, pathfinding, digging and waits.
- **Owner only.** Only `MC_OWNER` (and `DISCORD_OWNER` through the bridge) can command the bot. `say` refuses messages starting with `/`, so the LLM can't run server commands.

## Adding a tool

1. Add a `defineTool({...})` to the matching file in `src/tools/` (or create a new file and register it in `registry.ts`).
2. Read arguments through `args.string('x')`, `args.optionalNumber('y', { min, max })` and so on. They coerce the LLM's loose input and throw `ToolInputError` with a readable message.
3. Pass `signal` to anything long-running (`navigate`, `sleep`) and call `throwIfAborted(signal)` in loops.
4. Return a short factual string. Include the inventory change when items move (`describeInventoryChange`).
5. If the tool opens up a new kind of task, add a line or a worked example to `knowledge/guide.md`.

The tool catalog in the system prompt is generated from the registry, so no other changes are needed.
