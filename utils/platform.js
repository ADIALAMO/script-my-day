import { Capacitor } from '@capacitor/core';

/**
 * True inside the Capacitor Android/iOS shell.
 *
 * Single source of truth for this check — several places need it for
 * different reasons (AuthModal's relay flow, hiding purchase/pricing CTAs
 * per the mobile-wrapper plan's billing decision) and duplicating the check
 * per-file risks them drifting out of sync.
 */
export function isCapacitorNative() {
  return typeof window !== 'undefined' && Capacitor.isNativePlatform();
}
