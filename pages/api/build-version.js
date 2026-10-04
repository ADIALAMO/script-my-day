/**
 * GET /api/build-version → { sha }
 *
 * Permanent fix for native Android staleness, not part of the temporary
 * share-bug diagnostics — see next.config.js's NEXT_PUBLIC_BUILD_SHA comment
 * and pages/_app.js's resume listener for the full story.
 *
 * Tells the client which commit is actually deployed right now. Must NEVER
 * be cached — the entire point is that it always reflects the current
 * deploy, so Cache-Control is explicit here rather than relying on whatever
 * Next.js/Vercel's default for API routes happens to be.
 */
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ sha: process.env.VERCEL_GIT_COMMIT_SHA || null });
}
