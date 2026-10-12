import { useEffect, useState } from 'react';
import { isCapacitorNative } from '../utils/platform.js';

/**
 * true once mounted inside the Capacitor (Android) app. False during SSR and the first client render so the server HTML and the
 * hydrated tree match; the native-only differences (no pricing, no purchase / subscription text — Google Play payments policy)
 * apply right after mount. The tier itself always comes from the server, so existing Pro entitlements keep working.
 */
export function useNative() {
  const [native, setNative] = useState(false);
  useEffect(() => { setNative(isCapacitorNative()); }, []);
  return native;
}
