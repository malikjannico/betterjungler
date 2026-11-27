function normalizeCommaThousands(text: string): string {
  return text.replace(/\u2212/g, '-').replace(/(?<=\d),(\d{3})(?!\d)/g, '$1');
}

type UnitKind =
  | 'none'
  | 'percent'
  | 'thousand'
  | 'gold'
  | 'minutes'
  | 'seconds'
  | 'cs'
  | 'combat_count'
  | 'ward';

interface GroundedFacts {
  structuredJson: boolean;
  exactTokens: Set<string>;
  allFloats: number[];
  goldFloats: number[];
  percentFloats: number[];
  csFloats: number[];
  combatFloats: number[];
  wardFloats: number[];
  timeSec: Set<number>;
  timeMin: Set<number>;
}

function isGoldKey(keyLower: string): boolean {
  return keyLower.includes('gold') || keyLower.includes('bounty');
}

function isPercentKey(keyLower: string): boolean {
  return (
    keyLower.includes('pct') ||
    keyLower.includes('percent') ||
    keyLower.includes('share') ||
    keyLower.includes('winrate')
  );
}

function isCsKey(keyLower: string): boolean {
  return !isPercentKey(keyLower) && (keyLower.includes('cs') || keyLower.includes('creep'));
}

function isCombatKey(keyLower: string): boolean {
  return (
    !isPercentKey(keyLower) &&
    (keyLower.includes('kill') ||
      keyLower.includes('death') ||
      keyLower.includes('assist') ||
      keyLower.includes('kda'))
  );
}

function isWardKey(keyLower: string): boolean {
  return !isPercentKey(keyLower) && (keyLower.includes('ward') || keyLower.includes('vision'));
}

function isTimeSecKey(keyLower: string): boolean {
  return keyLower.includes('sec') || keyLower.includes('duration') || keyLower.includes('spawn');
}

function extractKeyMinutes(keyLower: string, facts: GroundedFacts) {
  for (const m of keyLower.matchAll(/at(\d{1,2})(?!\d)/g)) {
    const mins = Number(m[1]);
    if (Number.isInteger(mins)) facts.timeMin.add(mins);
  }
}

function parseHmsSeconds(token: string): number | null {
  const parts = token.split(':');
  if (parts.some((p) => !/^\d+$/.test(p))) return null;
  if (parts.length === 2) {
    const m = Number(parts[0]);
    const s = Number(parts[1]);
    if (!Number.isInteger(m) || !Number.isInteger(s) || m < 0 || s < 0 || s > 59) return null;
    return m * 60 + s;
  }
  if (parts.length === 3) {
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const s = Number(parts[2]);
    if (
      !Number.isInteger(h) ||
      !Number.isInteger(m) ||
      !Number.isInteger(s) ||
      h < 0 ||
      m < 0 ||
      m > 59 ||
      s < 0 ||
      s > 59
    ) {
      return null;
    }
    return h * 3600 + m * 60 + s;
  }
  return null;
}

function classifyUnitWord(lower: string, allowSingleLetter: boolean): UnitKind {
  if (allowSingleLetter) {
    if (lower === 'k') return 'thousand';
    if (lower === 'g') return 'gold';
    if (lower === 'm') return 'minutes';
    if (lower === 's') return 'seconds';
  }
  if (lower === 'gold') return 'gold';
  if (lower === 'min' || lower === 'mins' || lower === 'minute' || lower === 'minutes') {
    return 'minutes';
  }
  if (lower === 'sec' || lower === 'secs' || lower === 'second' || lower === 'seconds') {
    return 'seconds';
  }
  if (lower === 'cs') return 'cs';
  if (
    lower === 'kill' ||
    lower === 'kills' ||
    lower === 'death' ||
    lower === 'deaths' ||
    lower === 'assist' ||
    lower === 'assists'
  ) {
    return 'combat_count';
  }
  if (lower === 'ward' || lower === 'wards') return 'ward';
  return 'none';
}

function classifyUnitAt(text: string, afterNum: number): { kind: UnitKind; label: string } {
  if (afterNum < text.length && text[afterNum] === '%') {
    return { kind: 'percent', label: '%' };
  }
  const rest = text.slice(afterNum);
  const w1Match = /^([a-zA-Z]+)/.exec(rest);
  if (w1Match) {
    const w1 = w1Match[1]!;
    const kind = classifyUnitWord(w1.toLowerCase(), true);
    return { kind, label: kind === 'none' ? '' : w1 };
  }

  const w2Match = /^( +)([a-zA-Z]+)/.exec(rest);
  if (w2Match) {
    const w2 = w2Match[2]!;
    const kind = classifyUnitWord(w2.toLowerCase(), false);
    if (kind !== 'none') {
      return { kind, label: ` ${w2}` };
    }
  }
  return { kind: 'none', label: '' };
}

function collectFromString(text: string, keyLower: string, facts: GroundedFacts) {
  const normalized = normalizeCommaThousands(text);
  const matches = normalized.matchAll(/(?<![\w.:])[+-]?\d[\d.:]*/g);
  for (const m of matches) {
    const token = m[0].replace(/[.:]+$/, '');
    if (!token) continue;
    const afterNum = (m.index ?? 0) + token.length;
    const { kind: unitKind } = classifyUnitAt(normalized, afterNum);

    if (token.includes(':')) {
      const total = parseHmsSeconds(token);
      if (total !== null) {
        facts.exactTokens.add(token);
        facts.exactTokens.add(String(total));
        facts.allFloats.push(total);
        facts.timeSec.add(total);
        facts.timeMin.add(Math.floor(total / 60));
        facts.timeMin.add(Math.round(total / 60));
      }
      continue;
    }

    const unsigned = token.replace(/^\+/, '');
    facts.exactTokens.add(unsigned);
    const val = Number(unsigned);
    if (Number.isFinite(val)) {
      facts.allFloats.push(val);
      facts.exactTokens.add(val.toFixed(1));
      facts.exactTokens.add(val.toFixed(2));
      if (isGoldKey(keyLower) || unitKind === 'gold') {
        facts.goldFloats.push(val);
      } else if (unitKind === 'thousand') {
        facts.goldFloats.push(val * 1000);
      }
      if (isPercentKey(keyLower) || unitKind === 'percent') {
        facts.percentFloats.push(val);
      }
      if (isCsKey(keyLower) || unitKind === 'cs') {
        facts.csFloats.push(val);
      }
      if (isCombatKey(keyLower) || unitKind === 'combat_count') {
        facts.combatFloats.push(val);
      }
      if (isWardKey(keyLower) || unitKind === 'ward') {
        facts.wardFloats.push(val);
      }
      if (unitKind === 'minutes') {
        facts.timeMin.add(Math.round(val));
      }
      if (unitKind === 'seconds') {
        const sec = Math.round(val);
        facts.timeSec.add(sec);
        facts.timeMin.add(Math.floor(sec / 60));
      }
    }
  }
}

function collectFromJson(val: unknown, keyLower: string, facts: GroundedFacts) {
  if (typeof val === 'number' && Number.isFinite(val)) {
    facts.exactTokens.add(String(val));
    facts.allFloats.push(val);
    if (isGoldKey(keyLower)) facts.goldFloats.push(val);
    if (isPercentKey(keyLower)) facts.percentFloats.push(val);
    if (isCsKey(keyLower)) facts.csFloats.push(val);
    if (isCombatKey(keyLower)) facts.combatFloats.push(val);
    if (isWardKey(keyLower)) facts.wardFloats.push(val);
    if (Number.isInteger(val)) {
      if (isTimeSecKey(keyLower)) {
        facts.timeSec.add(val);
        facts.timeMin.add(Math.floor(val / 60));
        facts.timeMin.add(Math.round(val / 60));
      }
      if (val >= 60) {
        const mins = Math.floor(val / 60);
        const secs = val % 60;
        facts.exactTokens.add(`${mins}:${String(secs).padStart(2, '0')}`);
      }
    } else {
      facts.exactTokens.add(val.toFixed(1));
      facts.exactTokens.add(val.toFixed(2));
    }
    return;
  }
  if (typeof val === 'string') {
    collectFromString(val, keyLower, facts);
    return;
  }
  if (Array.isArray(val)) {
    for (const item of val) collectFromJson(item, keyLower, facts);
    return;
  }
  if (val && typeof val === 'object') {
    for (const [k, v] of Object.entries(val)) {
      const childLower = k.toLowerCase();
      extractKeyMinutes(childLower, facts);
      collectFromString(k, childLower, facts);
      const combinedHint =
        isGoldKey(childLower) ||
        isPercentKey(childLower) ||
        isCsKey(childLower) ||
        isCombatKey(childLower) ||
        isWardKey(childLower) ||
        isTimeSecKey(childLower) ||
        !keyLower
          ? childLower
          : `${keyLower} ${childLower}`;
      collectFromJson(v, combinedHint, facts);
    }
  }
}

function sameSignOrZero(a: number, b: number): boolean {
  return a === 0 || b === 0 || (a > 0) === (b > 0);
}

function matchesValue(g: number, num: number, explicitSign: boolean, tol: number): boolean {
  if (Math.abs(g - num) <= tol && sameSignOrZero(g, num)) return true;
  return !explicitSign && g < 0 && Math.abs(Math.abs(g) - num) <= tol;
}

function stripListPrefix(line: string): string {
  const trimmed = line.trimStart();
  // Require whitespace or EOL after bullet punctuation so line-leading decimals (e.g. 9.2 CS/min) are never stripped.
  return trimmed.replace(/^[*_`]*\d{1,2}[.)][*_`]*(?=\s|$)\s*/, '');
}

/**
 * Verifies every numeric metric, gold delta, percentage, or timestamp cited by an AI coaching
 * response is grounded in the supplied telemetry JSON context (or safe 1..3 plain prose counts).
 */
export function validateGroundedAiResponse(
  contextJson: string,
  responseText: string
): { valid: boolean; ungroundedTokens: string[] } {
  const facts: GroundedFacts = {
    structuredJson: false,
    exactTokens: new Set<string>(),
    allFloats: [],
    goldFloats: [],
    percentFloats: [],
    csFloats: [],
    combatFloats: [],
    wardFloats: [],
    timeSec: new Set<number>(),
    timeMin: new Set<number>(),
  };

  try {
    const parsed: unknown = JSON.parse(contextJson);
    facts.structuredJson = true;
    collectFromJson(parsed, '', facts);
  } catch {
    collectFromString(contextJson, '', facts);
  }

  const ungrounded: string[] = [];
  for (const line of responseText.split(/\r?\n/)) {
    const body = normalizeCommaThousands(stripListPrefix(line));
    const regex = /(?<![\w.:])[+-]?\d[\d.:]*/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(body)) !== null) {
      const token = match[0].replace(/[.:]+$/, '');
      if (!token) continue;
      const afterNum = match.index + token.length;
      const { kind: unitKind, label: unitLabel } = classifyUnitAt(body, afterNum);

      if (
        !token.includes(':') &&
        !token.includes('.') &&
        !token.startsWith('+') &&
        !token.startsWith('-') &&
        unitKind === 'none'
      ) {
        const n = Number(token);
        if (Number.isInteger(n) && n >= 1 && n <= 3) {
          continue;
        }
      }

      const explicitSign = token.startsWith('+') || token.startsWith('-');
      const lookup = token.replace(/^\+/, '');
      let ok = false;

      if (lookup.includes(':')) {
        const sec = parseHmsSeconds(lookup);
        if (sec !== null) {
          ok =
            facts.exactTokens.has(lookup) ||
            facts.timeSec.has(sec) ||
            facts.timeSec.has(sec - 1) ||
            facts.timeSec.has(sec + 1) ||
            (!facts.structuredJson &&
              (facts.exactTokens.has(String(sec)) ||
                facts.exactTokens.has(String(sec - 1)) ||
                facts.exactTokens.has(String(sec + 1))));
        }
      } else {
        const num = Number(lookup);
        if (Number.isFinite(num)) {
          if (unitKind === 'thousand') {
            const pool = facts.structuredJson ? facts.goldFloats : facts.allFloats;
            const scaled = num * 1000;
            if (token.includes('.')) {
              ok = pool.some((g) => matchesValue(g, scaled, explicitSign, 55));
            } else {
              ok = pool.some(
                (g) =>
                  Math.abs(g) >= 500 &&
                  Math.round(Math.abs(g) / 1000) === Math.abs(num) &&
                  (explicitSign ? sameSignOrZero(g, scaled) : g <= 0 || sameSignOrZero(g, scaled))
              );
            }
          } else if (unitKind === 'gold') {
            const pool = facts.structuredJson ? facts.goldFloats : facts.allFloats;
            ok = pool.some((g) => matchesValue(g, num, explicitSign, 0.05));
          } else if (unitKind === 'percent') {
            const pool = facts.structuredJson ? facts.percentFloats : facts.allFloats;
            if (token.includes('.')) {
              ok = pool.some((g) => matchesValue(g, num, explicitSign, 0.05));
            } else {
              ok = pool.some(
                (g) =>
                  (Math.round(g) === num ||
                    (!explicitSign && g < 0 && Math.round(Math.abs(g)) === num)) &&
                  (explicitSign ? sameSignOrZero(g, num) : sameSignOrZero(g, num) || g < 0)
              );
            }
          } else if (unitKind === 'cs') {
            const pool = facts.structuredJson ? facts.csFloats : facts.allFloats;
            ok = pool.some((g) => matchesValue(g, num, explicitSign, 0.05));
          } else if (unitKind === 'combat_count') {
            const pool = facts.structuredJson ? facts.combatFloats : facts.allFloats;
            ok = pool.some((g) => matchesValue(g, num, explicitSign, 0.05));
          } else if (unitKind === 'ward') {
            const pool = facts.structuredJson ? facts.wardFloats : facts.allFloats;
            ok = pool.some((g) => matchesValue(g, num, explicitSign, 0.05));
          } else if (unitKind === 'minutes') {
            if (!explicitSign && Math.abs(num - Math.round(num)) <= 0.05 && facts.timeMin.has(Math.round(num))) {
              ok = true;
            } else if (!facts.structuredJson) {
              ok = facts.allFloats.some((g) => matchesValue(g, num, explicitSign, 0.05));
            }
          } else if (unitKind === 'seconds') {
            const sec = Math.round(num);
            if (
              !explicitSign &&
              Math.abs(num - sec) <= 0.05 &&
              (facts.timeSec.has(sec) || facts.timeSec.has(sec - 1) || facts.timeSec.has(sec + 1))
            ) {
              ok = true;
            } else if (!facts.structuredJson) {
              ok = facts.allFloats.some((g) => matchesValue(g, num, explicitSign, 0.05));
            }
          } else if (!explicitSign && !token.includes('.') && facts.exactTokens.has(lookup)) {
            ok = true;
          } else {
            ok = facts.allFloats.some((g) => matchesValue(g, num, explicitSign, 0.05));
          }
        }
      }

      if (!ok) {
        ungrounded.push(`${token}${unitLabel}`);
      }
    }
  }

  return {
    valid: ungrounded.length === 0,
    ungroundedTokens: ungrounded,
  };
}
