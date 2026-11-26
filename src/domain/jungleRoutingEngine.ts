import type {
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

/**
 * Generates multi-clear jungle routes covering:
 * 1) Opening Clear (1:30-3:30)
 * 2) Respawn Sequence Clear 2 (4:15-5:45) - explains repeating starting quadrant order
 * 3) Objective-Synced Clears (6:00-14:00) - Dragon vs Voidgrubs/Herald
 * 4) Mid/Late Baron & Cross-Map Control (14:00+)
 */
export function buildMultiClearRoutes(
  side: MapSide,
  strongSide: 'top' | 'bot' | 'mid',
  preferredFirstClear: 'full_clear' | 'three_camp_gank' = 'full_clear'
): JungleRoute[] {
  const isBlue = side === 'blue';
  const own = isBlue ? RIFT_NODES.blue : RIFT_NODES.red;
  const opp = isBlue ? RIFT_NODES.red : RIFT_NODES.blue;

  const botToTopFullSteps: JungleRouteStep[] = isBlue
    ? [
        makeStep(1, 'b-red', 'Red Buff', own.red, '1:30', 'Kite toward Krugs on final autos'),
        makeStep(2, 'b-krugs', 'Krugs', own.krugs, '1:54', 'Clear large + medium Krug first'),
        makeStep(3, 'b-raptors', 'Raptors', own.raptors, '2:16', 'AoE small raptors while glancing Mid'),
        makeStep(4, 'b-wolves', 'Wolves', own.wolves, '2:40', 'Hit Level 3; check Top/Mid wave'),
        makeStep(5, 'b-blue', 'Blue Buff', own.blue, '3:02', 'Pull Blue toward Gromp'),
        makeStep(6, 'b-gromp', 'Gromp', own.gromp, '3:22', 'Save 1 Smite charge for 3:30 Scuttle'),
        makeStep(7, 't-crab', 'Top Scuttle', RIFT_NODES.river.topScuttle, '3:30', 'Secure Crab -> gank Top/Mid or recall'),
      ]
    : [
        makeStep(1, 'r-blue', 'Blue Buff', own.blue, '1:30', 'Kite Blue toward Gromp'),
        makeStep(2, 'r-gromp', 'Gromp', own.gromp, '1:54', 'Finish Gromp cleanly'),
        makeStep(3, 'r-wolves', 'Wolves', own.wolves, '2:18', 'Transition across Mid safely'),
        makeStep(4, 'r-raptors', 'Raptors', own.raptors, '2:40', 'Scan Top wave state while clearing'),
        makeStep(5, 'r-red', 'Red Buff', own.red, '3:02', 'Keep Smite ready for Scuttle'),
        makeStep(6, 'r-krugs', 'Krugs', own.krugs, '3:22', 'Hit Level 4'),
        makeStep(7, 't-crab', 'Top Scuttle', RIFT_NODES.river.topScuttle, '3:30', 'Take Crab -> Top/Mid play or reset'),
      ];

  const topToBotFullSteps: JungleRouteStep[] = isBlue
    ? [
        makeStep(1, 'b-blue', 'Blue Buff', own.blue, '1:30', 'Start Blue, pull toward Gromp'),
        makeStep(2, 'b-gromp', 'Gromp', own.gromp, '1:54', 'Use 1st Smite or save for Bot Crab'),
        makeStep(3, 'b-wolves', 'Wolves', own.wolves, '2:18', 'Cross Mid into Red quadrant'),
        makeStep(4, 'b-raptors', 'Raptors', own.raptors, '2:40', 'Check Bot lane wave position'),
        makeStep(5, 'b-red', 'Red Buff', own.red, '3:02', 'Pull Red toward Krugs'),
        makeStep(6, 'b-krugs', 'Krugs', own.krugs, '3:22', 'Hit Level 4 & kite toward river'),
        makeStep(7, 'b-crab', 'Bot Scuttle', RIFT_NODES.river.botScuttle, '3:30', 'Secure Bot Crab & pressure Bot lane'),
      ]
    : [
        makeStep(1, 'r-red', 'Red Buff', own.red, '1:30', 'Start Red, drag toward Krugs'),
        makeStep(2, 'r-krugs', 'Krugs', own.krugs, '1:54', 'Clear Krugs fast'),
        makeStep(3, 'r-raptors', 'Raptors', own.raptors, '2:18', 'Watch Mid prio before crossing'),
        makeStep(4, 'r-wolves', 'Wolves', own.wolves, '2:42', 'Enter Bot quadrant'),
        makeStep(5, 'r-blue', 'Blue Buff', own.blue, '3:04', 'Kite Blue toward Gromp'),
        makeStep(6, 'r-gromp', 'Gromp', own.gromp, '3:22', 'Hit Level 4 with Smite ready'),
        makeStep(7, 'b-crab', 'Bot Scuttle', RIFT_NODES.river.botScuttle, '3:30', 'Take Bot Crab -> gank Bot or recall'),
      ];

  const clear1Full: JungleRoute = {
    id: `${side}-clear1-full`,
    label: `Clear 1 · Full Clear (${strongSide === 'bot' ? 'Top → Bot' : strongSide === 'mid' ? 'Bot → Top (Mid Focus)' : 'Bot → Top'})`,
    side,
    stage: 'clear_1',
    stageLabel: 'Clear 1 · Opening',
    timeWindow: '1:30 – 3:30',
    whyThisClear:
      'Unlocks Level 4 + 1st item component on recall. Path toward your strong side so you arrive at 3:30 Scuttle with winning lane priority.',
    style: 'full_clear',
    summary:
      strongSide === 'bot'
        ? 'Path Top → Bot across all 6 camps to arrive Level 4 near Dragon & Bot lane at 3:30.'
        : 'Path Bot → Top across all 6 camps to arrive Level 4 near Voidgrubs & Top/Mid at 3:30.',
    steps: strongSide === 'bot' ? topToBotFullSteps : botToTopFullSteps,
  };

  const clear1ThreeCamp: JungleRoute = {
    id: `${side}-clear1-3camp`,
    label: `Clear 1 · 3-Camp ${strongSide === 'bot' ? 'Bot' : strongSide === 'mid' ? 'Mid/Top' : 'Top'} Gank`,
    side,
    stage: 'clear_1',
    stageLabel: 'Clear 1 · Fast Lv3',
    timeWindow: '1:30 – 2:45',
    whyThisClear:
      'Use when your strong side is volatile and you are an early-ganking jungler; strike 45s before enemy full-clear finishes.',
    style: 'three_camp_gank',
    summary: 'Double-buff + 1 camp for Level 3 gank/invade at 2:45 before enemy hits Level 4.',
    steps:
      strongSide === 'bot'
        ? [
            makeStep(1, '3c-1', isBlue ? 'Blue Buff' : 'Red Buff', isBlue ? own.blue : own.red, '1:30', 'Fast leashless start'),
            makeStep(2, '3c-2', isBlue ? 'Gromp' : 'Krugs', isBlue ? own.gromp : own.krugs, '1:52', 'Smite for clear tempo'),
            makeStep(3, '3c-3', isBlue ? 'Red Buff' : 'Blue Buff', isBlue ? own.red : own.blue, '2:26', 'Hit Level 3 + Red slow'),
            makeStep(4, '3c-gank', 'Gank / Dive Bot', own.gankBot, '2:45', 'Punish extended Bot or invade enemy buff'),
          ]
        : isBlue
          ? [
              makeStep(1, '3c-1', 'Red Buff', own.red, '1:30', 'Fast opening buff'),
              makeStep(2, '3c-2', 'Blue Buff', own.blue, '2:05', 'Cross directly to Top quadrant buff'),
              makeStep(3, '3c-3', 'Gromp', own.gromp, '2:28', 'Hit Level 3 adjacent to Top lane'),
              makeStep(4, '3c-gank', 'Gank Top / Invade', own.gankTop, '2:45', 'Gank extended Top or catch enemy jungler'),
            ]
          : [
              makeStep(1, '3c-1', 'Red Buff', own.red, '1:30', 'Fast Top-side opening buff'),
              makeStep(2, '3c-2', 'Raptors', own.raptors, '1:52', 'Fast AoE clear while checking Mid'),
              makeStep(3, '3c-3', 'Krugs', own.krugs, '2:18', 'Hit Level 3 adjacent to Top lane (no cross-map backtrack)'),
              makeStep(4, '3c-gank', 'Gank Top / Invade', own.gankTop, '2:45', 'Gank extended Top or invade Blue quadrant'),
            ],
  };

  // Clear 2: Repeat starting quadrant order (minor camps respawn ~2:15 after kill!)
  const clear2Repeat: JungleRoute = {
    id: `${side}-clear2-respawn`,
    label: 'Clear 2 · Respawn Sequence (Lv 5–6)',
    side,
    stage: 'clear_2',
    stageLabel: 'Clear 2 · Respawn',
    timeWindow: '4:15 – 5:45',
    whyThisClear:
      'Minor camps respawn ~2:15 after death in the exact order you cleared them. Repeat your Clear 1 starting side after recalling so camps spawn right as you walk up — no wasted walking.',
    style: 'full_clear',
    summary:
      'Recall at 3:45–4:00, buy boots/components + Control Ward, then sweep back through your respawning quadrants to hit Level 5–6 for 1st Dragon/Grubs.',
    steps:
      strongSide === 'bot'
        ? [
            makeStep(1, 'c2-1', isBlue ? 'Gromp' : 'Krugs', isBlue ? own.gromp : own.krugs, '4:15', 'First minor camp respawns right after recall'),
            makeStep(2, 'c2-2', isBlue ? 'Wolves' : 'Raptors', isBlue ? own.wolves : own.raptors, '4:35', 'Keep camps synced on respawn timer'),
            makeStep(3, 'c2-3', isBlue ? 'Raptors' : 'Wolves', isBlue ? own.raptors : own.wolves, '4:55', 'Look Mid transition gank if wave is pushed'),
            makeStep(4, 'c2-4', isBlue ? 'Krugs' : 'Gromp', isBlue ? own.krugs : own.gromp, '5:15', 'Finish quadrant for Level 5–6'),
            makeStep(5, 'c2-obj', 'Dragon Prep', RIFT_NODES.river.dragon, '5:30', 'Drop Control Ward & contest 1st Dragon'),
          ]
        : [
            makeStep(1, 'c2-1', isBlue ? 'Krugs' : 'Gromp', isBlue ? own.krugs : own.gromp, '4:15', 'First minor camp respawns right after recall'),
            makeStep(2, 'c2-2', isBlue ? 'Raptors' : 'Wolves', isBlue ? own.raptors : own.wolves, '4:35', 'Maintain tight camp sequencing'),
            makeStep(3, 'c2-3', isBlue ? 'Wolves' : 'Raptors', isBlue ? own.wolves : own.raptors, '4:55', 'Hover Mid/Top if enemy overextends'),
            makeStep(4, 'c2-4', isBlue ? 'Gromp' : 'Krugs', isBlue ? own.gromp : own.krugs, '5:15', 'Hit Level 5–6 before Grubs spawn'),
            makeStep(5, 'c2-obj', 'Voidgrubs Setup', RIFT_NODES.river.baronGrubs, '5:50', 'Sweep pit & take 6:00 Voidgrubs'),
          ],
  };

  // Clear 3a: Dragon Objective Sync (6:00 - 14:00)
  const clear3Dragon: JungleRoute = {
    id: `${side}-clear3-dragon`,
    label: 'Clear 3 · Dragon Sync (Top → Bot)',
    side,
    stage: 'objective_sync',
    stageLabel: 'Clear 3 · Dragon',
    timeWindow: '6:00 – 14:00',
    whyThisClear:
      'Do NOT blindly repeat the same route if Dragon is spawning! Start Top-side camps 60s before Dragon so your clear naturally ends Bot-side with full HP and spent gold.',
    style: 'full_clear',
    summary:
      'Clear Top quadrant -> Bot quadrant -> Dragon Pit so you arrive 30s before spawn without losing camp XP.',
    steps: [
      makeStep(1, 'd-1', isBlue ? 'Gromp' : 'Krugs', isBlue ? own.gromp : own.krugs, '-65s', 'Clear Top-side camp while Dragon is 1m out'),
      makeStep(2, 'd-2', isBlue ? 'Wolves' : 'Raptors', isBlue ? own.wolves : own.raptors, '-48s', 'Transition downward toward Mid'),
      makeStep(3, 'd-3', isBlue ? 'Raptors' : 'Wolves', isBlue ? own.raptors : own.wolves, '-30s', 'Ping Bot/Mid to shove waves'),
      makeStep(4, 'd-4', isBlue ? 'Red Buff' : 'Blue Buff', isBlue ? own.red : own.blue, '-15s', 'Secure buff combat stats for river fight'),
      makeStep(5, 'd-pit', 'Dragon Pit', RIFT_NODES.river.dragon, 'Spawn', 'Place Control Ward & secure Dragon'),
    ],
  };

  // Clear 3b: Grubs / Herald Objective Sync (6:00 - 14:00)
  const clear3Grubs: JungleRoute = {
    id: `${side}-clear3-grubs`,
    label: 'Clear 3 · Grubs / Herald Sync (Bot → Top)',
    side,
    stage: 'objective_sync',
    stageLabel: 'Clear 3 · Top Obj',
    timeWindow: '6:00 – 14:00',
    whyThisClear:
      'When Voidgrubs or Rift Herald is your priority, flip your clear Bot → Top so you end adjacent to Top River with Top/Mid priority.',
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

  // Clear 4+: Late Baron & Cross-Map Invade (14:00+)
  const clear4Baron: JungleRoute = {
    id: `${side}-clear4-baron`,
    label: 'Clear 4+ · Baron / Cross-Map Invade',
    side,
    stage: 'late_baron',
    stageLabel: 'Clear 4+ · Mid/Late',
    timeWindow: '14:00+',
    whyThisClear:
      'In mid/late game, stop full-clearing diagonally from base. Farm the quadrant beside the next major objective (Baron or Soul) and steal enemy camps opposite their jungler.',
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

  return preferredFirstClear === 'three_camp_gank'
    ? [clear1ThreeCamp, clear1Full, clear2Repeat, clear3Dragon, clear3Grubs, clear4Baron]
    : [clear1Full, clear1ThreeCamp, clear2Repeat, clear3Dragon, clear3Grubs, clear4Baron];
}

/**
 * Exact ward coordinates aligned to Summoner's Rift (map11.png) bushes.
 */
export function buildOfficialWardSpots(side: MapSide): WardSpot[] {
  const isBlue = side === 'blue';
  return [
    {
      id: 'early-raptor-ward',
      label: 'Enemy Raptor Brush Ward',
      kind: 'deep',
      phase: 'early',
      x: isBlue ? 525 : 467,
      y: isBlue ? 385 : 615,
      timing: '1:10 – 1:25 (recall for Oracle Lens)',
      reason:
        'Spots enemy jungler on Raptors so your team knows immediately whether they are pathing Top or Bot.',
    },
    {
      id: 'pixel-river-ward',
      label: 'Top Pixel River Brush',
      kind: 'stealth',
      phase: 'early',
      x: 342,
      y: 422,
      timing: '1:20 or 3:15 river check',
      reason:
        'Covers Mid roams and early river transitions into your top quadrant.',
    },
    {
      id: 'dragon-pit-control',
      label: 'Dragon River Control Ward',
      kind: 'control',
      phase: 'objective',
      x: 598,
      y: 742,
      timing: '45s before Dragon spawn',
      reason:
        'Denies river entrance vision outside Dragon pit so you can sneak Dragon or trap face-checks.',
    },
    {
      id: 'baron-pit-control',
      label: 'Baron / Grubs River Control Ward',
      kind: 'control',
      phase: 'objective',
      x: 396,
      y: 262,
      timing: '45s before Grubs / Herald / Baron',
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
  if (gameTime < 235) {
    return routes.find((r) => r.stage === 'clear_1') ?? routes[0]!;
  }
  if (gameTime < 360) {
    return routes.find((r) => r.stage === 'clear_2') ?? routes[0]!;
  }

  const nextObj = objectives[0];
  if (gameTime < 900) {
    if (nextObj?.id === 'dragon') {
      return (
        routes.find((r) => r.id.includes('clear3-dragon')) ??
        routes.find((r) => r.stage === 'objective_sync') ??
        routes[0]!
      );
    }
    return (
      routes.find((r) => r.id.includes('clear3-grubs')) ??
      routes.find((r) => r.stage === 'objective_sync') ??
      routes[0]!
    );
  }

  if (nextObj?.id === 'dragon' && nextObj.secondsRemaining <= 95) {
    return routes.find((r) => r.id.includes('clear3-dragon')) ?? routes[0]!;
  }

  return routes.find((r) => r.stage === 'late_baron') ?? routes[0]!;
}
