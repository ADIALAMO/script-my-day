import { sanitize } from '../../utils/input-processor';

export const config = { maxDuration: 45 };

function extractPanels(rawText) {
  const text = rawText.trim();
  try { const p = JSON.parse(text); if (Array.isArray(p) && p.length) return p; } catch {}
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try { const p = JSON.parse(stripped); if (Array.isArray(p) && p.length) return p; } catch {}
  const first = rawText.indexOf('[');
  const last = rawText.lastIndexOf(']');
  if (first !== -1 && last !== -1 && last > first) {
    try { const p = JSON.parse(rawText.slice(first, last + 1)); if (Array.isArray(p) && p.length) return p; } catch {}
  }
  return null;
}

const STYLE_TRACKS = {
  anime: {
    prefix: 'Dynamic action anime style, flat cel-shading, vibrant dramatic lighting, bold ink outlines —',
    suffix: '— vivid saturated colors, speed lines, expressive faces, no photorealism'
  },
  marvel: {
    prefix: '90s X-Men animated series, classic comic book shading, sharp ink line art, retro animation —',
    suffix: '— strong black ink outlines, halftone dots, dramatic heroic poses, no photorealism'
  },
  noir: {
    prefix: 'Gritty black and white comic noir, Sin City aesthetic, stark chiaroscuro shadows —',
    suffix: '— high contrast black and white only, deep ink shadows, graphic novel style, no color, no photorealism'
  }
};

function buildStoryboardPrompt(script, lang, comicStyle) {
  const track = STYLE_TRACKS[comicStyle] || STYLE_TRACKS.anime;
  const langNote = lang === 'he'
    ? 'The screenplay is in Hebrew. Write "scene" and "dialogue" fields in Hebrew. The "visual" field MUST always be written in English.'
    : 'Write all fields in English.';

  return `You are a comic book storyboard artist specializing in the requested visual style.

${langNote}

Break down the following screenplay into 5-7 sequential panels covering the full story arc.

Return ONLY a valid JSON array. No markdown, no backticks, no explanation — just the JSON.

Format:
[{"panel":1,"scene":"INT. LOCATION - DAY","visual":"...","dialogue":"Key line here"}]

Field rules:
- "panel": integer (1 to 7)
- "scene": location and time context, match script language
- "visual": ALWAYS ENGLISH. STRICT LIMIT: 25-35 words. Must start with "${track.prefix}" and end with "${track.suffix}". Between prefix and suffix: describe ONLY the key subject, action, and camera angle using comic shorthand (e.g. "Dynamic low angle", "Hero leaping", "Two-shot confrontation", "Extreme close-up eyes"). NO photography jargon.
- "dialogue": single most important line or caption, match script language

Story arc required: opening → development → conflict peak → climax → resolution.

SCREENPLAY:
${script.slice(0, 3000)}`;
}

async function tryGemini(prompt, apiKey) {
  const models = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest'];
  for (const model of models) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.25, maxOutputTokens: 2000 }
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!resp.ok) continue;
      const data = await resp.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) continue;
      const panels = extractPanels(text);
      if (panels) { console.log(`✅ Storyboard via ${model}: ${panels.length} panels`); return panels; }
    } catch (e) {
      clearTimeout(timeoutId);
      if (e.name !== 'AbortError') console.warn(`⚠️ Storyboard ${model}: ${e.message}`);
    }
  }
  return null;
}

async function tryOpenRouter(prompt, apiKey) {
  const models = ['google/gemma-3-27b-it', 'google/gemma-3-12b-it', 'deepseek/deepseek-chat'];
  for (const model of models) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://lifescript.app',
          'X-Title': 'LifeScript Studio'
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.25,
          max_tokens: 2000
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!resp.ok) continue;
      const data = await resp.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text) continue;
      const panels = extractPanels(text);
      if (panels) { console.log(`✅ Storyboard via ${model}: ${panels.length} panels`); return panels; }
    } catch (e) {
      clearTimeout(timeoutId);
      if (e.name !== 'AbortError') console.warn(`⚠️ Storyboard ${model}: ${e.message}`);
    }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  try {
    const { script, lang, genre, comicStyle } = req.body;
    const cleanScript = sanitize(script || '', 3500);

    if (!cleanScript || cleanScript.length < 20) {
      return res.status(400).json({ success: false, error: 'Script text too short' });
    }

    const prompt = buildStoryboardPrompt(cleanScript, lang || 'en', comicStyle || 'anime');
    const geminiKey = process.env.GOOGLE_GEMINI_API_KEY?.trim();
    const openrouterKey = process.env.OPENROUTER_API_KEY?.trim();

    if (geminiKey) {
      const panels = await tryGemini(prompt, geminiKey);
      if (panels) return res.status(200).json({ success: true, panels });
    }

    if (openrouterKey) {
      const panels = await tryOpenRouter(prompt, openrouterKey);
      if (panels) return res.status(200).json({ success: true, panels });
    }

    return res.status(500).json({ success: false, error: 'All storyboard engines offline.' });
  } catch (err) {
    console.error('Storyboard API error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
