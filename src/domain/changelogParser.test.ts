import { describe, expect, it } from 'vitest';
import { parseChangelog } from './changelogParser';

describe('changelogParser', () => {
  it('parses Keep-a-Changelog entries, dates, sections, and bullets cleanly', () => {
    const sample = `# Changelog

## [0.2.0] - 2026-11-27

### Added
- **Auto-Updater**: Safe idle updates.
- Changelog viewer in Settings.

### Fixed
- Dropped poll debouncing.

## [0.1.0] - 2026-11-26

### Added
- Initial foundation.
`;

    const entries = parseChangelog(sample);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      version: '0.2.0',
      date: '2026-11-27',
      sections: [
        {
          title: 'Added',
          items: ['Auto-Updater: Safe idle updates.', 'Changelog viewer in Settings.'],
        },
        {
          title: 'Fixed',
          items: ['Dropped poll debouncing.'],
        },
      ],
    });
    expect(entries[1]?.version).toBe('0.1.0');
  });
});
