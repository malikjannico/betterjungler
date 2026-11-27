import { afterEach, describe, expect, it } from 'vitest';
import { hydrateDdragonCatalog } from '../data/jungleKnowledgePack';
import { formatChampionName } from './championNames';

describe('championNames', () => {
  afterEach(() => {
    hydrateDdragonCatalog({ patch: '16.23.1', championsById: {}, itemsById: {} });
  });

  it('normalizes Riot internal champion keys such as MonkeyKing to canonical display names', () => {
    expect(formatChampionName('MonkeyKing')).toBe('Wukong');
    expect(formatChampionName('monkeyking')).toBe('Wukong');
    expect(formatChampionName('Khazix')).toBe("Kha'Zix");
    expect(formatChampionName('FiddleSticks')).toBe('Fiddlesticks');
    expect(formatChampionName('Belveth')).toBe("Bel'Veth");
    expect(formatChampionName('RekSai')).toBe("Rek'Sai");
    expect(formatChampionName('MissFortune')).toBe('Miss Fortune');
    expect(formatChampionName('JarvanIV')).toBe('Jarvan IV');
    expect(formatChampionName('KSante')).toBe("K'Sante");
    expect(formatChampionName('DrMundo')).toBe('Dr. Mundo');
    expect(formatChampionName('Nunu')).toBe('Nunu & Willump');
  });

  it('prefers hydrated Data Dragon catalog by championId when available and splits unknown PascalCase', () => {
    hydrateDdragonCatalog({
      patch: '16.23.1',
      championsById: {
        62: { id: 62, key: 'MonkeyKing', name: 'Wukong', tags: ['Fighter', 'Tank'] },
      },
      itemsById: {},
    });

    expect(formatChampionName('MonkeyKing', 62)).toBe('Wukong');
    expect(formatChampionName('CustomChamp')).toBe('Custom Champ');
    expect(formatChampionName('')).toBe('Unknown');
  });
});
