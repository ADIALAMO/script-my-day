export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { prompt } = req.body;
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  const seed = Math.floor(Math.random() * 999999);

  const agentPrompt = prompt.replace(/\[image:\s*/i, '').replace(/\]$/, '').trim();
  const fidelityInstruction = "distinct male and female characters, heterosexual couple, (same sex couple: -1.5), (homoerotic: -1.5), (gay: -1.5), (text: -2.0), (title: -2.0), (letters: -2.0), (watermark: -2.0), (typography: -2.0), (signature: -2.0), (writing: -2.0), (logo: -2.0)";  const backUpRefinement = ", (deformed iris, deformed pupils, semi-realistic, cgi, 3d, render, sketch, cartoon, drawing, anime, mutated hands and fingers:1.4), (deformed, distorted, disfigured:1.3), poorly drawn, bad anatomy, wrong anatomy, extra limb, missing limb, floating limbs, disconnected limbs, mutation, mutated, ugly, disgusting, amputation";
  // פרומפט מלוטש - עבר לסוכן, אך נשמר כאן כבסיס ויזואלי חזק
  const finalPrompt = `A high-end cinematic RAW 35mm film still of: ${agentPrompt}. Shot on IMAX, perfect facial symmetry, realistic skin textures, sharp focus, 8k, masterpiece. (Strictly NO text, NO distortion, NO blurry faces, NO extra fingers, NO titles). ${fidelityInstruction}`;

  // פונקציית עזר להורדת תמונה והפיכתה ל-Base64 (חיוני ל-Pollinations)
  async function getBase64Image(url) {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error("Failed to fetch image");
    const buffer = Buffer.from(await resp.arrayBuffer());
    return `data:image/png;base64,${buffer.toString('base64')}`;
  }
  // --- שלב 1: OpenRouter Flux 2 Klein (עדיפות ראשונה - מנוקה משגיאות) ---

  if (OPENROUTER_API_KEY) {
    try {
      console.log("🎬 Stage 1: OpenRouter Flux 2 Klein...");
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://lifescript.app", 
          "X-Title": "LifeScript Studio"
        },
        body: JSON.stringify({
          "model": "black-forest-labs/flux.2-klein-4b",
          "messages": [{ "role": "user", "content": finalPrompt }],
          "modalities": ["image", "text"],
          "seed": seed
          // הסרנו את ה-extra_body שגרם לשגיאות 400
        }),
        signal: AbortSignal.timeout(15000)
      });

      if (response.ok) {
        const data = await response.json();
        const url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
        if (url) {
          console.log("✅ SUCCESS: OpenRouter Klein generated poster.");
          return res.status(200).json({ success: true, imageUrl: url, provider: 'OpenRouter-Klein' });
        }
      }
      } catch (e) {
      console.error("❌ Stage 1 Failed:", e.message);
    }
  }
    // --- שלב 2: Pollinations Turbo (מהירות שיא) ---

  try {
    console.log("🚀 Stage 2: Pollinations Turbo...");
    const turboPrompt = finalPrompt + backUpRefinement;
    const turboUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(turboPrompt)}?width=1024&height=1024&model=turbo&nologo=true&seed=${seed}`;
    const imageUrl = await getBase64Image(turboUrl);
    return res.status(200).json({ success: true, imageUrl, provider: 'Pollinations-Turbo' });
  } catch (e) {
    console.warn("⚠️ Stage 2 Failed, trying Pollinations Flux...");
  }

  // --- שלב 2: Pollinations Flux (איכות גבוהה בחינם) ---
  try {
    console.log("🛡️ Stage 3: Pollinations Flux...");
    const fluxPrompt = finalPrompt + backUpRefinement;
    const fluxUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(fluxPrompt)}?width=1024&height=1024&model=flux&nologo=true&seed=${seed}`;
    const imageUrl = await getBase64Image(fluxUrl);
    return res.status(200).json({ success: true, imageUrl, provider: 'Pollinations-Flux' });
  } catch (e) {
    console.warn("⚠️ Stage 3 Failed.");
  }

  return res.status(500).json({ error: "Failed to generate image" });
}