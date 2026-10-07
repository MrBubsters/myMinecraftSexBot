# minecraft-ai

A Minecraft bot (mineflayer) controlled by a local LLM (Ollama). The owner gives requests in chat ("get me a stone pickaxe", "build a hut here"), and the LLM carries them out by calling tools in a loop, reading each result before choosing the next step.

## Setup

```bash
npm install
cp .env.example .env   # fill in host, account, owner
npm start              # or: npm run dev (restarts on file changes)
npm run typecheck
```

Requires Node 22+ and Ollama with the configured model pulled (`ollama pull gpt-oss:20b`). The full option list is in `.env.example`. `OLLAMA_NUM_CTX` matters: the system prompt plus tool schemas are about 7k tokens, so keep it at 16k or more.

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
    guide.md            Minecraft know-how for the LLM (progression, tiers, worked examples)
    smelting.ts         furnace recipes and fuel values (missing from minecraft-data)
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
