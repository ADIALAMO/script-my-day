# Additional Store Listing Details

## Category
**Recommended: Photo & Video** (primary), with **Lifestyle** as the reasonable secondary/alternative if Play Console only allows one and you want to reconsider.

Reasoning: the app's core output — and what a screenshot-browsing user will judge it by instantly — is a *generated image* (movie poster, comic panels). "Photo & Video" is where users searching for "AI poster maker," "AI image generator," "comic creator" actually browse and where Play's own algorithm is most likely to surface you against genuinely comparable apps. "Lifestyle" is defensible (it *is* a journaling app underneath), but it dilutes discoverability against a much broader, less-focused competitor set (habit trackers, journals with no visual output) rather than the specific "AI creative generation" category the app is actually strongest in. **Social** is not a good fit — there's no user-to-user interaction, feed, or discovery surface (confirmed in the Content Rating audit above); listing there would set the wrong user expectation and could even prompt extra review scrutiny for a category mismatch.

## Contact details
- **Email:** `adialamo@gmail.com` — already the address used throughout the app itself (Privacy Policy, Terms, support flows all point here per `constants/modalData.js`), so it's consistent and already "live" as the support channel.
- **Website:** `https://my-life-script.vercel.app` — the live production URL. (Per the project's own memory notes, `lifescript.app` is not yet DNS-connected — don't put that domain in Play Console until it's actually live, or the "visit website" link will error for reviewers and users.)
- **Privacy Policy URL:** `https://my-life-script.vercel.app/privacy`

## Target audience & age
**Declare 18+ (adults only).** LifeScript's minimum age is 18, in the Terms (§7), in the sign-in notice and in the site footer. Do not select any child or younger-audience target group, and do not enable "appeals to children".

Reasoning:
- The AI services the app uses require adult users, and generated stories can include mature themes (action, horror, romance).
- This is a self-declaration at sign-in ("By continuing you confirm you are 18 or older…") — it is **not** age verification and must never be described as such.
- "Star Yourself" keeps its own one-time 18+ confirmation and the upload checkboxes on top of that.
- The app requires an email/Google sign-in for most features; an adults-only audience also keeps it clear of Google's Families Policy.
