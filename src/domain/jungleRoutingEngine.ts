import type {
  JungleChampionProfile,
  JungleRoute,
  JungleRouteStep,
  ObjectiveWindow,
  WardSpot,
} from '../types/coaching';
import type { MapSide } from '../types/riot';

/**
 * Exact official Riot Summoner's Rift (map11.png) coordinates converted from
 * Riot API [0..14870, 0..14980] (bottom-left origin) into SVG [0..1000] (top-left origin).
 */
export const RIFT_NODES = {
  blue: {
    krugs: { x: 565, y: 833 },
    red: { x: 525, y: 726 },
    raptors: { x: 467, y: 640 },
    wolves: { x: 256, y: 569 },
    blue: { x: 256, y: 473 },
    gromp: { x: 141, y: 439 },
    gankTop: { x: 135, y: 155 },
    gankBot: { x: 845, y: 865 },
  },
  red: {
    gromp: { x: 854, y: 576 },
    blue: { x: 740, y: 536 },
    wolves: { x: 736, y: 439 },
    raptors: { x: 525, y: 362 },
    red: { x: 471, y: 272 },
    krugs: { x: 430, y: 166 },
    gankTop: { x: 145, y: 145 },
    gankBot: { x: 865, y: 850 },
  },
  river: {
    topScuttle: { x: 296, y: 359 },
    botScuttle: { x: 706, y: 655 },
    baronGrubs: { x: 337, y: 301 },
    dragon: { x: 663, y: 705 },
  },
} as const;

function makeStep(
  order: number,
  campId: string,
  campName: string,
  pos: { x: number; y: number },
  targetTime: string,
  note: string
): JungleRouteStep {
  return { order, campId, campName, x: pos.x, y: pos.y, targetTime, note };
}

export interface PickFirstClearInput {
  champion?: JungleChampionProfile;
  strongSide: 'top' | 'bot' | 'mid';
  strongLanePriority?: number;
  invadeRisk?: 'low' | 'medium' | 'high';
}

export interface FirstClearDecision {
  style: 'full_clear' | 'three_camp_gank';
  reason: string;
}

/**
 * Selects strictly ONE recommended opening clear style based on champion identity,
 * strong-side lane priority, and enemy jungle invade threat.
 */
export function pickFirstClear(input: PickFirstClearInput): FirstClearDecision {
  const champ = input.champion;
  let score = 0;

  if (champ?.preferredFirstClear === 'three_camp_gank') score += 2;
  if (champ?.powerSpike === 'early') score += 1;
  if ((input.strongLanePriority ?? 6) >= 8) score += 2;
  else if ((input.strongLanePriority ?? 6) === 7) score += 1;

  if (champ?.clearSpeed === 'fast' && champ?.preferredFirstClear === 'full_clear') score -= 2;
  if (champ?.powerSpike === 'late') score -= 1;
  if (input.invadeRisk === 'high') score -= 2;
  if (input.strongSide === 'mid') score -= 1;

  if (score >= 3 && input.strongSide !== 'mid') {
    const laneWord = input.strongSide === 'bot' ? 'Bot' : 'Top';
    return {
      style: 'three_camp_gank',
      reason: `Fast Level 3 gank toward ${laneWord} exploits high lane volatility 45s before enemy full-clear finishes.`,
    };
  }

  return {
    style: 'full_clear',
    reason:
      'Unlocks Level 4 + 1st item component on recall. Path toward your strong side to reach 2:55 Scuttle with priority.',
  };
}

export function buildObjectiveSyncRoute(
  side: MapSide,
  focus: 'dragon' | 'grubs'
): JungleRoute {
  const isBlue = side === 'blue';
  const own = isBlue ? RIFT_NODES.blue : RIFT_NODES.red;

  if (focus === 'dragon') {
    return {
      id: `${side}-clear3-dragon`,
      clearNumber: 3,
      shortLabel: 'Clear 3',
      descriptor: 'Dragon Sync · Top → Bot',
      label: 'Clear 3 · Dragon Sync (Top → Bot)',
      side,
      stage: 'objective_sync',
      stageLabel: 'Clear 3 · Dragon',
      objectiveFocus: 'dragon',
      timeWindow: '8:00 – 19:45',
      whyThisClear:
        'Start Top camps ~65s before Dragon so your clear ends Bot-side with full HP and spent gold right on spawn.',
      style: 'full_clear',
      summary:
        'Clear Top quadrant -> Bot quadrant -> Dragon Pit to arrive 30s early without dropping camp XP.',
      steps: [
        makeStep(1, 'd-1', isBlue ? 'Gromp' : 'Krugs', isBlue ? own.gromp : own.krugs, '-65s', 'Clear Top-side camp while Dragon is 1m out'),
        makeStep(2, 'd-2', isBlue ? 'Wolves' : 'Raptors', isBlue ? own.wolves : own.raptors, '-48s', 'Transition downward toward Mid'),
        makeStep(3, 'd-3', isBlue ? 'Raptors' : 'Wolves', isBlue ? own.raptors : own.wolves, '-30s', 'Ping Bot/Mid to shove waves'),
        makeStep(4, 'd-4', isBlue ? 'Red Buff' : 'Blue Buff', isBlue ? own.red : own.blue, '-15s', 'Secure buff combat stats for river fight'),
        makeStep(5, 'd-pit', 'Dragon Pit', RIFT_NODES.river.dragon, 'Spawn', 'Place Control Ward & secure Dragon'),
      ],
    };
  }

  return {
    id: `${side}-clear3-grubs`,
    clearNumber: 3,
    shortLabel: 'Clear 3',
    descriptor: 'Grubs / Herald Sync · Bot → Top',
    label: 'Clear 3 · Grubs / Herald Sync (Bot → Top)',
    side,
    stage: 'objective_sync',
    stageLabel: 'Clear 3 · Top Obj',
    objectiveFocus: 'grubs',
    timeWindow: '8:00 – 19:45',
    whyThisClear:
      'Flip Bot → Top before Voidgrubs or Rift Herald so you finish camps next to Top River with lane priority.',
    style: 'full_clear',
    summary: 'Sequence Bot camps into Top camps -> sweep Baron/Grubs pit and take Top objective.',
    steps: [
      makeStep(1, 'g-1', isBlue ? 'Krugs' : 'Gromp', isBlue ? own.krugs : own.gromp, '-65s', 'Clear Bot-side outer camp first'),
      makeStep(2, 'g-2', isBlue ? 'Raptors' : 'Wolves', isBlue ? own.raptors : own.wolves, '-48s', 'Move upward across Mid'),
      makeStep(3, 'g-3', isBlue ? 'Wolves' : 'Raptors', isBlue ? own.wolves : own.raptors, '-30s', 'Check Top/Mid wave push'),
      makeStep(4, 'g-4', isBlue ? 'Blue Buff' : 'Red Buff', isBlue ? own.blue : own.red, '-15s', 'Grab buff before contesting river'),
      makeStep(5, 'g-pit', 'Grubs / Herald Pit', RIFT_NODES.river.baronGrubs, 'Spawn', 'Sweep & secure Grubs/Herald'),
    ],
  };
}

/**
 * Generates strictly ONE route per clear number (Clear 1 through Clear 4):
 * 1) Opening Clear (1:30–3:30)
 * 2) Second Clear / Cleanup Sequence (follows from Clear 1 style)
 * 3) Objective-Synced Clear (Dragon or Grubs/Herald)
 * 4) Mid/Late Baron & Cross-Map Control (14:00+)
 */
export function buildMultiClearRoutes(
  side: MapSide,
  strongSide: 'top' | 'bot' | 'mid',
  preferredFirstClear: 'full_clear' | 'three_camp_gank' = 'full_clear',
  customFirstReason?: string
): JungleRoute[] {
  const isBlue = side === 'blue';
  const own = isBlue ? RIFT_NODES.blue : RIFT_NODES.red;
  const opp = isBlue ? RIFT_NODES.red : RIFT_NODES.blue;

  const botToTopFullSteps: JungleRouteStep[] = isBlue
    ? [
        makeStep(1, 'b-red', 'Red Buff', own.red, '0:55', 'Kite toward Krugs on final autos'),
        makeStep(2, 'b-krugs', 'Krugs', own.krugs, '1:19', 'Clear large + medium Krug first'),
        makeStep(3, 'b-raptors', 'Raptors', own.raptors, '1:41', 'AoE small raptors while glancing Mid'),
        makeStep(4, 'b-wolves', 'Wolves', own.wolves, '2:05', 'Hit Level 3; check Top/Mid wave'),
        makeStep(5, 'b-blue', 'Blue Buff', own.blue, '2:27', 'Pull Blue toward Gromp'),
        makeStep(6, 'b-gromp', 'Gromp', own.gromp, '2:47', 'Save 1 Smite charge for 2:55 Scuttle'),
        makeStep(7, 't-crab', 'Top Scuttle', RIFT_NODES.river.topScuttle, '2:55', 'Secure Crab -> gank Top/Mid or recall'),
      ]
    : [
        makeStep(1, 'r-blue', 'Blue Buff', own.blue, '0:55', 'Kite Blue toward Gromp'),
        makeStep(2, 'r-gromp', 'Gromp', own.gromp, '1:19', 'Finish Gromp cleanly'),
        makeStep(3, 'r-wolves', 'Wolves', own.wolves, '1:43', 'Transition across Mid safely'),
        makeStep(4, 'r-raptors', 'Raptors', own.raptors, '2:05', 'Scan Top wave state while clearing'),
        makeStep(5, 'r-red', 'Red Buff', own.red, '2:27', 'Keep Smite ready for Scuttle'),
        makeStep(6, 'r-krugs', 'Krugs', own.krugs, '2:47', 'Hit Level 4'),
        makeStep(7, 't-crab', 'Top Scuttle', RIFT_NODES.river.topScuttle, '2:55', 'Take Crab -> Top/Mid play or reset'),
      ];

  const topToBotFullSteps: JungleRouteStep[] = isBlue
    ? [
        makeStep(1, 'b-blue', 'Blue Buff', own.blue, '0:55', 'Start Blue, pull toward Gromp'),
        makeStep(2, 'b-gromp', 'Gromp', own.gromp, '1:19', 'Use 1st Smite or save for Bot Crab'),
        makeStep(3, 'b-wolves', 'Wolves', own.wolves, '1:43', 'Cross Mid into Red quadrant'),
        makeStep(4, 'b-raptors', 'Raptors', own.raptors, '2:05', 'Check Bot lane wave position'),
        makeStep(5, 'b-red', 'Red Buff', own.red, '2:27', 'Pull Red toward Krugs'),
        makeStep(6, 'b-krugs', 'Krugs', own.krugs, '2:47', 'Hit Level 4 & kite toward river'),
        makeStep(7, 'b-crab', 'Bot Scuttle', RIFT_NODES.river.botScuttle, '2:55', 'Secure Bot Crab & pressure Bot lane'),
      ]
    : [
        makeStep(1, 'r-red', 'Red Buff', own.red, '0:55', 'Start Red, drag toward Krugs'),
        makeStep(2, 'r-krugs', 'Krugs', own.krugs, '1:19', 'Clear Krugs fast'),
        makeStep(3, 'r-raptors', 'Raptors', own.raptors, '1:43', 'Watch Mid prio before crossing'),
        makeStep(4, 'r-wolves', 'Wolves', own.wolves, '2:07', 'Enter Bot quadrant'),
        makeStep(5, 'r-blue', 'Blue Buff', own.blue, '2:29', 'Kite Blue toward Gromp'),
        makeStep(6, 'r-gromp', 'Gromp', own.gromp, '2:47', 'Hit Level 4 with Smite ready'),
        makeStep(7, 'b-crab', 'Bot Scuttle', RIFT_NODES.river.botScuttle, '2:55', 'Take Bot Crab -> gank Bot or recall'),
      ];

  const dirLabel =
    strongSide === 'bot' ? 'Top → Bot' : strongSide === 'mid' ? 'Bot → Top (Mid Focus)' : 'Bot → Top';

  const clear1Full: JungleRoute = {
    id: `${side}-clear1-full`,
    clearNumber: 1,
    shortLabel: 'Clear 1',
    descriptor: `Full Clear · ${dirLabel}`,
    label: `Clear 1 · Full Clear (${dirLabel})`,
    side,
    stage: 'clear_1',
    stageLabel: 'Clear 1 · Opening',
    timeWindow: '0:55 – 2:55',
    whyThisClear:
      customFirstReason ??
      'Unlocks Level 4 + 1st item component on recall. Path toward your strong side so you arrive at 2:55 Scuttle with winning lane priority.',
    style: 'full_clear',
    summary:
      strongSide === 'bot'
        ? 'Path Top → Bot across all 6 camps to arrive Level 4 near Dragon & Bot lane at 2:55.'
        : 'Path Bot → Top across all 6 camps to arrive Level 4 near Voidgrubs & Top/Mid at 2:55.',
    steps: strongSide === 'bot' ? topToBotFullSteps : botToTopFullSteps,
  };

  const clear1ThreeCamp: JungleRoute = {
    id: `${side}-clear1-3camp`,
    clearNumber: 1,
    shortLabel: 'Clear 1',
    descriptor: `3-Camp Lv3 Gank · ${strongSide === 'bot' ? 'Bot' : strongSide === 'mid' ? 'Mid/Top' : 'Top'}`,
    label: `Clear 1 · 3-Camp ${strongSide === 'bot' ? 'Bot' : strongSide === 'mid' ? 'Mid/Top' : 'Top'} Gank`,
    side,
    stage: 'clear_1',
    stageLabel: 'Clear 1 · Fast Lv3',
    timeWindow: '0:55 – 2:10',
    whyThisClear:
      customFirstReason ??
      'Use when your strong side is volatile and you are an early-ganking jungler; strike 45s before enemy full-clear finishes.',
    style: 'three_camp_gank',
    summary: 'Double-buff + 1 camp for Level 3 gank/invade at 2:10 before enemy hits Level 4.',
    steps:
      strongSide === 'bot'
        ? [
            makeStep(1, '3c-1', isBlue ? 'Blue Buff' : 'Red Buff', isBlue ? own.blue : own.red, '0:55', 'Fast leashless start'),
            makeStep(2, '3c-2', isBlue ? 'Gromp' : 'Krugs', isBlue ? own.gromp : own.krugs, '1:17', 'Smite for clear tempo'),
            makeStep(3, '3c-3', isBlue ? 'Red Buff' : 'Blue Buff', isBlue ? own.red : own.blue, '1:51', 'Hit Level 3 + Red slow'),
            makeStep(4, '3c-gank', 'Gank / Dive Bot', own.gankBot, '2:10', 'Punish extended Bot or invade enemy buff'),
          ]
        : isBlue
          ? [
              makeStep(1, '3c-1', 'Red Buff', own.red, '0:55', 'Fast opening buff'),
              makeStep(2, '3c-2', 'Blue Buff', own.blue, '1:30', 'Cross directly to Top quadrant buff'),
              makeStep(3, '3c-3', 'Gromp', own.gromp, '1:53', 'Hit Level 3 adjacent to Top lane'),
              makeStep(4, '3c-gank', 'Gank Top / Invade', own.gankTop, '2:10', 'Gank extended Top or catch enemy jungler'),
            ]
          : [
              makeStep(1, '3c-1', 'Red Buff', own.red, '0:55', 'Fast Top-side opening buff'),
              makeStep(2, '3c-2', 'Raptors', own.raptors, '1:17', 'Fast AoE clear while checking Mid'),
              makeStep(3, '3c-3', 'Krugs', own.krugs, '1:43', 'Hit Level 3 adjacent to Top lane (no cross-map backtrack)'),
              makeStep(4, '3c-gank', 'Gank Top / Invade', own.gankTop, '2:10', 'Gank extended Top or invade Blue quadrant'),
            ],
  };

  // Clear 2 follows from Clear 1 style
  const clear2Route: JungleRoute =
    preferredFirstClear === 'three_camp_gank'
      ? {
          id: `${side}-clear2-cleanup`,
          clearNumber: 2,
          shortLabel: 'Clear 2',
          descriptor: 'Cleanup & Scuttle Sweep · Catch Remaining Camps',
          label: 'Clear 2 · Cleanup Remaining Camps (Lv 4–5)',
          side,
          stage: 'clear_2',
          stageLabel: 'Clear 2 · Cleanup',
          timeWindow: '2:30 – 4:10',
          whyThisClear:
            'After a 3-camp gank, immediately harvest the three untouched minor camps and Scuttle so you avoid falling behind enemy Level 5–6.',
          style: 'full_clear',
          summary:
            'Take River Scuttle after your gank, clear your skipped quadrant camps, then recall cleanly before buff respawns.',
          steps:
            strongSide === 'bot'
              ? [
                  makeStep(1, 'c2t-crab', 'Bot Scuttle', RIFT_NODES.river.botScuttle, '2:55', 'Grab Bot Scuttle if wave allows'),
                  makeStep(2, 'c2t-1', isBlue ? 'Krugs' : 'Gromp', isBlue ? own.krugs : own.gromp, '3:10', 'Clear untouched outer minor camp'),
                  makeStep(3, 'c2t-2', isBlue ? 'Raptors' : 'Wolves', isBlue ? own.raptors : own.wolves, '3:30', 'Harvest AoE camp gold & XP'),
                  makeStep(4, 'c2t-3', isBlue ? 'Wolves' : 'Raptors', isBlue ? own.wolves : own.raptors, '3:50', 'Finish skipped camps before recall'),
                ]
              : [
                  makeStep(1, 'c2t-crab', 'Top Scuttle', RIFT_NODES.river.topScuttle, '2:55', 'Contest Top Crab with lane prio'),
                  makeStep(2, 'c2t-1', isBlue ? 'Wolves' : 'Blue Buff', isBlue ? own.wolves : own.blue, '3:13', 'Collect untouched quadrant camps'),
                  makeStep(3, 'c2t-2', isBlue ? 'Raptors' : 'Wolves', isBlue ? own.raptors : own.wolves, '3:35', 'Catch XP back up cleanly'),
                  makeStep(4, 'c2t-3', isBlue ? 'Krugs' : 'Gromp', isBlue ? own.krugs : own.gromp, '3:55', 'Recall with component + Control Ward'),
                ],
        }
      : {
          id: `${side}-clear2-respawn`,
          clearNumber: 2,
          shortLabel: 'Clear 2',
          descriptor: 'Respawn Sequence · Lv 5–6 Spike',
          label: 'Clear 2 · Respawn Sequence (Lv 5–6)',
          side,
          stage: 'clear_2',
          stageLabel: 'Clear 2 · Respawn',
          timeWindow: '3:40 – 5:10',
          whyThisClear:
            'Minor camps respawn ~2:15 after death in the exact order you cleared them. Repeat your Clear 1 starting side after recalling so camps spawn right as you walk up.',
          style: 'full_clear',
          summary:
            'Recall at 3:10–3:25, buy boots/components + Control Ward, then sweep back through your respawning quadrants to hit Level 5–6.',
          steps:
            strongSide === 'bot'
              ? [
                  makeStep(1, 'c2-1', isBlue ? 'Gromp' : 'Krugs', isBlue ? own.gromp : own.krugs, '3:40', 'First minor camp respawns right after recall'),
                  makeStep(2, 'c2-2', isBlue ? 'Wolves' : 'Raptors', isBlue ? own.wolves : own.raptors, '4:00', 'Keep camps synced on respawn timer'),
                  makeStep(3, 'c2-3', isBlue ? 'Raptors' : 'Wolves', isBlue ? own.raptors : own.wolves, '4:20', 'Look Mid transition gank if wave is pushed'),
                  makeStep(4, 'c2-4', isBlue ? 'Krugs' : 'Gromp', isBlue ? own.krugs : own.gromp, '4:40', 'Finish quadrant for Level 5–6'),
                  makeStep(5, 'c2-obj', 'Dragon Prep', RIFT_NODES.river.dragon, '4:50', 'Drop Control Ward & contest 5:00 Dragon'),
                ]
              : [
                  makeStep(1, 'c2-1', isBlue ? 'Krugs' : 'Gromp', isBlue ? own.krugs : own.gromp, '3:40', 'First minor camp respawns right after recall'),
                  makeStep(2, 'c2-2', isBlue ? 'Raptors' : 'Wolves', isBlue ? own.raptors : own.wolves, '4:00', 'Maintain tight camp sequencing'),
                  makeStep(3, 'c2-3', isBlue ? 'Wolves' : 'Raptors', isBlue ? own.wolves : own.raptors, '4:20', 'Hover Mid/Top if enemy overextends'),
                  makeStep(4, 'c2-4', isBlue ? 'Gromp' : 'Krugs', isBlue ? own.gromp : own.krugs, '4:40', 'Hit Level 5–6 ahead of objective rotation'),
                  makeStep(5, 'c2-obj', 'Dragon / Top Setup', RIFT_NODES.river.dragon, '4:50', 'Reset, sweep river & prepare 5:00 Dragon'),
                ],
        };

  // Clear 3: single default objective sync based on strong side (live mode swaps via buildObjectiveSyncRoute)
  const clear3Route = buildObjectiveSyncRoute(side, strongSide === 'top' ? 'grubs' : 'dragon');

  // Clear 4+: Late Baron & Cross-Map Invade (15:00+ / 20:00+ Baron)
  const clear4Baron: JungleRoute = {
    id: `${side}-clear4-baron`,
    clearNumber: 4,
    shortLabel: 'Clear 4',
    descriptor: 'Baron & Cross-Map Control',
    label: 'Clear 4+ · Baron / Cross-Map Invade',
    side,
    stage: 'late_baron',
    stageLabel: 'Clear 4 · Mid/Late',
    objectiveFocus: 'baron',
    timeWindow: '15:00+',
    whyThisClear:
      'In mid/late game, stop full-clearing diagonally from base. Farm the quadrant beside the next major objective (Baron or Soul) and steal opposite camps.',
    style: 'invade',
    summary:
      'Keep Top-side camps cleared around Baron, drop deep enemy-quadrant wards, and counter-jungle whenever enemy shows Bot.',
    steps: [
      makeStep(1, 'l-1', isBlue ? 'Blue Buff' : 'Red Buff', isBlue ? own.blue : own.red, 'Cycle', 'Clear objective-side buff & camps'),
      makeStep(2, 'l-2', 'Baron River', RIFT_NODES.river.baronGrubs, 'Setup', 'Sweep Baron pit & place Control Ward'),
      makeStep(3, 'l-3', 'Invade Top Quad', isBlue ? opp.red : opp.blue, 'If Bot', 'Steal enemy camp if enemy jungler shows Bot'),
      makeStep(4, 'l-4', 'Invade Raptors/Wolves', isBlue ? opp.raptors : opp.wolves, 'Vision', 'Drop deep ward before resetting'),
    ],
  };

  return [
    preferredFirstClear === 'three_camp_gank' ? clear1ThreeCamp : clear1Full,
    clear2Route,
    clear3Route,
    clear4Baron,
  ];
}

/**
 * Calibrated Season 2026 ward coordinates aligned to Summoner's Rift (`map11.png`) bushes.
 */
export function buildOfficialWardSpots(side: MapSide): WardSpot[] {
  const isBlue = side === 'blue';
  return [
    {
      id: 'early-raptor-ward',
      label: 'Enemy Raptor Brush Ward',
      kind: 'deep',
      phase: 'early',
      x: isBlue ? 530 : 470,
      y: isBlue ? 385 : 615,
      timing: '0:45 – 0:55 (recall for Oracle Lens)',
      reason:
        'Spots enemy jungler on Raptors before 0:55 camp spawn so you track whether they path Top or Bot.',
    },
    {
      id: 'pixel-river-ward',
      label: 'Top Pixel River Brush',
      kind: 'stealth',
      phase: 'early',
      x: 432,
      y: 432,
      timing: '2:15 or 2:55 Scuttle check',
      reason: 'Covers Mid roams and early river transitions into your top quadrant.',
    },
    {
      id: 'dragon-pit-control',
      label: 'Dragon River Control Ward',
      kind: 'control',
      phase: 'objective',
      x: 622,
      y: 658,
      timing: '4:15 (45s before Dragon spawn)',
      reason:
        'Denies river entrance vision outside Dragon pit so you can sneak Dragon or trap face-checks.',
    },
    {
      id: 'baron-pit-control',
      label: 'Baron / Grubs River Control Ward',
      kind: 'control',
      phase: 'objective',
      x: 378,
      y: 342,
      timing: '7:15 / 14:15 (45s before Grubs / Herald / Baron)',
      reason:
        'Denies top river entrance vision and catches enemy support/jungler clearing pit.',
    },
    {
      id: 'deep-quad-intersection',
      label: 'Deep Enemy Quadrant Intersection',
      kind: 'deep',
      phase: 'mid_late',
      x: isBlue ? 725 : 275,
      y: isBlue ? 515 : 485,
      timing: 'After taking enemy Tier-1 tower',
      reason:
        'Spots enemy jungler leaving base or taking Blue/Gromp so side laners can push safely.',
    },
  ];
}

/**
 * Dynamically selects the right jungle clear route for the current live match clock
 * and upcoming neutral objective.
 */
export function selectLiveActiveRoute(
  gameTime: number,
  objectives: ObjectiveWindow[],
  routes: JungleRoute[]
): JungleRoute {
  if (gameTime < 200) {
    return routes.find((r) => r.stage === 'clear_1') ?? routes[0]!;
  }
  if (gameTime < 325) {
    return routes.find((r) => r.stage === 'clear_2') ?? routes[0]!;
  }

  const nextObj = objectives[0];
  const side: MapSide = routes[0]?.side ?? 'blue';
  if (gameTime < 900) {
    const desiredFocus: 'dragon' | 'grubs' = nextObj?.id === 'dragon' ? 'dragon' : 'grubs';
    const matching = routes.find(
      (r) => r.stage === 'objective_sync' && r.objectiveFocus === desiredFocus
    );
    return matching ?? buildObjectiveSyncRoute(side, desiredFocus);
  }

  if (nextObj?.id === 'dragon' && nextObj.secondsRemaining <= 95) {
    const matching = routes.find(
      (r) => r.stage === 'objective_sync' && r.objectiveFocus === 'dragon'
    );
    return matching ?? buildObjectiveSyncRoute(side, 'dragon');
  }

  return routes.find((r) => r.stage === 'late_baron') ?? routes[0]!;
}
