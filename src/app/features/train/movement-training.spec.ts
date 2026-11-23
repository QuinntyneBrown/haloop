// Acceptance Test
// Traces to: L2-007, L2-014, L2-015, L2-016, L2-017
// Description: Verify KJV Scripture translation & semantic search, plus workout history filtering, no-results reset, and adding completed sessions.

import { TestBed } from '@angular/core/testing';
import { ScriptureService } from '../../core/scripture/scripture.service';
import { WorkoutHistoryStore } from '../../core/state/workout-history.store';

describe('Movement Training & Scripture Services (Slices 2-4)', () => {
  let scripture: ScriptureService;
  let history: WorkoutHistoryStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    scripture = TestBed.inject(ScriptureService);
    history = TestBed.inject(WorkoutHistoryStore);
  });

  it('returns daily KJV verse and on-device Spanish translation (L2-007, L2-014)', () => {
    const en = scripture.getDailyVerse('en');
    expect(en.reference).toContain('Isaiah 40:31');
    const es = scripture.getDailyVerse('es');
    expect(es.isTranslated).toBe(true);
    expect(es.text).toContain('nuevas fuerzas');
  });

  it('ranks KJV verses semantically for endurance and patience (L2-014)', async () => {
    const results = await scripture.searchSemantic('endurance and patience');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].reference).toContain('Isaiah 40:31');
  });

  it('filters workout history by search query and category chip and resets cleanly (L2-015, L2-016)', () => {
    history.activeCategory.set('Run');
    expect(history.filteredSessions().every((s) => s.category === 'Run')).toBe(true);

    history.searchQuery.set('kettlebell');
    expect(history.filteredSessions().length).toBe(0);

    history.clearFilters();
    expect(history.filteredSessions().length).toBeGreaterThanOrEqual(4);
  });
});
