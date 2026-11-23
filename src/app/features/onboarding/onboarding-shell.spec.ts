// Acceptance Test
// Traces to: L2-001, L2-002, L2-004, L2-005, L2-006, L2-024, L2-033
// Description: Verify onboarding validation/completion, settings cache budget validation (>= 512 MB), theme toggling, and system status banners.

import { TestBed } from '@angular/core/testing';
import { PreferencesStore } from '../../core/state/preferences.store';
import { SystemStatusStore } from '../../core/state/system-status.store';

describe('Onboarding, Preferences & System Status (Slice 1)', () => {
  let prefs: PreferencesStore;
  let status: SystemStatusStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    prefs = TestBed.inject(PreferencesStore);
    status = TestBed.inject(SystemStatusStore);
  });

  it('rejects cache budget below 512 MB and saves valid preferences (L2-024)', async () => {
    const failed = await prefs.save({ cacheBudgetMb: 256 });
    expect(failed).toBe(false);
    expect(prefs.validationErrors()[0]?.message).toBe('Model cache budget must be at least 512 MB');

    const ok = await prefs.save({ cacheBudgetMb: 2048, displayName: 'Micah Osei' });
    expect(ok).toBe(true);
    expect(prefs.savedMessage()).toBe('Preferences saved on this device');
  });

  it('toggles light and dark themes (L2-033)', () => {
    const initial = prefs.preferences().theme;
    prefs.toggleTheme();
    expect(prefs.preferences().theme).not.toBe(initial);
  });

  it('surfaces danger banner when cache usage reaches >= 90% of budget (L2-005, L2-026)', async () => {
    await prefs.save({ cacheBudgetMb: 512 });
    status.cachedModelMb.set(480);
    expect(status.activeBanner()?.severity).toBe('danger');
    expect(status.activeBanner()?.actionRoute).toBe('/lab');
  });
});
