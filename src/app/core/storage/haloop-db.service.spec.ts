// Acceptance Test
// Traces to: L2-026, L2-028, L2-031
// Description: Verify local storage persistence and strict input validators for display name, reflection notes, cache budget, and device labels.

import { TestBed } from '@angular/core/testing';
import { HaloopDbService } from './haloop-db.service';
import {
  validateCacheBudgetMb,
  validateDeviceLabel,
  validateDisplayName,
  validateReflectionNote,
} from '../security/sanitize';

describe('HaloopDbService and Input Validators', () => {
  let db: HaloopDbService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    db = TestBed.inject(HaloopDbService);
  });

  it('persists and reads structured records locally', async () => {
    await db.set('profile', { displayName: 'Micah Osei', focus: 'StrengthMobility' });
    const loaded = await db.get<{ displayName: string; focus: string }>('profile');
    expect(loaded?.displayName).toBe('Micah Osei');
    expect(loaded?.focus).toBe('StrengthMobility');
  });

  it('rejects blank display names and accepts valid names (L2-002, L2-028)', () => {
    expect(validateDisplayName('   ')).not.toBeNull();
    expect(validateDisplayName('Micah Osei')).toBeNull();
  });

  it('rejects reflection notes longer than 280 characters (L2-011)', () => {
    expect(validateReflectionNote('a'.repeat(280))).toBeNull();
    expect(validateReflectionNote('a'.repeat(281))).toContain('280 characters');
  });

  it('rejects model cache budget below 512 MB (L2-024, L2-031)', () => {
    expect(validateCacheBudgetMb(256)).toBe('Model cache budget must be at least 512 MB');
    expect(validateCacheBudgetMb(2048)).toBeNull();
  });

  it('rejects blank Bluetooth device labels (L2-019)', () => {
    expect(validateDeviceLabel('')).not.toBeNull();
    expect(validateDeviceLabel('Wahoo TICKR Fit')).toBeNull();
  });
});
