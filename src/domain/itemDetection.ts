import type { LiveItem } from '../types/riot';

/**
 * Tier-2 and Season 2026 Tier-3 Feats of Strength upgraded boots.
 * Covers standard 6 inventory slots (`0..5`) AND Season 2026 Bot Lane Role Quest
 * 7th dedicated boot slot (`slot > 6`, excluding trinket `slot === 6`).
 */
export const TIER2_OR_3_BOOT_ITEM_IDS: ReadonlySet<number> = new Set([
  3006, // Berserker's Greaves
  3009, // Boots of Swiftness
  3010, // Symbiotic Soles
  3013, // Synchronized Souls
  3020, // Sorcerer's Shoes
  3047, // Plated Steelcaps
  3111, // Mercury's Treads
  3158, // Ionian Boots of Lucidity
  // Season 2026 Tier-3 Feats of Strength upgrades
  3170, // Swiftmarch
  3171, // Crimson Lucidity
  3172, // Gunmetal Greaves
  3173, // Chainlaced Crushers
  3174, // Armored Advance
  3175, // Spellslinger's Shoes
  3176, // Forever Forward
]);

export const ALL_BOOT_ITEM_IDS: ReadonlySet<number> = new Set([
  1001, // Boots
  2422, // Slightly Magical Footwear
  ...TIER2_OR_3_BOOT_ITEM_IDS,
]);

const COMPLETED_BOOT_NAME_RE =
  /\b(greaves|treads|steelcaps|swiftness|lucidity|sorcerer'?s shoes|symbiotic|synchronized|swiftmarch|crimson lucidity|gunmetal|chainlaced|armored advance|spellslinger|forever forward)\b/i;

const ANY_BOOT_NAME_RE =
  /\b(boots|magical footwear|greaves|treads|steelcaps|swiftness|lucidity|sorcerer'?s shoes|symbiotic|synchronized|swiftmarch|gunmetal|chainlaced|armored advance|spellslinger|forever forward)\b/i;

/**
 * Returns all non-trinket items (`slot !== 6`), including the Season 2026 Bot Lane
 * Role Quest 7th boot slot (`slot === 7` or `slot > 6`).
 */
export function getNonTrinketItems(items: readonly LiveItem[] | undefined | null): LiveItem[] {
  if (!items || items.length === 0) return [];
  return items.filter((item) => item.slot !== 6);
}

export function isBootItem(item: Pick<LiveItem, 'itemID' | 'displayName'>): boolean {
  return ALL_BOOT_ITEM_IDS.has(item.itemID) || ANY_BOOT_NAME_RE.test(item.displayName ?? '');
}

export function isCompletedBootItem(item: Pick<LiveItem, 'itemID' | 'displayName'>): boolean {
  return (
    TIER2_OR_3_BOOT_ITEM_IDS.has(item.itemID) ||
    COMPLETED_BOOT_NAME_RE.test(item.displayName ?? '')
  );
}

/** True when player owns completed Tier-2 or Tier-3 boots in ANY non-trinket slot (incl. 7th slot). */
export function hasCompletedBoots(items: readonly LiveItem[] | undefined | null): boolean {
  return getNonTrinketItems(items).some(isCompletedBootItem);
}

/** Returns the first boot item found across all non-trinket slots, if any. */
export function findOwnedBootItem(items: readonly LiveItem[] | undefined | null): LiveItem | undefined {
  const nonTrinket = getNonTrinketItems(items);
  return nonTrinket.find(isCompletedBootItem) ?? nonTrinket.find(isBootItem);
}
