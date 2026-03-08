// pages/api/proxy-image.js
export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).send('No URL');

  const finalUrl = decodeURIComponent(url);
  console.log("🎯 Proxy attempting fetch to:", finalUrl);

  try {
    const response = await fetch(finalUrl, {
      method: 'GET',
      headers: {
        // הוספנו Headers של דפדפן אמיתי כדי שלא יחסמו אותנו
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    if (!response.ok) {
      // אם זה נכשל, בוא נראה בדיוק מה הסטטוס בטרמינל
      console.error(`❌ Source failed: ${response.status} ${response.statusText}`);
      return res.status(response.status).send(`Pollinations failed: ${response.status}`);
    }

    const contentType = response.headers.get('content-type');
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // הגדרות למניעת שגיאות CORS בדפדפן
    res.setHeader('Content-Type', contentType || 'image/png');
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    
    return res.send(buffer);
  } catch (error) {
    console.error('🔥 Proxy Critical Error:', error.message);
    return res.status(500).send("Proxy error");
  }
}