/**
 * BetterJungler ADC Knowledge Pack — Patch 16.23.1.
 *
 * Parallel to `jungleKnowledgePack.ts` and fully independent of it: nothing here is read by
 * the Jungle draft engine, so Jungle scores stay byte-identical.
 *
 * Every champion, item, summoner spell and perk ID in this file is restricted to the verified
 * Patch 16.23.1 allow-lists below (`ADC_VERIFIED_PERK_IDS`, `ADC_ITEM_CATALOG`).
 */
import type { ItemMetadata, MetaTier, RunePageSpec } from '../types/coaching';

export const ADC_KNOWLEDGE_PACK_PATCH = '16.23.1';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdcArchetype = 'hypercarry' | 'lane_bully' | 'caster_poke' | 'skirmisher' | 'utility';
export type AdcRangeTier = 'short' | 'medium' | 'long';
export type AdcDamageProfile = 'ad' | 'hybrid';
export type AdcScalingProfile = 'early' | 'mid' | 'late';
export type SupportArchetype = 'engage' | 'enchanter' | 'poke' | 'catcher';

/** Heal/Flash, Barrier/Flash or Cleanse/Flash. */
export type AdcSummonerSpellPair = [7, 4] | [21, 4] | [1, 4];

/** Berserker's Greaves, Boots of Swiftness, Ionian Boots of Lucidity. */
export type AdcBootItemId = 3006 | 3009 | 3158;

export interface AdcChampionProfile {
  championId: number;
  key: string;
  name: string;
  metaTier: MetaTier;
  metaScore: number;
  archetype: AdcArchetype;
  rangeTier: AdcRangeTier;
  /** 1..10 — how hard the champion wins the first level-2 all-in. */
  level2Strength: number;
  damageProfile: AdcDamageProfile;
  scalingProfile: AdcScalingProfile;
  preferredSupports: SupportArchetype[];
  strongIntoIds: number[];
  weakIntoIds: number[];
  synergizesWithIds: number[];
  recommendedSpells: AdcSummonerSpellPair;
  recommendedRunes: RunePageSpec;
  coreItemIds: number[];
  situationalItemIds: number[];
  bootItemId: AdcBootItemId;
}

export interface SupportArchetypeEntry {
  archetype: SupportArchetype;
  name: string;
  shortNote: string;
  /** Used by the ADC team-needs check for AD/AP balance; supports are never scored as ADC picks. */
  damageProfile: 'ad' | 'ap' | 'tank';
}

// ---------------------------------------------------------------------------
// Summoner spells
// ---------------------------------------------------------------------------

export const ADC_SUMMONER_SPELL_INFO: Record<number, { name: string; key: string }> = {
  1: { name: 'Cleanse', key: 'SummonerBoost' },
  4: { name: 'Flash', key: 'SummonerFlash' },
  7: { name: 'Heal', key: 'SummonerHeal' },
  21: { name: 'Barrier', key: 'SummonerBarrier' },
};

// ---------------------------------------------------------------------------
// Runes (verified Patch 16.23.1 perk IDs only)
// ---------------------------------------------------------------------------

export const RUNE_STYLE_PRECISION = 8000;
export const RUNE_STYLE_DOMINATION = 8100;
export const RUNE_STYLE_SORCERY = 8200;
export const RUNE_STYLE_INSPIRATION = 8300;
export const RUNE_STYLE_RESOLVE = 8400;

export const ADC_PERK_NAMES: Record<number, string> = {
  // Keystones
  8005: 'Press the Attack',
  8008: 'Lethal Tempo',
  8021: 'Fleet Footwork',
  8010: 'Conqueror',
  9923: 'Hail of Blades',
  8369: 'First Strike',
  // Precision slot 1
  9101: 'Absorb Life',
  9111: 'Triumph',
  8009: 'Presence of Mind',
  // Precision slot 2
  9104: 'Legend: Alacrity',
  9105: 'Legend: Haste',
  9103: 'Legend: Bloodline',
  // Precision slot 3
  8014: 'Coup de Grace',
  8017: 'Cut Down',
  8299: 'Last Stand',
  // Sorcery
  8226: 'Manaflow Band',
  8233: 'Absolute Focus',
  8236: 'Gathering Storm',
  // Inspiration
  8304: 'Magical Footwear',
  8345: 'Biscuit Delivery',
  8347: 'Cosmic Insight',
  // Domination
  8126: 'Cheap Shot',
  8139: 'Taste of Blood',
  8143: 'Sudden Impact',
  8135: 'Treasure Hunter',
  // Resolve
  8444: 'Second Wind',
  8473: 'Bone Plating',
  8451: 'Overgrowth',
  // Stat shards
  5005: 'Attack Speed',
  5008: 'Adaptive Force',
  5001: 'Health Scaling',
};

/** The only perk IDs ADC rune pages may reference on Patch 16.23.1. */
export const ADC_VERIFIED_PERK_IDS: ReadonlySet<number> = new Set(
  Object.keys(ADC_PERK_NAMES).map(Number)
);

const STAT_SHARDS = [5005, 5008, 5001] as const;

type SecondaryTree = 'sorcery' | 'inspiration' | 'domination' | 'resolve';

/** Two perks from two different rows of each secondary tree. */
const SECONDARY_PAGES: Record<SecondaryTree, { styleId: number; perks: [number, number] }> = {
  sorcery: { styleId: RUNE_STYLE_SORCERY, perks: [8226, 8236] },
  inspiration: { styleId: RUNE_STYLE_INSPIRATION, perks: [8345, 8347] },
  domination: { styleId: RUNE_STYLE_DOMINATION, perks: [8139, 8135] },
  resolve: { styleId: RUNE_STYLE_RESOLVE, perks: [8444, 8451] },
};

function precisionPage(
  championName: string,
  keystone: 8005 | 8008 | 8021 | 8010,
  slot1: 9101 | 9111 | 8009,
  slot2: 9104 | 9105 | 9103,
  slot3: 8014 | 8017 | 8299,
  secondary: SecondaryTree
): RunePageSpec {
  const sec = SECONDARY_PAGES[secondary];
  const selectedPerkIds: RunePageSpec['selectedPerkIds'] = [
    keystone,
    slot1,
    slot2,
    slot3,
    sec.perks[0],
    sec.perks[1],
    ...STAT_SHARDS,
  ];
  return {
    name: `BetterJungler ADC: ${championName} ${ADC_PERK_NAMES[keystone]}`,
    primaryStyleId: RUNE_STYLE_PRECISION,
    subStyleId: sec.styleId,
    selectedPerkIds,
    summaryLabels: selectedPerkIds.slice(0, 6).map((id) => ADC_PERK_NAMES[id] ?? `Perk ${id}`),
  };
}

/** First Strike (Inspiration primary) with a Precision secondary. */
function firstStrikePage(championName: string): RunePageSpec {
  const selectedPerkIds: RunePageSpec['selectedPerkIds'] = [
    8369,
    8304,
    8345,
    8347,
    8009,
    9104,
    ...STAT_SHARDS,
  ];
  return {
    name: `BetterJungler ADC: ${championName} First Strike`,
    primaryStyleId: RUNE_STYLE_INSPIRATION,
    subStyleId: RUNE_STYLE_PRECISION,
    selectedPerkIds,
    summaryLabels: selectedPerkIds.slice(0, 6).map((id) => ADC_PERK_NAMES[id] ?? `Perk ${id}`),
  };
}

// ---------------------------------------------------------------------------
// Items (verified Patch 16.23.1 ADC items only)
// ---------------------------------------------------------------------------

export const ADC_ITEM_CATALOG: Record<number, ItemMetadata> = {
  // Boots
  3006: { id: 3006, name: "Berserker's Greaves", cost: 1100, tags: ['boots'], shortReason: 'Attack speed DPS boots' },
  3009: { id: 3009, name: 'Boots of Swiftness', cost: 1000, tags: ['boots'], shortReason: 'Kiting tempo & slow resist' },
  3158: { id: 3158, name: 'Ionian Boots of Lucidity', cost: 900, tags: ['boots'], shortReason: 'Ability & Summoner spell haste' },

  // Crit / attack-speed core
  3032: { id: 3032, name: 'Yun Tal Wildarrows', cost: 3000, tags: [], shortReason: 'Fast crit + attack-speed first-item spike' },
  6672: { id: 6672, name: 'Kraken Slayer', cost: 3000, tags: [], shortReason: 'On-hit true damage for extended DPS' },
  3031: { id: 3031, name: 'Infinity Edge', cost: 3500, tags: [], shortReason: 'Crit damage amplifier for the 2–3 item spike' },
  3046: { id: 3046, name: 'Phantom Dancer', cost: 2650, tags: [], shortReason: 'Ghosting + attack speed for front-to-back kiting' },
  3085: { id: 3085, name: "Runaan's Hurricane", cost: 2650, tags: [], shortReason: 'Bolts for wave clear and multi-target teamfights' },
  3094: { id: 3094, name: 'Rapid Firecannon', cost: 2650, tags: [], shortReason: 'Extended energized range for safe siege & poke' },
  6675: { id: 6675, name: 'Navori Flickerblade', cost: 2650, tags: [], shortReason: 'Crits refund basic ability cooldowns' },
  6676: { id: 6676, name: 'The Collector', cost: 3000, tags: [], shortReason: 'Execute threshold + lethality burst' },

  // Penetration / anti-heal
  3036: { id: 3036, name: "Lord Dominik's Regards", cost: 3300, tags: ['armor-pen'], shortReason: 'Armor penetration vs tanky frontlines' },
  3033: { id: 3033, name: 'Mortal Reminder', cost: 3000, tags: ['anti-heal', 'armor-pen'], shortReason: 'Grievous Wounds + armor pen vs sustain' },
  6694: { id: 6694, name: "Serylda's Grudge", cost: 3000, tags: ['armor-pen'], shortReason: 'Percent armor pen + ability slow' },

  // Defensive
  3072: { id: 3072, name: 'Bloodthirster', cost: 3400, tags: ['anti-burst'], shortReason: 'Lifesteal + overheal shield vs poke' },
  6673: { id: 6673, name: 'Immortal Shieldbow', cost: 3000, tags: ['anti-burst'], shortReason: 'Lifeline shield vs assassins & dive' },
  3026: { id: 3026, name: 'Guardian Angel', cost: 3200, tags: ['anti-burst'], shortReason: 'Revive to survive focused teamfights' },
  3139: { id: 3139, name: 'Mercurial Scimitar', cost: 3200, tags: ['mr', 'tenacity'], shortReason: 'QSS active + MR vs suppression/hard CC' },
  3140: { id: 3140, name: 'Quicksilver Sash', cost: 1300, tags: ['mr', 'tenacity'], shortReason: 'Cheap cleanse active vs point-and-click CC' },

  // Caster / on-hit / bruiser ADC items
  3508: { id: 3508, name: 'Essence Reaver', cost: 3050, tags: [], shortReason: 'Mana sustain + haste for spell-weaving ADCs' },
  3087: { id: 3087, name: 'Statikk Shiv', cost: 3000, tags: [], shortReason: 'Chain lightning wave clear & skirmish burst' },
  3124: { id: 3124, name: "Guinsoo's Rageblade", cost: 3000, tags: [], shortReason: 'Phantom on-hit procs for on-hit carries' },
  3302: { id: 3302, name: 'Terminus', cost: 3000, tags: ['armor-pen'], shortReason: 'Alternating armor/MR shred in extended fights' },
  3153: { id: 3153, name: 'Blade of The Ruined King', cost: 3200, tags: ['armor-pen'], shortReason: 'Current-HP shred vs high-HP targets' },
  3078: { id: 3078, name: 'Trinity Force', cost: 3333, tags: [], shortReason: 'Spellblade burst for ability-weaving ADCs' },
  3004: { id: 3004, name: 'Manamune', cost: 2900, tags: [], shortReason: 'Mana-scaling AD for spam casters' },
  3161: { id: 3161, name: 'Spear of Shojin', cost: 3100, tags: [], shortReason: 'Basic ability haste & damage ramp' },
  6697: { id: 6697, name: 'Hubris', cost: 2800, tags: [], shortReason: 'Lethality snowball from takedowns' },
};

/** Items that indicate a profile can shred tanky frontlines from its core build. */
export const ADC_TANK_SHRED_ITEM_IDS: ReadonlySet<number> = new Set([3036, 3153, 3302, 6672]);

// ---------------------------------------------------------------------------
// Supports
// ---------------------------------------------------------------------------

export const SUPPORT_ARCHETYPES: Record<number, SupportArchetypeEntry> = {
  412: { archetype: 'catcher', name: 'Thresh', shortNote: 'Hook picks + lantern peel', damageProfile: 'tank' },
  111: { archetype: 'engage', name: 'Nautilus', shortNote: 'Point-and-click lockdown all-ins', damageProfile: 'tank' },
  89: { archetype: 'engage', name: 'Leona', shortNote: 'Level-2 stun chain engage', damageProfile: 'tank' },
  117: { archetype: 'enchanter', name: 'Lulu', shortNote: 'Polymorph peel + Wild Growth for hypercarries', damageProfile: 'ap' },
  267: { archetype: 'enchanter', name: 'Nami', shortNote: 'Tidecaller buff for auto-trade lanes', damageProfile: 'ap' },
  40: { archetype: 'enchanter', name: 'Janna', shortNote: 'Disengage + shields vs dive', damageProfile: 'ap' },
  902: { archetype: 'enchanter', name: 'Milio', shortNote: 'Range buff + cleanse ultimate', damageProfile: 'ap' },
  99: { archetype: 'poke', name: 'Lux', shortNote: 'Long-range snare + poke', damageProfile: 'ap' },
  43: { archetype: 'poke', name: 'Karma', shortNote: 'Empowered Q poke + speed shields', damageProfile: 'ap' },
  201: { archetype: 'engage', name: 'Braum', shortNote: 'Warden peel + passive stun stacks', damageProfile: 'tank' },
  53: { archetype: 'catcher', name: 'Blitzcrank', shortNote: 'Hook threat zones the lane', damageProfile: 'tank' },
  555: { archetype: 'catcher', name: 'Pyke', shortNote: 'Hook + execute snowball', damageProfile: 'ad' },
  526: { archetype: 'engage', name: 'Rell', shortNote: 'Crash-down engage + magnet storm', damageProfile: 'tank' },
  497: { archetype: 'engage', name: 'Rakan', shortNote: 'Fast flank engage & charm', damageProfile: 'ap' },
  12: { archetype: 'engage', name: 'Alistar', shortNote: 'Headbutt-pulverize all-ins', damageProfile: 'tank' },
  16: { archetype: 'enchanter', name: 'Soraka', shortNote: 'Heavy sustain + silence zone', damageProfile: 'ap' },
  235: { archetype: 'poke', name: 'Senna', shortNote: 'Long-range poke + global ult', damageProfile: 'ad' },
  25: { archetype: 'catcher', name: 'Morgana', shortNote: 'Binding picks + Black Shield', damageProfile: 'ap' },
  888: { archetype: 'enchanter', name: 'Renata Glasc', shortNote: 'Bailout revive + Hostile Takeover', damageProfile: 'ap' },
  143: { archetype: 'poke', name: 'Zyra', shortNote: 'Plant zone control + root', damageProfile: 'ap' },
  432: { archetype: 'catcher', name: 'Bard', shortNote: 'Roaming stun picks + chimes', damageProfile: 'ap' },
  147: { archetype: 'poke', name: 'Seraphine', shortNote: 'Echo poke + long-range charm ult', damageProfile: 'ap' },
  223: { archetype: 'engage', name: 'Tahm Kench', shortNote: 'Devour save + level-2 all-in', damageProfile: 'tank' },
  44: { archetype: 'enchanter', name: 'Taric', shortNote: 'Invulnerability ult for all-ins', damageProfile: 'tank' },
  350: { archetype: 'enchanter', name: 'Yuumi', shortNote: 'Attached sustain + attack-speed buffs', damageProfile: 'ap' },
};

/** Supports frequently drafted into a non-bot role (mid/top/jungle) — lowers inference confidence. */
export const FLEX_SUPPORT_IDS: ReadonlySet<number> = new Set([99, 143, 147, 43, 25, 235, 223, 555, 432]);

/** Marksmen frequently drafted into mid/top — lowers enemy bot-lane inference confidence. */
export const FLEX_ADC_IDS: ReadonlySet<number> = new Set([42, 110, 81, 901, 236, 67, 18]);

/**
 * Hand-curated combo notes keyed `${adcId}:${supportId}`. Pairs listed here always appear in the
 * ADC's `synergizesWithIds`.
 */
export const ADC_SUPPORT_COMBO_NOTES: Record<string, string> = {
  '222:117': 'Lulu Wild Growth + Polymorph lets Jinx reach Get Excited resets safely',
  '222:40': 'Janna disengage keeps Jinx rocket-range DPS alive vs dive',
  '145:111': 'Nautilus lockdown fills Kai\'Sa Plasma stacks for instant evolves',
  '145:497': 'Rakan charm engage + Kai\'Sa ult follow-up on marked targets',
  '51:99': 'Lux snare guarantees Caitlyn trap headshots',
  '51:25': 'Morgana binding chains into Caitlyn trap headshots',
  '202:143': 'Zyra roots set up Jhin W snare and 4th-shot execute',
  '21:89': 'Leona stuns lock targets inside Bullet Time',
  '21:526': 'Rell magnet engage channels a full Bullet Time',
  '236:267': 'Nami Tidecaller empowers Lucian double-shot passive trades',
  '236:201': 'Lucian passive procs Braum Concussive Blows stacks instantly',
  '67:117': 'Lulu peel + attack speed turns Vayne into a late-game monster',
  '119:89': 'Leona level-2 engage + Draven axes win the early all-in',
  '119:111': 'Nautilus point-and-click CC lets Draven juggle axes freely',
  '498:497': 'Lovers duo: shared recall + Rakan engage into Featherstorm',
  '18:89': 'Leona engage + Tristana Rocket Jump all-ins at level 2',
  '360:111': 'Nautilus CC grants instant Samira style grade for Inferno Trigger',
  '360:526': 'Rell engage gathers targets for a full Inferno Trigger',
  '96:117': 'Lulu Whimsy + ult keep Kog\'Maw Bio-Arcane Barrage firing',
  '29:117': 'Lulu speed + Polymorph protect Twitch Spray and Pray',
  '523:412': 'Thresh lantern repositions Aphelios after Moonlight Vigil',
  '110:432': 'Bard tunnel ambushes into Varus Chain of Corruption',
  '221:117': 'Lulu Whimsy on Zeri Lightning Crash outruns any dive',
  '901:117': 'Lulu peel buys Smolder the time to stack Dragon Practice',
  '804:902': 'Milio range buff + cleanse ult keeps Yunara auto-attacking',
  '15:43': 'Karma speed shields + Sivir On The Hunt create unstoppable engages',
  '22:147': 'Seraphine Encore chains into Ashe Crystal Arrow for wombo combos',
  '81:43': 'Karma Mantra Q poke + Ezreal Q spam dominates lane range',
  '42:99': 'Lux snares give Corki free Package burst windows',
};

// ---------------------------------------------------------------------------
// ADC champion pool (verified Patch 16.23.1 champion IDs)
// ---------------------------------------------------------------------------

export const ADC_CHAMPIONS: AdcChampionProfile[] = [
  {
    championId: 222,
    key: 'Jinx',
    name: 'Jinx',
    metaTier: 'A',
    metaScore: 88,
    archetype: 'hypercarry',
    rangeTier: 'medium',
    level2Strength: 4,
    damageProfile: 'ad',
    scalingProfile: 'late',
    preferredSupports: ['enchanter', 'engage'],
    strongIntoIds: [96, 523, 67],
    weakIntoIds: [119, 236, 360, 18, 51],
    synergizesWithIds: [117, 40, 412, 902, 89],
    recommendedSpells: [7, 4],
    recommendedRunes: precisionPage('Jinx', 8008, 8009, 9104, 8014, 'sorcery'),
    coreItemIds: [3032, 3031, 3046],
    situationalItemIds: [3036, 3033, 3072, 3026, 6673, 3139],
    bootItemId: 3006,
  },
  {
    championId: 145,
    key: 'Kaisa',
    name: "Kai'Sa",
    metaTier: 'S',
    metaScore: 92,
    archetype: 'skirmisher',
    rangeTier: 'short',
    level2Strength: 6,
    damageProfile: 'hybrid',
    scalingProfile: 'mid',
    preferredSupports: ['engage', 'catcher'],
    strongIntoIds: [523, 222, 96],
    weakIntoIds: [51, 202, 236],
    synergizesWithIds: [111, 89, 497, 412, 526],
    recommendedSpells: [7, 4],
    recommendedRunes: precisionPage("Kai'Sa", 8005, 9111, 9104, 8014, 'domination'),
    coreItemIds: [6672, 3124, 3302],
    situationalItemIds: [3153, 3087, 3026, 3036, 3139, 3033],
    bootItemId: 3006,
  },
  {
    championId: 51,
    key: 'Caitlyn',
    name: 'Caitlyn',
    metaTier: 'S',
    metaScore: 91,
    archetype: 'lane_bully',
    rangeTier: 'long',
    level2Strength: 8,
    damageProfile: 'ad',
    scalingProfile: 'mid',
    preferredSupports: ['poke', 'catcher'],
    strongIntoIds: [222, 96, 523, 67, 145],
    weakIntoIds: [119, 236, 360],
    synergizesWithIds: [99, 25, 43, 235, 143],
    recommendedSpells: [7, 4],
    recommendedRunes: precisionPage('Caitlyn', 8021, 9101, 9104, 8014, 'inspiration'),
    coreItemIds: [3032, 3031, 3036],
    situationalItemIds: [6676, 3094, 3033, 3072, 3026, 3139],
    bootItemId: 3006,
  },
  {
    championId: 81,
    key: 'Ezreal',
    name: 'Ezreal',
    metaTier: 'A',
    metaScore: 86,
    archetype: 'caster_poke',
    rangeTier: 'long',
    level2Strength: 5,
    damageProfile: 'ad',
    scalingProfile: 'mid',
    preferredSupports: ['poke', 'enchanter'],
    strongIntoIds: [96, 22, 202],
    weakIntoIds: [119, 360, 18],
    synergizesWithIds: [43, 99, 147, 267],
    recommendedSpells: [7, 4],
    recommendedRunes: firstStrikePage('Ezreal'),
    coreItemIds: [3004, 3078, 6694],
    situationalItemIds: [3508, 3161, 3036, 3033, 3026, 3139],
    bootItemId: 3158,
  },
  {
    championId: 202,
    key: 'Jhin',
    name: 'Jhin',
    metaTier: 'A',
    metaScore: 87,
    archetype: 'utility',
    rangeTier: 'long',
    level2Strength: 7,
    damageProfile: 'ad',
    scalingProfile: 'mid',
    preferredSupports: ['poke', 'catcher'],
    strongIntoIds: [96, 523, 22],
    weakIntoIds: [119, 360, 236, 145],
    synergizesWithIds: [143, 25, 99, 432],
    recommendedSpells: [7, 4],
    recommendedRunes: precisionPage('Jhin', 8021, 9101, 9105, 8014, 'inspiration'),
    coreItemIds: [6676, 3094, 3031],
    situationalItemIds: [3036, 3033, 3072, 3026, 3140],
    bootItemId: 3009,
  },
  {
    championId: 22,
    key: 'Ashe',
    name: 'Ashe',
    metaTier: 'A',
    metaScore: 85,
    archetype: 'utility',
    rangeTier: 'long',
    level2Strength: 6,
    damageProfile: 'ad',
    scalingProfile: 'mid',
    preferredSupports: ['poke', 'engage'],
    strongIntoIds: [96, 523, 222],
    weakIntoIds: [119, 236, 81, 360],
    synergizesWithIds: [147, 99, 43, 201],
    recommendedSpells: [7, 4],
    recommendedRunes: precisionPage('Ashe', 8008, 8009, 9104, 8017, 'sorcery'),
    coreItemIds: [3153, 3124, 3085],
    situationalItemIds: [6672, 3036, 3033, 3026, 3139, 3302],
    bootItemId: 3006,
  },
  {
    championId: 21,
    key: 'MissFortune',
    name: 'Miss Fortune',
    metaTier: 'S',
    metaScore: 90,
    archetype: 'lane_bully',
    rangeTier: 'medium',
    level2Strength: 8,
    damageProfile: 'ad',
    scalingProfile: 'mid',
    preferredSupports: ['engage', 'poke'],
    strongIntoIds: [222, 96, 523, 67],
    weakIntoIds: [119, 51, 81],
    synergizesWithIds: [89, 526, 111, 147, 143],
    recommendedSpells: [7, 4],
    recommendedRunes: precisionPage('Miss Fortune', 8005, 9111, 9104, 8014, 'sorcery'),
    coreItemIds: [6676, 3032, 3031],
    situationalItemIds: [3036, 3033, 3072, 3026, 3140, 6694],
    bootItemId: 3006,
  },
  {
    championId: 236,
    key: 'Lucian',
    name: 'Lucian',
    metaTier: 'A',
    metaScore: 87,
    archetype: 'lane_bully',
    rangeTier: 'short',
    level2Strength: 9,
    damageProfile: 'ad',
    scalingProfile: 'early',
    preferredSupports: ['enchanter', 'engage'],
    strongIntoIds: [222, 22, 523, 96, 202],
    weakIntoIds: [51, 119, 18],
    synergizesWithIds: [267, 201, 902, 89],
    recommendedSpells: [7, 4],
    recommendedRunes: precisionPage('Lucian', 8005, 9111, 9104, 8014, 'domination'),
    coreItemIds: [3508, 6675, 3031],
    situationalItemIds: [3036, 3033, 3072, 3026, 3140],
    bootItemId: 3006,
  },
  {
    championId: 67,
    key: 'Vayne',
    name: 'Vayne',
    metaTier: 'B',
    metaScore: 82,
    archetype: 'hypercarry',
    rangeTier: 'short',
    level2Strength: 4,
    damageProfile: 'ad',
    scalingProfile: 'late',
    preferredSupports: ['enchanter', 'engage'],
    strongIntoIds: [22, 96, 221],
    weakIntoIds: [51, 119, 236, 21, 202],
    synergizesWithIds: [117, 201, 40, 902],
    recommendedSpells: [1, 4],
    recommendedRunes: precisionPage('Vayne', 8008, 9111, 9104, 8299, 'resolve'),
    coreItemIds: [3153, 3124, 3085],
    situationalItemIds: [3302, 3036, 3033, 3026, 3139],
    bootItemId: 3006,
  },
  {
    championId: 119,
    key: 'Draven',
    name: 'Draven',
    metaTier: 'A',
    metaScore: 86,
    archetype: 'lane_bully',
    rangeTier: 'medium',
    level2Strength: 10,
    damageProfile: 'ad',
    scalingProfile: 'early',
    preferredSupports: ['engage', 'catcher'],
    strongIntoIds: [222, 67, 96, 523, 22, 202],
    weakIntoIds: [51, 18, 360],
    synergizesWithIds: [89, 111, 412, 555, 526],
    recommendedSpells: [21, 4],
    recommendedRunes: precisionPage('Draven', 8010, 9111, 9104, 8014, 'domination'),
    coreItemIds: [3032, 3072, 3031],
    situationalItemIds: [3036, 3033, 3046, 3026, 3139],
    bootItemId: 3006,
  },
  {
    championId: 498,
    key: 'Xayah',
    name: 'Xayah',
    metaTier: 'A',
    metaScore: 85,
    archetype: 'hypercarry',
    rangeTier: 'medium',
    level2Strength: 5,
    damageProfile: 'ad',
    scalingProfile: 'late',
    preferredSupports: ['engage', 'enchanter'],
    strongIntoIds: [360, 119, 145],
    weakIntoIds: [51, 21, 81],
    synergizesWithIds: [497, 117, 412],
    recommendedSpells: [7, 4],
    recommendedRunes: precisionPage('Xayah', 8008, 8009, 9104, 8014, 'inspiration'),
    coreItemIds: [3032, 3031, 6675],
    situationalItemIds: [3036, 3033, 3072, 3026, 3139],
    bootItemId: 3006,
  },
  {
    championId: 18,
    key: 'Tristana',
    name: 'Tristana',
    metaTier: 'A',
    metaScore: 84,
    archetype: 'skirmisher',
    rangeTier: 'short',
    level2Strength: 7,
    damageProfile: 'ad',
    scalingProfile: 'mid',
    preferredSupports: ['engage', 'enchanter'],
    strongIntoIds: [222, 81, 96, 523],
    weakIntoIds: [51, 119, 21],
    synergizesWithIds: [89, 12, 526, 117],
    recommendedSpells: [7, 4],
    recommendedRunes: precisionPage('Tristana', 8008, 9111, 9104, 8014, 'domination'),
    coreItemIds: [3032, 3031, 6676],
    situationalItemIds: [3036, 3033, 3072, 3026, 3139],
    bootItemId: 3006,
  },
  {
    championId: 15,
    key: 'Sivir',
    name: 'Sivir',
    metaTier: 'A',
    metaScore: 84,
    archetype: 'utility',
    rangeTier: 'medium',
    level2Strength: 5,
    damageProfile: 'ad',
    scalingProfile: 'mid',
    preferredSupports: ['enchanter', 'poke'],
    strongIntoIds: [96, 523, 202],
    weakIntoIds: [119, 236, 360, 51],
    synergizesWithIds: [43, 40, 117, 99],
    recommendedSpells: [7, 4],
    recommendedRunes: precisionPage('Sivir', 8008, 9111, 9103, 8014, 'inspiration'),
    coreItemIds: [6675, 3031, 3085],
    situationalItemIds: [3036, 3033, 3072, 3026, 3140],
    bootItemId: 3006,
  },
  {
    championId: 110,
    key: 'Varus',
    name: 'Varus',
    metaTier: 'A',
    metaScore: 85,
    archetype: 'caster_poke',
    rangeTier: 'long',
    level2Strength: 6,
    damageProfile: 'hybrid',
    scalingProfile: 'mid',
    preferredSupports: ['poke', 'catcher'],
    strongIntoIds: [96, 523, 202],
    weakIntoIds: [119, 236, 145],
    synergizesWithIds: [432, 99, 43, 25],
    recommendedSpells: [7, 4],
    recommendedRunes: precisionPage('Varus', 8008, 8009, 9104, 8017, 'sorcery'),
    coreItemIds: [3153, 3124, 3302],
    situationalItemIds: [3036, 3033, 3026, 3139, 6694],
    bootItemId: 3006,
  },
  {
    championId: 523,
    key: 'Aphelios',
    name: 'Aphelios',
    metaTier: 'B',
    metaScore: 82,
    archetype: 'hypercarry',
    rangeTier: 'medium',
    level2Strength: 3,
    damageProfile: 'ad',
    scalingProfile: 'late',
    preferredSupports: ['enchanter', 'engage'],
    strongIntoIds: [96, 67],
    weakIntoIds: [119, 236, 51, 21, 145],
    synergizesWithIds: [117, 412, 89, 40],
    recommendedSpells: [7, 4],
    recommendedRunes: precisionPage('Aphelios', 8008, 8009, 9104, 8014, 'inspiration'),
    coreItemIds: [3032, 3031, 3036],
    situationalItemIds: [3072, 3033, 3026, 3139, 3085],
    bootItemId: 3006,
  },
  {
    championId: 221,
    key: 'Zeri',
    name: 'Zeri',
    metaTier: 'B',
    metaScore: 81,
    archetype: 'hypercarry',
    rangeTier: 'medium',
    level2Strength: 4,
    damageProfile: 'ad',
    scalingProfile: 'late',
    preferredSupports: ['enchanter'],
    strongIntoIds: [96, 67],
    weakIntoIds: [51, 119, 21, 202],
    synergizesWithIds: [117, 350, 902, 40],
    recommendedSpells: [7, 4],
    recommendedRunes: precisionPage('Zeri', 8008, 9111, 9104, 8299, 'sorcery'),
    coreItemIds: [3087, 3085, 3031],
    situationalItemIds: [3036, 3033, 3072, 3026, 3139],
    bootItemId: 3006,
  },
  {
    championId: 360,
    key: 'Samira',
    name: 'Samira',
    metaTier: 'A',
    metaScore: 86,
    archetype: 'skirmisher',
    rangeTier: 'short',
    level2Strength: 8,
    damageProfile: 'ad',
    scalingProfile: 'mid',
    preferredSupports: ['engage'],
    strongIntoIds: [222, 523, 67, 202, 22],
    weakIntoIds: [51, 498, 21],
    synergizesWithIds: [111, 526, 12, 89, 497],
    recommendedSpells: [21, 4],
    recommendedRunes: precisionPage('Samira', 8010, 9111, 9104, 8014, 'domination'),
    coreItemIds: [6676, 3031, 3072],
    situationalItemIds: [3036, 3033, 3026, 3139, 6673],
    bootItemId: 3006,
  },
  {
    championId: 96,
    key: 'KogMaw',
    name: "Kog'Maw",
    metaTier: 'B',
    metaScore: 80,
    archetype: 'hypercarry',
    rangeTier: 'long',
    level2Strength: 3,
    damageProfile: 'hybrid',
    scalingProfile: 'late',
    preferredSupports: ['enchanter'],
    strongIntoIds: [523, 221],
    weakIntoIds: [119, 360, 51, 236, 21],
    synergizesWithIds: [117, 902, 350, 40, 16],
    recommendedSpells: [7, 4],
    recommendedRunes: precisionPage("Kog'Maw", 8008, 9111, 9104, 8299, 'sorcery'),
    coreItemIds: [3153, 3124, 3302],
    situationalItemIds: [3085, 3036, 3033, 3026, 3139],
    bootItemId: 3006,
  },
  {
    championId: 29,
    key: 'Twitch',
    name: 'Twitch',
    metaTier: 'B',
    metaScore: 82,
    archetype: 'hypercarry',
    rangeTier: 'medium',
    level2Strength: 4,
    damageProfile: 'ad',
    scalingProfile: 'late',
    preferredSupports: ['enchanter', 'catcher'],
    strongIntoIds: [523, 96, 221],
    weakIntoIds: [119, 51, 236, 21],
    synergizesWithIds: [117, 350, 902, 40],
    recommendedSpells: [7, 4],
    recommendedRunes: precisionPage('Twitch', 8008, 8009, 9104, 8017, 'domination'),
    coreItemIds: [3032, 3085, 3031],
    situationalItemIds: [3036, 3033, 3072, 3026, 3139],
    bootItemId: 3006,
  },
  {
    championId: 901,
    key: 'Smolder',
    name: 'Smolder',
    metaTier: 'A',
    metaScore: 85,
    archetype: 'hypercarry',
    rangeTier: 'medium',
    level2Strength: 4,
    damageProfile: 'ad',
    scalingProfile: 'late',
    preferredSupports: ['enchanter', 'poke'],
    strongIntoIds: [96, 523],
    weakIntoIds: [119, 236, 360, 51],
    synergizesWithIds: [117, 902, 201, 43],
    recommendedSpells: [7, 4],
    recommendedRunes: firstStrikePage('Smolder'),
    coreItemIds: [3508, 6675, 3031],
    situationalItemIds: [3036, 3033, 3072, 3026, 3140, 3161],
    bootItemId: 3158,
  },
  {
    championId: 42,
    key: 'Corki',
    name: 'Corki',
    metaTier: 'B',
    metaScore: 79,
    archetype: 'caster_poke',
    rangeTier: 'medium',
    level2Strength: 5,
    damageProfile: 'hybrid',
    scalingProfile: 'mid',
    preferredSupports: ['poke', 'enchanter'],
    strongIntoIds: [96, 523, 202],
    weakIntoIds: [119, 360, 236],
    synergizesWithIds: [43, 99, 147],
    recommendedSpells: [7, 4],
    recommendedRunes: precisionPage('Corki', 8021, 9111, 9105, 8014, 'sorcery'),
    coreItemIds: [3078, 6675, 3031],
    situationalItemIds: [3036, 3033, 3072, 3026, 3140],
    bootItemId: 3006,
  },
  {
    championId: 804,
    key: 'Yunara',
    name: 'Yunara',
    metaTier: 'A',
    metaScore: 87,
    archetype: 'hypercarry',
    rangeTier: 'medium',
    level2Strength: 5,
    damageProfile: 'ad',
    scalingProfile: 'late',
    preferredSupports: ['enchanter', 'engage'],
    strongIntoIds: [96, 523, 222],
    weakIntoIds: [119, 51, 360],
    synergizesWithIds: [117, 902, 267, 412],
    recommendedSpells: [7, 4],
    recommendedRunes: precisionPage('Yunara', 8008, 9111, 9104, 8014, 'resolve'),
    coreItemIds: [3153, 3124, 3302],
    situationalItemIds: [6672, 3036, 3033, 3026, 3139, 3085],
    bootItemId: 3006,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const normalizeName = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const ADC_BY_ID: ReadonlyMap<number, AdcChampionProfile> = new Map(
  ADC_CHAMPIONS.map((c) => [c.championId, c])
);

export function findAdcChampionById(championId: number): AdcChampionProfile | undefined {
  return ADC_BY_ID.get(championId);
}

/** Matches display name or Data Dragon key, ignoring case/punctuation ("Kai'Sa", "kaisa", "Miss Fortune"). */
export function findAdcChampionByName(name: string): AdcChampionProfile | undefined {
  const normalized = normalizeName(name);
  if (!normalized) return undefined;
  return ADC_CHAMPIONS.find(
    (c) => normalizeName(c.name) === normalized || normalizeName(c.key) === normalized
  );
}

export function findSupportArchetype(championId: number): SupportArchetypeEntry | undefined {
  return SUPPORT_ARCHETYPES[championId];
}

export function resolveAdcItem(itemId: number): ItemMetadata | undefined {
  return ADC_ITEM_CATALOG[itemId];
}

export function getAdcSupportComboNote(adcId: number, supportId: number): string | undefined {
  return ADC_SUPPORT_COMBO_NOTES[`${adcId}:${supportId}`];
}
