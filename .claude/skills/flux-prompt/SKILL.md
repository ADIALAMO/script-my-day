---
name: flux-prompt
description: >-
  Rules for engineering FLUX image prompts in LIFESCRIPT (movie posters, comic
  panels, identity Character Sheets). Use whenever building, editing, or debugging
  the prompt string sent to image providers — in pages/api/generate-poster.js
  (finalPrompt / agentPrompt), the [image:] line emitted by lib/agent.js, the
  poster DNA in GENRE_DNA, or identity prompts in lib/identity.js. Triggers on:
  image prompt, poster prompt, visualPrompt, negative prompt, anatomy/hands fix,
  FLUX, Flux Schnell, "image looks wrong/distorted".
---

# LIFESCRIPT — FLUX Prompting Rules

All image providers in this app are FLUX-family (CF flux-1-schnell, HF
FLUX.1-schnell, OpenRouter flux.2-klein, Pollinations flux, Grok/Gemini identity).
FLUX does **not** behave like Stable Diffusion. The rules below are load-bearing —
violating them actively *summons* the defects you're trying to prevent.

## The core law
**FLUX wants clean, positive, natural-language prose — not keyword stacks, not
weights, not negations.**

- ✅ Descriptive sentences: *"A high-end cinematic RAW 35mm film still of a lone
  soldier in a ruined city at dusk, dramatic lighting, sharp focus."*
- ❌ `(masterpiece:1.4), (best quality), 8k, ((perfect hands))` — SD-weight syntax;
  FLUX cannot parse it and it degrades output.
- ❌ Negative prompts / `--no` lists. FLUX has **no negative-prompt channel** here.

## The trap — do NOT re-enter the prompt-guard loop
There is a documented history of trying to "fix" hands/anatomy/text artifacts by
adding guard phrases. **It backfires every time:**
- Negation and anatomy **nouns** (`no extra fingers`, `correct hands`, `two arms`,
  `not deformed`) *introduce* those concepts into the image and **summon the
  defect**. FLUX attends to the noun, not the negation.
- If you catch yourself adding "no/avoid/without/correct/proper + body part",
  **stop** — that loop has already been run and lost. Remove the guard instead of
  strengthening it.

## How the real prompts are built (ground truth)
[pages/api/generate-poster.js](pages/api/generate-poster.js) splits into two targets:

- **POSTER** (photorealistic film still): wraps the agent prompt in positive
  cinematic prose only —
  `A high-end cinematic RAW 35mm film still of: <agentPrompt>. Shot on IMAX,
  dramatic cinematic lighting, realistic skin textures, sharp focus, 8k,
  masterpiece.` No weights, no negations.
- **COMIC panel**: stays **bare clean prose** (`agentPrompt` untouched) — the
  storyboard already supplies style framing. Anatomy/fidelity guards "proved to
  summon defects," so none are added. Keep comic prompts minimal.

The `agentPrompt` is the `[image: ...]` line the LLM emits as the **mandatory last
line** of every script (see SYSTEM_PROMPT rule 15 + the per-genre `poster` template
in `GENRE_DNA` in [lib/agent.js](lib/agent.js)). The handler strips the
`[image: ]` wrapper before sending.

### The textless poster convention
Genre poster templates deliberately end with
`(No text, no letters, no words, no title, no credits)` and `NO TEXT, NO LETTERS,
NO WORDS`. This is the **one sanctioned exception** to "no negations" — it's an
empirically-kept convention to suppress garbled poster text (title is added later
in the UI, not baked by FLUX). Don't expand it into a general negative-prompt list.

## Provider-specific knobs (don't randomly change)
- HF FLUX.1-schnell: `num_inference_steps: 4`, `guidance_scale: 3.5` (schnell's
  documented optimum; SD-style high guidance oversaturates).
- CF flux-1-schnell: `steps: 6` (CF max 8) for finer detail, still within free
  neuron budget.
- `x-use-cache: false` on HF is **critical for storyboards** — without it, repeated
  panel prompts return the *same* cached image.

## Checklist before changing an image prompt
1. Is it positive prose? Remove any `(...:1.x)` weights and `--no`/negation lists.
2. Are you adding an anatomy/text guard to fix a defect? **Don't** — that's the
   loop; remove guards instead.
3. Poster vs comic: poster gets the cinematic wrapper; comic stays bare.
4. Keep the textless convention on posters as-is.
5. If output quality drops, suspect the *provider/seed/steps*, not "missing guard
   words."
