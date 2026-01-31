
import Redis from 'ioredis';

// יצירת חיבור ל-Redis באמצעות המשתנה שיש לך ב-.env
const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 1, 
  connectTimeout: 1000,    
  lazyConnect: true,       
  retryStrategy: () => null 
});

// תופס שגיאות כדי שלא יקפיצו את ה-Error Overlay האדום
redis.on('error', (err) => console.log('📡 Redis Offline Mode (Poster API)'));

export default async function handler(req, res) {
  const sanitize = (str) => (typeof str === 'string' ? str.trim() : '');  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { prompt, deviceId: bodyDeviceId, isAdmin: isAdminBody } = req.body;
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  const seed = Math.floor(Math.random() * 999999);

  // בדיקת אדמין ומכסה
  const clientAdminKey = sanitize(req.headers['x-admin-key'] || isAdminBody || '');
  const serverAdminSecret = sanitize(process.env.ADMIN_SECRET || '');
  const isAdmin = serverAdminSecret !== '' && clientAdminKey === serverAdminSecret;
  let usageKey = null;

  if (!isAdmin) {
    const identifier = req.headers['x-device-id'] || bodyDeviceId || (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    usageKey = `usage:poster:${identifier}:${new Date().toISOString().split('T')[0]}`;
   try {
      // מונע תקיעה של השרת אם Redis לא זמין (למשל בניתוק אינטרנט)
      const currentUsage = await Promise.race([
        redis.get(usageKey),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1000))
      ]);
      
      console.log(`📊 Redis Check: המפתח הוא ${usageKey}, הערך שנמצא: ${currentUsage}`);

      if (currentUsage && parseInt(currentUsage) >= 2) {
        return res.status(429).json({ 
          success: false, 
          message: "🎬 המסך ירד להיום. מכסת הפוסטרים היומית שלך הסתיימה, נתראה מחר בבכורה!" 
        });
      }
    } catch (e) { 
      console.log("⚠️ Poster Quota bypass: Redis unavailable"); 
    }
  }
  // פונקציה פנימית לעדכון המכסה רק בהצלחה
  const trackUsage = async () => {
    if (usageKey && !isAdmin) {
      try {
        await redis.incr(usageKey);
        await redis.expire(usageKey, 86400);
      } catch (e) { console.error("Redis update error:", e); }
    }
  };
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
          "seed": seed
        }),
        signal: AbortSignal.timeout(25000) // הגדלנו מעט ליתר ביטחון
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Status ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      
      // חילוץ חכם: בודק מערך images חיצוני, או אובייקט images פנימי, או תוכן הודעה
      const rawImage = data.images?.[0] || 
                       data.choices?.[0]?.message?.images?.[0]?.image_url?.url || 
                       data.choices?.[0]?.message?.content;

      if (rawImage) {
        console.log("✅ SUCCESS: OpenRouter generated image data.");
        const imageUrl = await getBase64Image(rawImage);
        await trackUsage();
        return res.status(200).json({ success: true, imageUrl, provider: 'OpenRouter-Klein' });
      } else {
        throw new Error("No image data found in OpenRouter response");
      }

    } catch (e) {
      console.error("❌ Stage 1 Failed:", e.message);
    }
  }
  // --- שלב 2: ByteDance Seedream 4.5 (גיבוי איכותי) ---
  try {
    console.log("🎨 Stage 2: Seedream 4.5 (OpenRouter)...");
    const seedreamResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://lifescript.app", 
        "X-Title": "LifeScript Studio"
      },
      body: JSON.stringify({
        // ניסיון עם ה-ID המלא והנורמלי של OpenRouter
        "model": "bytedance-seed/seedream-4.5", 
        "messages": [{ "role": "user", "content": finalPrompt }],
        "modalities": ["image"], // Seedream מעדיף לעיתים רק image
        "seed": seed
      }),
      signal: AbortSignal.timeout(25000)
    });

    if (seedreamResponse.ok) {
      const sData = await seedreamResponse.json();
      // בדיקה רחבה יותר של נתיבי התמונה ב-JSON
      const sRaw = sData.images?.[0] || 
                   sData.choices?.[0]?.message?.images?.[0]?.image_url?.url ||
                   sData.choices?.[0]?.message?.content;

      if (sRaw && (sRaw.startsWith('http') || sRaw.startsWith('data:image'))) {
        console.log("✅ SUCCESS: Seedream 4.5 generated poster.");
        const imageUrl = await getBase64Image(sRaw);
        await trackUsage();
        return res.status(200).json({ success: true, imageUrl, provider: 'Seedream-4.5' });
      }
    }
    
    // אם הגענו לכאן, סימן שקיבלנו 404 או תשובה ריקה
    throw new Error(`Model unavailable (Status ${seedreamResponse.status})`);
    
  } catch (e) {
    console.warn("⚠️ Stage 2 Failed (Seedream):", e.message);
    // הקוד ימשיך אוטומטית ל-Stage 3 (Pollinations Flux)
  }

 // --- שלב 3: Pollinations Turbo (גיבוי מהירות - עכשיו לפני Flux) ---
  try {
    console.log("🚀 Stage 3: Pollinations Turbo...");
    const turboPrompt = finalPrompt + backUpRefinement;
    const turboUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(turboPrompt)}?width=1024&height=1024&model=turbo&nologo=true&seed=${seed}`;
    
    const imageUrl = await getBase64Image(turboUrl);
    console.log("✅ SUCCESS: Stage 3 (Turbo) saved the day.");
    await trackUsage();
    return res.status(200).json({ success: true, imageUrl, provider: 'Pollinations-Turbo' });
  } catch (e) {
    console.warn("⚠️ Stage 3 (Turbo) Failed, trying final backup...");
  }

  // --- שלב 4: Pollinations Flux (גיבוי איכות אחרון) ---
  try {
    console.log("🛡️ Stage 4: Pollinations Flux (Final Safety Net)...");
    const fluxPrompt = finalPrompt + backUpRefinement;
    const fluxUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(fluxPrompt)}?width=1024&height=1024&model=flux&nologo=true&seed=${seed}`;
    
    const imageUrl = await getBase64Image(fluxUrl);
    console.log("✅ SUCCESS: Stage 4 (Flux) generated successfully.");
    await trackUsage();
    return res.status(200).json({ success: true, imageUrl, provider: 'Pollinations-Flux' });
  } catch (e) {
    console.error("❌ ALL STAGES FAILED.");
  }

  return res.status(500).json({ 
    error: "Failed to generate image",
    details: "All 4 generation stages exhausted."
  });
}
