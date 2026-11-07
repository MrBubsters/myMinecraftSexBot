/**
 * Ways to obtain items that are game mechanics rather than recipes or loot
 * tables, so they are missing from the vanilla data pack.
 */
export const specialSources: Record<string, string> = {
  honeycomb: 'use shears on a beehive or bee_nest that is full of honey (honey_level 5); bees fill it by pollinating flowers',
  honey_bottle: 'use a glass_bottle on a beehive or bee_nest that is full of honey (honey_level 5)',
  milk_bucket: 'use a bucket on a cow, mooshroom or goat',
  water_bucket: 'use a bucket on a water source block',
  lava_bucket: 'use a bucket on a lava source block',
  powder_snow_bucket: 'use a bucket on powder snow',
  mushroom_stew: 'use a bowl on a mooshroom, or craft it',
  white_wool: 'use shears on a sheep (1-3 wool, sheep regrows it by eating grass), or kill sheep',
  wheat_seeds: 'break short_grass or tall_grass (random drop), or harvest wheat',
  glow_ink_sac: 'kill a glow_squid',
  turtle_scute: 'dropped by a baby turtle when it grows up',
  armadillo_scute: 'brush an armadillo, or it drops one occasionally',
  egg: 'chickens lay eggs every 5-10 minutes; pick them up',
  dragon_breath: 'use a glass_bottle on the ender dragon\'s breath cloud',
  experience_bottle: 'buy from cleric villagers'
}
