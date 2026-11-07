/**
 * Breeding foods per species, from the vanilla 26.2 item tags (data/minecraft/tags/item/*_food.json),
 * narrowed to what triggers love mode: horses only breed on golden food, llamas on hay bales.
 */
export const breedingFood: Record<string, string[]> = {
  cow: ['wheat'],
  mooshroom: ['wheat'],
  sheep: ['wheat'],
  goat: ['wheat'],
  pig: ['carrot', 'potato', 'beetroot'],
  chicken: ['wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds', 'torchflower_seeds', 'pitcher_pod'],
  rabbit: ['dandelion', 'carrot', 'golden_carrot'],
  horse: ['golden_carrot', 'golden_apple', 'enchanted_golden_apple'],
  donkey: ['golden_carrot', 'golden_apple', 'enchanted_golden_apple'],
  llama: ['hay_block'],
  wolf: ['beef', 'porkchop', 'chicken', 'mutton', 'rabbit', 'rotten_flesh', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton'],
  cat: ['cod', 'salmon'],
  ocelot: ['cod', 'salmon'],
  fox: ['sweet_berries', 'glow_berries'],
  panda: ['bamboo'],
  turtle: ['seagrass'],
  frog: ['slime_ball'],
  axolotl: ['tropical_fish_bucket'],
  bee: ['dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'sunflower'],
  camel: ['cactus'],
  sniffer: ['torchflower_seeds'],
  armadillo: ['spider_eye'],
  strider: ['warped_fungus'],
  hoglin: ['crimson_fungus']
}
export const needsTaming = new Set(['horse', 'donkey', 'llama', 'wolf', 'cat'])
