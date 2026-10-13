/**
 * Reduces any thrown error to { cls, http } — the error CLASS name and the HTTP status, nothing else. Never the message: AWS SDK messages
 * can embed bucket and object names. Used by the quarantine paths so a failure can be reported without leaking keys or bucket names.
 */
// Only these class names are ever printed. An error's `name` can come straight from a response (the AWS SDK uses the S3 error Code), so it is treated as
// untrusted: anything not on this list — however identifier-like — is reported as plain "Error". Nothing here can carry a bucket, key, URL or body.
const KNOWN_CLASSES = new Set([
  'AccessDenied', 'NoSuchBucket', 'NoSuchKey', 'NotFound', 'InvalidAccessKeyId', 'SignatureDoesNotMatch', 'InvalidBucketName', 'ExpiredToken', 'InvalidToken',
  'SlowDown', 'ServiceUnavailable', 'InternalError', 'RequestTimeout', 'TooManyRequests', 'PreconditionFailed', 'BadDigest',
  'TimeoutError', 'AbortError', 'NetworkingError', 'TypeError', 'FetchError', 'UpstashError', 'SyntaxError', 'RangeError',
  'Error', 'ConfigMissing', 'OutOfScope', 'Unknown',
]);
/** the class name if it is on the allowlist, otherwise "Error" */
export const safeClass = (name) => (typeof name === 'string' && KNOWN_CLASSES.has(name) ? name : 'Error');

export function safeErrInfo(e) {
  let cls = safeClass(e?.name);
  // getS3() throws a plain Error("<VAR> not configured.") when an env var is missing; label it without echoing the message.
  if (cls === 'Error' && /not configured/i.test(String(e?.message))) cls = 'ConfigMissing';
  const s = Number(e?.$metadata?.httpStatusCode ?? e?.status);
  return { cls, http: Number.isInteger(s) && s >= 100 && s <= 599 ? s : null };
}

/** "class=AccessDenied http=403" (http omitted when unknown) */
export const formatSafeErr = ({ cls, http }) => `class=${cls}${http ? ` http=${http}` : ''}`;

/**
 * What a command-line tool may print for an unexpected crash: the message ONLY when it is one of our own fixed "<ENV_VAR> is not set / not configured /
 * is required" lines (an environment variable NAME is not a secret); anything else — an SDK or parser message that could embed a key, URL, bucket or
 * file snippet — becomes "failed (class=… http=…)".
 */
export function printableError(e) {
  const m = String(e?.message ?? '');
  if (/^[A-Z][A-Z0-9_]{2,60} (is not set|not configured|is required)\.?$/.test(m)) return m;
  return `failed (${formatSafeErr(safeErrInfo(e))})`;
}
