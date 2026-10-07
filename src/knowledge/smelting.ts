/**
 * Furnace recipes (input -> output). minecraft-data ships crafting recipes only,
 * so the common smelting recipes are listed here by hand.
 */
export const smeltingRecipes: Record<string, string> = {
  raw_iron: 'iron_ingot',
  raw_gold: 'gold_ingot',
  raw_copper: 'copper_ingot',
  iron_ore: 'iron_ingot',
  deepslate_iron_ore: 'iron_ingot',
  gold_ore: 'gold_ingot',
  deepslate_gold_ore: 'gold_ingot',
  copper_ore: 'copper_ingot',
  deepslate_copper_ore: 'copper_ingot',
  ancient_debris: 'netherite_scrap',
  sand: 'glass',
  red_sand: 'glass',
  cobblestone: 'stone',
  stone: 'smooth_stone',
  cobbled_deepslate: 'deepslate',
  clay_ball: 'brick',
  clay: 'terracotta',
  netherrack: 'nether_brick',
  cactus: 'green_dye',
  kelp: 'dried_kelp',
  wet_sponge: 'sponge',
  beef: 'cooked_beef',
  porkchop: 'cooked_porkchop',
  chicken: 'cooked_chicken',
  mutton: 'cooked_mutton',
  rabbit: 'cooked_rabbit',
  cod: 'cooked_cod',
  salmon: 'cooked_salmon',
  potato: 'baked_potato',
  oak_log: 'charcoal',
  spruce_log: 'charcoal',
  birch_log: 'charcoal',
  jungle_log: 'charcoal',
  acacia_log: 'charcoal',
  dark_oak_log: 'charcoal',
  mangrove_log: 'charcoal',
  cherry_log: 'charcoal',
  pale_oak_log: 'charcoal'
}

/** Items that burn in a furnace and how many items each one smelts. */
export const fuels: Array<{ match: (name: string) => boolean; smelts: number }> = [
  { match: n => n === 'coal_block', smelts: 80 },
  { match: n => n === 'lava_bucket', smelts: 100 },
  { match: n => n === 'coal' || n === 'charcoal', smelts: 8 },
  { match: n => n === 'blaze_rod', smelts: 12 },
  { match: n => n.endsWith('_log') || n.endsWith('_wood') || n.endsWith('_stem'), smelts: 1.5 },
  { match: n => n.endsWith('_planks'), smelts: 1.5 },
  { match: n => n === 'stick' || n.endsWith('_sapling'), smelts: 0.5 }
]

export function fuelValue(name: string): number {
  return fuels.find(f => f.match(name))?.smelts ?? 0
}

export function smeltingInputsFor(output: string): string[] {
  return Object.entries(smeltingRecipes).filter(([, out]) => out === output).map(([input]) => input)
}
