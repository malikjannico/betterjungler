import type { ChangelogEntry } from '../types/coaching';

/**
 * Lightweight Keep-a-Changelog parser for bundled CHANGELOG.md?raw content.
 * Parses `## [x.y.z] - YYYY-MM-DD`, `### Section`, and `- Item` lines cleanly.
 */
export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let currentEntry: ChangelogEntry | null = null;
  let currentSection: { title: string; items: string[] } | null = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    const versionMatch = line.match(/^##\s+\[([^\]]+)\](?:\s*-\s*(.+))?$/);
    if (versionMatch) {
      currentSection = null;
      currentEntry = {
        version: versionMatch[1]!.trim(),
        date: versionMatch[2]?.trim() ?? '',
        sections: [],
      };
      entries.push(currentEntry);
      continue;
    }

    if (!currentEntry) continue;

    const sectionMatch = line.match(/^###\s+(.+)$/);
    if (sectionMatch) {
      currentSection = { title: sectionMatch[1]!.trim(), items: [] };
      currentEntry.sections.push(currentSection);
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      if (!currentSection) {
        currentSection = { title: 'Highlights', items: [] };
        currentEntry.sections.push(currentSection);
      }
      currentSection.items.push(bulletMatch[1]!.replace(/\*\*/g, '').trim());
    }
  }

  return entries;
}
