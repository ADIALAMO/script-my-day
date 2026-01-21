export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { prompt } = req.body;
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  const seed = Math.floor(Math.random() * 999999);

  const agentPrompt = prompt.replace(/\[image:\s*/i, '').replace(/\]$/, '').trim();
  
  // שימוש במונחים ויזואליים טהורים ללא המילה 'Poster' שמושכת טקסט
// הנדסת פרומפט טכנית - שימוש במילות מפתח שמייצבות את המודל
  const finalPrompt = `A high-end cinematic RAW 35mm film still of: ${agentPrompt}. Shot on IMAX, perfect facial symmetry, realistic skin textures, sharp focus, 8k, masterpiece. (Strictly NO text, NO distortion, NO blurry faces, NO extra fingers, NO titles).`;

  async function tryOpenRouterImage(modelId) {
    console.log(`💎 Attempting Optimized Klein: ${modelId}...`);
    
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://lifescript.app", 
        "X-Title": "LifeScript Studio"
      },
      body: JSON.stringify({
        "model": modelId,
        "messages": [
          {
            "role": "system",
            "content": "You are a world-class cinematographer. Generate a raw visual frame. Focus on perfect facial symmetry and sharp focus. Strictly NO text or graphic overlays."
          },
          {
            "role": "user",
            "content": finalPrompt
          }
        ],
        "modalities": ["image", "text"],
        "seed": seed,
        // --- אופטימיזציה טכנית ל-Klein ---
        "extra_body": {
          "aspect_ratio": "2:3", // פורמט פוסטר קלאסי שמונע עיוותי גוף
          "width": 1024,
          "height": 1536,
          "safety_filter": "soft" // פחות אגרסיבי כדי לא לטשטש פנים
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Status ${response.status}: ${errorData.slice(0, 100)}`);
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;
    if (message?.images?.[0]?.image_url?.url) return message.images[0].image_url.url;
    return null;
  }

  // --- שלב 1: Flux 2 Klein (המודל החדש והמהיר מהדוקומנטציה) ---
  try {
    const url = await tryOpenRouterImage("black-forest-labs/flux.2-klein-4b");
    if (url) {
      console.log("✅ SUCCESS: Flux 2 Klein generated poster.");
      return res.status(200).json({ success: true, imageUrl: url, provider: 'Flux-2-Klein' });
    }
  } catch (e) { 
    console.warn("⚠️ Flux 2 Klein failed:", e.message); 
  }

  // --- שלב 2: Google Imagen 3 (גיבוי דרך ה-API החדש) ---
  try {
    const url = await tryOpenRouterImage("google/imagen-3");
    if (url) {
      console.log("✅ SUCCESS: Imagen 3 generated poster.");
      return res.status(200).json({ success: true, imageUrl: url, provider: 'Imagen-3' });
    }
  } catch (e) { 
    console.warn("⚠️ Imagen 3 failed:", e.message); 
  }

  // --- שלב 3: Pollinations (הגיבוי החינמי שתמיד עובד) ---
  try {
    console.log("🆘 Final Fallback: Pollinations...");
    const pollUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?width=1024&height=1024&model=flux&nologo=true&seed=${seed}`;
    const pollRes = await fetch(pollUrl);
    if (pollRes.ok) {
      const buffer = Buffer.from(await pollRes.arrayBuffer());
      return res.status(200).json({ 
        success: true, 
        imageUrl: `data:image/png;base64,${buffer.toString('base64')}`, 
        provider: 'Pollinations-Fallback' 
      });
    }
  } catch (e) { 
    console.error("❌ All engines failed:", e.message); 
  }

  return res.status(500).json({ error: "Failed to generate image" });
}