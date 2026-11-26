import { JUNGLE_CHAMPIONS, getChampionMeta } from '../data/jungleKnowledgePack';
import type {
  ChampSelectRecommendation,
  HighEloMetaSnapshot,
  TeamCompAnalysis,
} from '../types/coaching';
import type { ChampSelectPlayerSlot, LcuChampSelectSession } from '../types/riot';

/**
 * Enforces Riot Ranked Solo/Duo anonymity rules:
 * non-local, non-party slots must NEVER display real summoner names.
 */
export function sanitizeChampSelectSession(
  session: LcuChampSelectSession
): LcuChampSelectSession {
  const maskSlot = (
    slot: ChampSelectPlayerSlot,
    index: number,
    prefix: 'Ally' | 'Enemy'
  ): ChampSelectPlayerSlot => {
    const keepRealName =
      !session.isRankedSoloDuo || slot.isLocalPlayer || slot.isPartyMember;
    return {
      ...slot,
      displayName: keepRealName ? slot.displayName : `${prefix} ${index + 1}`,
    };
  };

  return {
    ...session,
    myTeam: session.myTeam.map((slot, idx) => maskSlot(slot, idx, 'Ally')),
    theirTeam: session.theirTeam.map((slot, idx) => maskSlot(slot, idx, 'Enemy')),
  };
}

export function analyzeTeamComposition(championIds: number[]): TeamCompAnalysis {
  const picked = championIds.filter((id) => id > 0).map(getChampionMeta);

  let adScore = 0;
  let apScore = 0;
  let engageScore = 0;
  let ccScore = 0;
  let frontlineScore = 0;
  let earlyPower = 0;
  let latePower = 0;

  for (const champ of picked) {
    if (champ.damageProfile === 'ad') adScore += 2;
    else if (champ.damageProfile === 'ap') apScore += 2;
    else if (champ.damageProfile === 'hybrid') {
      adScore += 1;
      apScore += 1;
    } else {
      frontlineScore += 1;
    }

    engageScore += champ.engageScore;
    ccScore += champ.hardCcScore;
    frontlineScore += champ.frontlineScore;

    if (champ.powerSpike === 'early') earlyPower += 2;
    else if (champ.powerSpike === 'mid') {
      earlyPower += 1;
      latePower += 1;
    } else {
      latePower += 2;
    }
  }

  const count = Math.max(picked.length, 1);
  const avgEngage = Math.round((engageScore / count) * 10) / 10;
  const avgCc = Math.round((ccScore / count) * 10) / 10;
  const avgFrontline = Math.round((frontlineScore / count) * 10) / 10;

  const gaps: string[] = [];
  const strengths: string[] = [];

  if (picked.length >= 2 && apScore === 0) gaps.push('Needs AP threat (full AD risk)');
  if (picked.length >= 2 && adScore === 0) gaps.push('Needs AD threat (full AP risk)');
  if (picked.length >= 2 && frontlineScore < 10) gaps.push('Lacks reliable frontline');
  if (picked.length >= 2 && engageScore < 11) gaps.push('Lacks primary engage');
  if (picked.length >= 2 && ccScore < 10) gaps.push('Low hard crowd control');

  if (apScore >= 2 && adScore >= 2) strengths.push('Balanced AD/AP damage split');
  if (engageScore >= 22) strengths.push('Strong teamfight engage');
  if (ccScore >= 22) strengths.push('High pick & lockdown CC');
  if (frontlineScore >= 20) strengths.push('Durable frontline');
  if (earlyPower > latePower + 1) strengths.push('Early skirmish priority');
  if (latePower > earlyPower + 1) strengths.push('High late-game scaling');

  let archetype: TeamCompAnalysis['archetype'] = 'Skirmish & Split-Push';
  if (frontlineScore >= 22 && engageScore >= 22) {
    archetype = 'Front-to-Back Teamfight';
  } else if (engageScore >= 20 && latePower <= earlyPower + 1) {
    archetype = 'Dive & Pick';
  } else if (earlyPower >= latePower + 2) {
    archetype = 'Early Snowball';
  } else if (latePower >= earlyPower + 2) {
    archetype = 'Scaling Siege / Control';
  }

  return {
    adScore,
    apScore,
    engageScore: avgEngage,
    ccScore: avgCc,
    frontlineScore: avgFrontline,
    earlyPower,
    latePower,
    archetype,
    gaps,
    strengths,
  };
}

export interface RecommendJungleInput {
  allyChampionIds: number[];
  enemyChampionIds: number[];
  bannedChampionIds: number[];
  enemyJunglerId?: number;
  masteryChampionIds?: number[];
  highEloMeta?: HighEloMetaSnapshot | null;
}

export function inferEnemyJunglerId(
  slots: ChampSelectPlayerSlot[]
): number | undefined {
  const byPos = slots.find(
    (s) => s.assignedPosition === 'jungle' && s.championId > 0
  );
  if (byPos) return byPos.championId;
  const bySmite = slots.find(
    (s) => (s.spell1Id === 11 || s.spell2Id === 11) && s.championId > 0
  );
  if (bySmite) return bySmite.championId;

  // In Ranked Solo/Duo, Riot hides enemy roles and spells during Champ Select.
  // If a single picked enemy champion belongs to our primary jungle pool, infer them.
  const junglePoolIds = new Set(JUNGLE_CHAMPIONS.map((c) => c.championId));
  const candidates = slots.filter(
    (s) => s.championId > 0 && junglePoolIds.has(s.championId)
  );
  return candidates.length === 1 ? candidates[0]?.championId : undefined;
}

export function recommendJunglePicks(
  input: RecommendJungleInput
): ChampSelectRecommendation[] {
  const unavailable = new Set<number>([
    ...input.allyChampionIds.filter((id) => id > 0),
    ...input.enemyChampionIds.filter((id) => id > 0),
    ...input.bannedChampionIds.filter((id) => id > 0),
  ]);

  const allyTeamWithoutPlayer = input.allyChampionIds.filter((id) => id > 0);
  const allyAnalysis = analyzeTeamComposition(allyTeamWithoutPlayer);
  const enemyAnalysis = analyzeTeamComposition(input.enemyChampionIds);
  const masterySet = new Set(input.masteryChampionIds ?? []);

  const needsAp = allyAnalysis.apScore === 0 && allyTeamWithoutPlayer.length >= 1;
  const needsAd = allyAnalysis.adScore === 0 && allyTeamWithoutPlayer.length >= 1;
  const needsFrontline = allyAnalysis.gaps.some((g) => g.includes('frontline'));
  const needsEngage = allyAnalysis.gaps.some((g) => g.includes('engage'));
  const needsCc = allyAnalysis.gaps.some((g) => g.includes('crowd control'));

  const recommendations: ChampSelectRecommendation[] = [];

  for (const jungler of JUNGLE_CHAMPIONS) {
    if (unavailable.has(jungler.championId)) continue;

    const reasons: string[] = [];
    const warnings: string[] = [];

    // 1. Meta Tier baseline (0..35) + optional High-Elo Match-V5 sample blend (-5..+5)
    let metaPoints = Math.max(0, Math.min(35, Math.round(((jungler.metaScore - 75) / 25) * 35)));
    const highEloStat = input.highEloMeta?.champions.find(
      (c) => c.championId === jungler.championId && c.games >= 2
    );
    if (highEloStat) {
      const delta = Math.max(-5, Math.min(5, Math.round((highEloStat.winRate - 50) / 4)));
      metaPoints = Math.max(0, Math.min(40, metaPoints + delta));
      reasons.push(
        `High-Elo Sample: ${highEloStat.winRate.toFixed(0)}% WR (${highEloStat.games} Challenger/GM games)`
      );
    }

    // 2. Team Need Fit (0..32)
    let teamNeedPoints = 10;
    if (needsAp && jungler.damageProfile === 'ap') {
      teamNeedPoints += 12;
      reasons.push('Balances full-AD draft with strong AP damage');
    } else if (needsAd && jungler.damageProfile === 'ad') {
      teamNeedPoints += 12;
      reasons.push('Balances AP-heavy allies with reliable AD damage');
    } else if (
      allyAnalysis.apScore >= 4 &&
      jungler.damageProfile === 'ap' &&
      allyAnalysis.adScore === 0
    ) {
      teamNeedPoints -= 6;
      warnings.push('Adds more AP to an already AP-heavy comp');
    }

    if (needsFrontline && jungler.frontlineScore >= 7) {
      teamNeedPoints += 7;
      reasons.push('Supplies badly needed frontline durability');
    }
    if (needsEngage && jungler.engageScore >= 8) {
      teamNeedPoints += 6;
      reasons.push('Provides primary teamfight engage');
    }
    if (needsCc && jungler.hardCcScore >= 7) {
      teamNeedPoints += 5;
      reasons.push('Covers missing hard CC for ganks & picks');
    }
    if (
      enemyAnalysis.frontlineScore >= 7 &&
      (jungler.championId === 876 || jungler.championId === 203 || jungler.championId === 141)
    ) {
      teamNeedPoints += 5;
      reasons.push('Shreds tanky enemy frontlines effectively');
    }

    // 3. Enemy Jungle Matchup (0..18)
    let matchupPoints = 9;
    if (input.enemyJunglerId && input.enemyJunglerId > 0) {
      if (jungler.strongIntoIds.includes(input.enemyJunglerId)) {
        matchupPoints = 18;
        reasons.push('Favorable jungle matchup & tempo edge');
      } else if (jungler.weakIntoIds.includes(input.enemyJunglerId)) {
        matchupPoints = 2;
        warnings.push('Unfavorable 1v1 jungle matchup early');
      }
    }

    // 4. Ally Synergy (0..10)
    let synergyPoints = 3;
    const matchedSynergies = allyTeamWithoutPlayer.filter((id) =>
      jungler.synergizesWithIds.includes(id)
    );
    if (matchedSynergies.length > 0) {
      synergyPoints = Math.min(10, 4 + matchedSynergies.length * 3);
      reasons.push(`Strong combo synergy with ${matchedSynergies.length} ally pick(s)`);
    }

    // 5. Personal Mastery Bonus (0..8)
    const masteryPoints = masterySet.has(jungler.championId) ? 8 : 0;
    if (masteryPoints > 0) {
      reasons.push('Matches one of your highest-mastery junglers');
    }

    if (reasons.length === 0) {
      reasons.push(`${jungler.metaTier}-tier meta reliability & consistent clear`);
    }

    const totalScore = Math.max(
      0,
      Math.min(100, metaPoints + teamNeedPoints + matchupPoints + synergyPoints + masteryPoints)
    );

    recommendations.push({
      champion: jungler,
      totalScore,
      breakdown: {
        meta: metaPoints,
        teamNeed: teamNeedPoints,
        matchup: matchupPoints,
        synergy: synergyPoints,
        mastery: masteryPoints,
      },
      reasons,
      warnings,
    });
  }

  return recommendations.sort((a, b) => b.totalScore - a.totalScore).slice(0, 5);
}
