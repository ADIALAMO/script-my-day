# Content Rating Questionnaire (IARC) — Suggested Answers

Based on what the app actually does: AI-generated text/images from user-written journal entries, no user-to-user interaction, no user-generated content shared publicly by default (referral links share only a poster the user chose to share). Answer against the **app's own designed behavior** — the honest caveat below applies to any AI-generation app.

| Question | Suggested answer | Why |
|---|---|---|
| Violence — realistic/cartoon | None | The app doesn't prompt for or feature violent themes. Genre options include "Action" and "Horror," which could plausibly generate mild dramatic/tense imagery (e.g., an action-movie poster), but not graphic violence, gore, or blood. |
| Sexual content / nudity | None | Not a feature. Selfie uploads go through a moderation pass (`nvidia/nemotron-3.5-content-safety` in `lib/identity.js`) before being used. |
| Profanity / crude humor | None or Mild | User-written journal text theoretically *could* contain profanity, but the app doesn't prompt for, encourage, or display it as a feature. If IARC asks specifically about user-generated text content, disclose that free-text input exists (see "User-generated content" below). |
| Controlled substances (alcohol/tobacco/drugs) | None | Not referenced or promoted. |
| Gambling | None | No gambling mechanics, simulated or real. |
| User interaction — can users interact with each other? | No direct interaction | There's no chat, comments, or messaging between users. The "Invite friends" referral feature shares a link outside the app (via the OS share sheet); it isn't in-app user-to-user contact. |
| User-generated content — shared publicly? | Not shared publicly by the app | Generated posters/comics are private to the user unless *they* choose to export/share via their device's native share sheet. The app has no public feed, gallery of other users' content, or discovery surface. |
| Location sharing | No | The app doesn't request or use device location. |
| Personal info shared with other users | No | No other-user-facing surface exists at all. |
| In-app purchases | **Yes** | The $9/month Pro subscription (`pages/api/checkout/index.js`, Stripe). |
| Ads | No | Confirmed — no ad SDK in `package.json`, no ad-serving code anywhere in the API routes. |

## Honest caveat to flag for yourself when filling this out
The journal-entry text field and the resulting AI-generated script/poster/comic are **free-form and AI-generated** — while the app doesn't design for or encourage mature themes, a user *could* type something that leads the AI to generate borderline content (this is true of essentially any generative-AI app with free text input). IARC's questionnaire is generally answered based on the app's designed/intended content rather than exhaustively policing what a generative model could theoretically produce, but it's worth being aware of this distinction if a question is phrased in a way that asks about content the app could ever produce, rather than what it's designed to produce. If you want extra safety margin, mention in the questionnaire's free-text notes (if offered) that generated content passes through content-safety moderation for the identity/photo feature specifically (Nemotron), even though the general text/poster pipeline doesn't have an equivalent explicit filter today.
