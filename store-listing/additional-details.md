# Additional Store Listing Details

## Category
**Recommended: Photo & Video** (primary), with **Lifestyle** as the reasonable secondary/alternative if Play Console only allows one and you want to reconsider.

Reasoning: the app's core output — and what a screenshot-browsing user will judge it by instantly — is a *generated image* (movie poster, comic panels). "Photo & Video" is where users searching for "AI poster maker," "AI image generator," "comic creator" actually browse and where Play's own algorithm is most likely to surface you against genuinely comparable apps. "Lifestyle" is defensible (it *is* a journaling app underneath), but it dilutes discoverability against a much broader, less-focused competitor set (habit trackers, journals with no visual output) rather than the specific "AI creative generation" category the app is actually strongest in. **Social** is not a good fit — there's no user-to-user interaction, feed, or discovery surface (confirmed in the Content Rating audit above); listing there would set the wrong user expectation and could even prompt extra review scrutiny for a category mismatch.

## Contact details
- **Email:** `adialamo@gmail.com` — already the address used throughout the app itself (Privacy Policy, Terms, support flows all point here per `constants/modalData.js`), so it's consistent and already "live" as the support channel.
- **Website:** `https://my-life-script.vercel.app` — the live production URL. (Per the project's own memory notes, `lifescript.app` is not yet DNS-connected — don't put that domain in Play Console until it's actually live, or the "visit website" link will error for reviewers and users.)
- **Privacy Policy URL:** `https://my-life-script.vercel.app/privacy`

## Target audience & age
**Recommended: 18+ primary, or at minimum 16+.**

Reasoning, not just a guess:
- The app requires an email/Google sign-in to unlock most functionality, and has a paid subscription — Play's own guidance steers apps with account creation + payments away from a "designed for children" or broad all-ages declaration, since that triggers Google's stricter Families Policy (additional restrictions on ads, data collection, and design that this app hasn't been built against).
- The core interaction — writing reflective journal entries about your day — isn't inherently child-directed content, and the tone/branding (cinematic, "director," Hollywood aesthetic) reads as general-audience/adult, not kid-focused.
- There's no content specifically inappropriate for teens, so an "18+" declaration is a *safe ceiling* rather than a strict requirement — if you'd prefer a broader reach, 13+ or 16+ (with the "not designed for children" declaration, sometimes called "Teacher Approved"/general audience track) is defensible too, since nothing in the app is age-restricted content per the Content Rating answers above (no violence, no sexual content, no gambling). The one thing that pushes toward keeping the floor at 16+ rather than lower is the in-app purchase (Pro subscription) combined with account creation — Google applies extra scrutiny to payment flows reachable by younger declared audiences.

**My recommendation if you want one number:** declare **16+** as the primary target age group. It clears the "no children's app" review bar cleanly, doesn't require Families Policy compliance work you haven't done, and doesn't artificially shrink your addressable audience the way an 18+-only declaration would for what is, in practice, a general-audience creative tool.
