// Input validation and text normalization utilities (L2-028).

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function validateDisplayName(value: string): string | null {
  const clean = normalizeText(value);
  if (clean.length === 0) {
    return 'Enter your first name so Coach can greet you.';
  }
  if (clean.length > 80) {
    return 'Display name must be 80 characters or fewer.';
  }
  return null;
}

export function validateReflectionNote(value: string): string | null {
  if (value.length > 280) {
    return `Keep your reflection note under 280 characters (currently ${value.length}).`;
  }
  return null;
}

export function validateCacheBudgetMb(value: number): string | null {
  if (!Number.isFinite(value) || value < 512) {
    return 'Model cache budget must be at least 512 MB';
  }
  if (value > 16384) {
    return 'Model cache budget must be 16384 MB or less';
  }
  return null;
}

export function validateDeviceLabel(value: string): string | null {
  const clean = normalizeText(value);
  if (clean.length === 0) {
    return 'Enter a label for this Bluetooth sensor.';
  }
  if (clean.length > 60) {
    return 'Device label must be 60 characters or fewer.';
  }
  return null;
}
