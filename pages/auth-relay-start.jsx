import { useEffect } from 'react';
import Head from 'next/head';
import { signIn } from 'next-auth/react';

/**
 * Google-OAuth relay launch page — the system-browser counterpart to the
 * WebView-embedded flow.
 *
 * Google's OAuth policy blocks sign-in from embedded WebViews (Android's
 * WebView, and Capacitor's is one), returning `disallowed_useragent`. So for
 * the Capacitor app, AuthModal never calls signIn('google', ...) directly —
 * instead it opens THIS page in the system browser via @capacitor/browser's
 * Browser.open(), which is a normal, non-embedded browsing context Google
 * will accept.
 *
 * This page's only job is to immediately trigger the exact same next-auth
 * Google sign-in NextAuth would normally run in-page, but pointed at
 * /auth-relay-complete as its callbackUrl — the same relay page already used
 * by the iOS-PWA magic-link flow (lib/auth.js's relay-exchange provider).
 * That page is provider-agnostic: it just checks getServerSession() and
 * writes whatever session it finds to Redis, so it needs no changes to
 * support Google arriving here instead of email. AuthModal's existing relay
 * poll (extended to also run for Capacitor, not just iOS PWA) then detects
 * the verified entry and exchanges it for a real session inside the WebView.
 *
 * No UI is meant to be seen here — signIn() redirects to Google immediately.
 * The brief loading state only covers the moment before that redirect fires.
 */
export default function AuthRelayStart() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const relayToken = params.get('relay_token');
    if (!relayToken || relayToken.length > 64) return;

    signIn('google', {
      callbackUrl: `${window.location.origin}/auth-relay-complete?relay_token=${relayToken}`,
    });
  }, []);

  return (
    <>
      <Head>
        <title>Signing in… · LifeScript Studio</title>
      </Head>
      <div className="min-h-screen flex items-center justify-center bg-[#030712]">
        <p className="text-white/40 text-sm">Redirecting to Google…</p>
      </div>
    </>
  );
}
