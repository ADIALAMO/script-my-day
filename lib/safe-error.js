/**
 * Reduces any thrown error to { cls, http } — the error CLASS name and the HTTP status, nothing else. Never the message: AWS SDK messages
 * can embed bucket and object names. Used by the quarantine paths so a failure can be reported without leaking keys or bucket names.
 */
export function safeErrInfo(e) {
  const rawName = typeof e?.name === 'string' ? e.name : '';
  let cls = /^[A-Za-z][A-Za-z0-9_.]{0,59}$/.test(rawName) ? rawName : 'Error';
  // getS3() throws a plain Error("<VAR> not configured.") when an env var is missing; label it without echoing the message.
  if (cls === 'Error' && /not configured/i.test(String(e?.message))) cls = 'ConfigMissing';
  const s = Number(e?.$metadata?.httpStatusCode ?? e?.status);
  return { cls, http: Number.isInteger(s) && s >= 100 && s <= 599 ? s : null };
}

/** "class=AccessDenied http=403" (http omitted when unknown) */
export const formatSafeErr = ({ cls, http }) => `class=${cls}${http ? ` http=${http}` : ''}`;
