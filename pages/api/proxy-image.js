// pages/api/proxy-image.js

export default async function handler(req, res) {
  // 1. חילוץ ה-URL מהבקשה
  const { url } = req.query;

  if (!url) {
    return res.status(400).send('Missing URL parameter');
  }

  try {
    // 2. ביצוע הבקשה לשרת התמונות (Server-side)
    const response = await fetch(url, {
      headers: {
        // התחזות לדפדפן רגיל כדי לעקוף חסימות בוטים
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }

    // 3. המרת התמונה לבאפר (Buffer)
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 4. הגדרת כותרות (Headers) לתשובה
    res.setHeader('Content-Type', response.headers.get('Content-Type') || 'image/jpeg');
    // שמירה במטמון לשנה שלמה לביצועים מהירים
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    // 5. שליחת התמונה לדפדפן
    res.send(buffer);

  } catch (error) {
    console.error('Proxy Error:', error);
    res.status(500).send('Error fetching image');
  }
}