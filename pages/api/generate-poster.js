export default async function handler(req, res) {
res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // טיפול בבקשת "בדיקה" (Preflight) של הדפדפן
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  const { prompt } = req.body;
const cleanPrompt = `A high-end cinematic photography shot for a movie scene, ${prompt}. Masterpiece, 8k, highly detailed. Pure artistic visual without any text, no words, no titles, no credits, no letters, no typography. Background is a clean cinematic environment.`;  const HF_TOKEN = process.env.HF_TOKEN?.trim();
  
  if (!HF_TOKEN) {
    return res.status(500).json({ error: "Missing HF Token" });
  }

  // הגדרת סבלנות של 15 שניות מול השרת הראשי
  const totalPatienceMs = 15000; 
  const startTime = Date.now();

  console.log("🎨 Poster Engine: Starting Production (15s patience protocol)...");

  // --- שלב 1: ניסיונות מול Hugging Face ---
  while (Date.now() - startTime < totalPatienceMs) {
    try {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      console.log(`📡 Attempting HF... (${elapsed}s elapsed)`);

      const response = await fetch(
        "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell",
        {
          headers: {
            Authorization: `Bearer ${HF_TOKEN}`,
            "Content-Type": "application/json",
          },
          method: "POST",
          body: JSON.stringify({ inputs: cleanPrompt }),
        }
      );

      // --- עדכון עבור Hugging Face ---
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        // הפיכה ל-Base64
        const base64Image = buffer.toString('base64');
        const dataUrl = `data:image/png;base64,${base64Image}`;
        
        console.log(`✅ SUCCESS: Poster generated via HF and converted to Base64.`);
        return res.status(200).json({ success: true, imageUrl: dataUrl, provider: 'HF' });
      }

      if (response.status === 503 || response.status === 429) {
        console.warn(`⚠️ HF Busy (Status ${response.status}). Retrying...`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      break;
    } catch (error) {
      console.error("❌ HF Network Error:", error.message);
      break;
    }
  }

  // --- שלב 2: גיבוי מהיר ב-Pollinations (Turbo - ניסיון בודד) ---
  try {
    console.log("🛡️ BACKUP: Pollinations Turbo Mode (Single Attempt)...");
    const encodedPrompt = encodeURIComponent(cleanPrompt);
    const pollUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&model=turbo&nologo=true&seed=${Math.floor(Math.random() * 9999)}`;
    
    // המתנה יחידה של 10 שניות
    console.log("⏳ Waiting 10s for turbo backup...");
    await new Promise(r => setTimeout(r, 10000));

    const pollResponse = await fetch(pollUrl);
    if (pollResponse.ok) {
      const arrayBuffer = await pollResponse.arrayBuffer();
      // בדיקה מינימלית לוודא שזו לא תמונה שבורה
      if (arrayBuffer.byteLength > 15000) { 
        const dataUrl = `data:image/png;base64,${Buffer.from(arrayBuffer).toString('base64')}`;
        console.log("💎 SUCCESS: Backup Generated via Turbo.");
        return res.status(200).json({ success: true, imageUrl: dataUrl, provider: 'Pollinations' });
      }
    }
  } catch (err) {
    console.error("❌ Fatal failure in backup engine:", err.message);
  }
  return res.status(500).json({ error: "Failed to generate poster after all attempts." });
}