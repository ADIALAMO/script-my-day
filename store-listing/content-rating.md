# Content Rating Questionnaire (IARC) — Suggested Answers

Based on what the app actually does: AI-generated text/images from user-written journal entries, no user-to-user interaction, no user-generated content shared publicly by default (referral links share only a poster the user chose to share). Answer against the **app's own designed behavior** — the honest caveat below applies to any AI-generation app.

| Question | Suggested answer | Why |
|---|---|---|
| Violence — realistic/cartoon | None | The app doesn't prompt for or feature violent themes. Genre options include "Action" and "Horror," which could plausibly generate mild dramatic/tense imagery (e.g., an action-movie poster), but not graphic violence, gore, or blood. |
| Sexual content / nudity | None (designed behaviour) — see "Safeguards against restricted AI output" below | Not a feature, and the app is general-audience. Safeguards that exist in the code today: server-side keyword blocklist on all user text/prompts, positive "fully clothed / non-sexual / adults only in visuals" rules in every script and storyboard instruction, Gemini `safetySettings`, a hard stop on any provider content refusal, no unfiltered last-resort image provider, face-photo moderation (Nemotron) with ownership-checked references. **Not yet in place:** an in-app report button (planned). The output image classifier is implemented on `fix/content-safety-output-check` (not deployed until merged). |
| Profanity / crude humor | None or Mild | User-written journal text theoretically *could* contain profanity, but the app doesn't prompt for, encourage, or display it as a feature. If IARC asks specifically about user-generated text content, disclose that free-text input exists (see "User-generated content" below). |
| Controlled substances (alcohol/tobacco/drugs) | None | Not referenced or promoted. |
| Gambling | None | No gambling mechanics, simulated or real. |
| User interaction — can users interact with each other? | No direct interaction | There's no chat, comments, or messaging between users. The "Invite friends" referral feature shares a link outside the app (via the OS share sheet); it isn't in-app user-to-user contact. |
| User-generated content — shared publicly? | Not shared publicly by the app | Generated posters/comics are private to the user unless *they* choose to export/share via their device's native share sheet. The app has no public feed, gallery of other users' content, or discovery surface. |
| Location sharing | No | The app doesn't request or use device location. |
| Personal info shared with other users | No | No other-user-facing surface exists at all. |
| In-app purchases | **Yes** | The $9/month Pro subscription (`pages/api/checkout/index.js`, Stripe). |
| Ads | No | Confirmed — no ad SDK in `package.json`, no ad-serving code anywhere in the API routes. |

## Safeguards against restricted AI output (what the code does today)
Verified against the code on branch `fix/content-safety-hotfix`; update this list when the planned items ship.

| Layer | What it does | Where |
|---|---|---|
| Input blocklist | English + Hebrew keyword/phrase list (explicit sexual wording, nudity, minors next to sexual wording). Applied server-side to the journal entry, the storyboard script and every image prompt, **before** any quota is spent or any model is called. A hit returns a localized message (`CONTENT_BLOCKED`). | `lib/content-blocklist.js`, `generate-script.js`, `generate-storyboard.js`, `generate-poster.js` |
| Prompt length / markup | Image prompts are stripped of markup and capped at 1500 characters (direct API calls included). | `generate-poster.js` |
| Positive safety rule | Every script and storyboard instruction tells the model: fully clothed in modest attire, non-sexual scenes, only adults in the visuals, explicit source material rewritten tastefully. | `lib/content-safety.js` → `lib/agent.js`, `generate-storyboard.js` |
| Gemini safety settings | Explicit `safetySettings` on every Gemini text call (sexual content blocked at medium and above). | `lib/story-service.js`, `generate-storyboard.js` |
| Refusal is final | If a provider refuses the content (Cloudflare NSFW filter, OpenRouter/Grok/Gemini safety block, Gemini script block), the request ends with a placeholder and `CONTENT_REFUSED`; it is **never retried on another provider**, nothing is charged. | `lib/content-safety.js`, `generate-poster.js`, `lib/story-service.js` |
| No unfiltered fallback | Pollinations (anonymous, unfiltered) was removed from every image chain. | `generate-poster.js` |
| Output image check | Every generated image (poster, comic panel, Star Yourself image, Character Sheet) is classified by a safety model before it is shown or stored; an unsafe or unreadable verdict shows a placeholder instead and nothing is charged. If the checker is unavailable the image is not shown (retry). Uploads to storage are re-checked unless the same bytes were just approved. | `lib/image-check.js`, `generate-poster.js`, `upload-panel.js`, `upload-character.js` |
| Face photos | Selfie moderation (Nemotron, fail-closed) at upload; the reference used for generation must be the caller's own stored character, not an arbitrary URL. | `lib/identity.js`, `upload-character.js` |
| Diagnostics | Each generated image logs provider, panel index and comic id (no prompt, no image, no user text). | `generate-poster.js` |

**Not yet in place (planned, do not claim in the Play Console response until shipped):** an in-app "Report" button on posters, comic panels and reels. (The output image check above is implemented on branch `fix/content-safety-output-check` — claim it only once that branch is deployed and the format probe has confirmed the checker's reply format.)

## Honest caveat to flag for yourself when filling this out
The journal-entry text field and the resulting AI-generated script/poster/comic are **free-form and AI-generated** — while the app doesn't design for or encourage mature themes, a user *could* type something that leads the AI to generate borderline content (this is true of essentially any generative-AI app with free text input). IARC's questionnaire is generally answered based on the app's designed/intended content rather than exhaustively policing what a generative model could theoretically produce, but it's worth being aware of this distinction if a question is phrased in a way that asks about content the app could ever produce, rather than what it's designed to produce. If you want extra safety margin, mention in the questionnaire's free-text notes (if offered) the safeguards listed above. Be precise: generated images are not yet classified after generation, and there is no in-app report button yet.
