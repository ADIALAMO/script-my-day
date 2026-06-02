import React from 'react';
import Head from 'next/head';
import { motion } from 'framer-motion';
import { Smartphone } from 'lucide-react';
import { getServerSession } from 'next-auth/next';
import { Redis } from '@upstash/redis';
import { authOptions } from '../lib/auth';

/**
 * PWA relay-exchange landing page.
 *
 * NextAuth redirects here (as callbackUrl) after the user clicks the magic
 * link in external Safari on iOS. By the time this page runs server-side,
 * Safari has a valid session cookie — getServerSession() reads it and writes a
 * short-lived verified relay entry to Redis that the PWA's polling loop can
 * detect and exchange for its own session.
 *
 * The page itself is shown in Safari. Its only instruction to the user is
 * "Switch back to the app" — the PWA detects auth automatically.
 */
export async function getServerSideProps({ req, res, query }) {
  const { relay_token } = query;

  // No relay token → non-PWA magic link flow. Redirect to the standard page.
  if (!relay_token || typeof relay_token !== 'string' || relay_token.length > 64) {
    return { redirect: { destination: '/auth-success', permanent: false } };
  }

  const session = await getServerSession(req, res, authOptions);

  if (!session?.user?.id) {
    // Session not established (shouldn't happen here — NextAuth already verified).
    // Send the user home to re-authenticate.
    return { redirect: { destination: '/', permanent: false } };
  }

  try {
    // Use a direct Redis instance (not the shared singleton from lib/redis.js)
    // because the singleton's offline stub does not implement setex.
    const redis = new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });

    // TTL: 90 seconds — tight window so an abandoned token doesn't linger.
    // The PWA polling loop reads this entry and calls signIn('relay-exchange').
    await redis.setex(
      `relay:${relay_token}`,
      90,
      JSON.stringify({
        status: 'verified',
        userId: session.user.id,
        email:  session.user.email,
      })
    );
  } catch (err) {
    // Redis write failed — log but don't break the page render.
    // The user can reload the PWA manually as a fallback.
    console.error('auth-relay-complete: Redis write failed:', err.message);
  }

  return { props: {} };
}

export default function AuthRelayComplete() {
  return (
    <>
      <Head>
        <title>Verified · LifeScript Studio</title>
      </Head>

      <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">

        {/* Ambient glow */}
        <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[520px] rounded-full bg-[#d4a373]/6 blur-[110px]" />
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.93, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', damping: 26, stiffness: 300 }}
          className="relative z-10 w-full max-w-xs"
        >
          <div className="relative bg-[#0a0a14] border border-[#d4a373]/15 rounded-[2.5rem] shadow-[0_40px_120px_rgba(0,0,0,0.95)] overflow-hidden px-8 pt-11 pb-9 text-center">

            {/* Top accent line */}
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-[#d4a373]/40 to-transparent" />

            {/* Icon */}
            <div className="flex justify-center mb-5">
              <div className="w-16 h-16 rounded-2xl bg-[#d4a373]/10 border border-[#d4a373]/20 flex items-center justify-center shadow-[0_0_40px_rgba(212,163,115,0.18)]">
                <Smartphone className="text-[#d4a373] w-8 h-8" />
              </div>
            </div>

            <p className="text-[9px] font-black tracking-[0.35em] text-[#d4a373]/55 uppercase mb-3">
              VERIFIED
            </p>
            <h1 className="text-[22px] font-black text-white leading-tight mb-4">
              Return to the app
            </h1>
            <p className="text-white/40 text-[13px] leading-relaxed">
              Switch back to LifeScript —<br />
              your session will load automatically.
            </p>

            <div className="my-7 h-px bg-white/[0.06]" />

            <p className="text-[9px] font-black tracking-[0.25em] text-white/10 uppercase">
              LifeScript Studio
            </p>

          </div>
        </motion.div>
      </div>
    </>
  );
}
