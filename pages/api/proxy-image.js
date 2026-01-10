// pages/api/proxy-image.js

// הגדרות שרת לביטול מגבלת גודל הקובץ (פתרון לשגיאת 4MB)
export const config = {
  api: {
    responseLimit: false, // מאפשר העברת תמונות באיכות גבוהה מעל 4MB
    bodyParser: false,    // משפר ביצועים בהעברת נתונים בינאריים (תמונות)
  },
};

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).send('Missing URL parameter');
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // הגדרת כותרות (Headers)
    res.setHeader('Content-Type', response.headers.get('Content-Type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    // שליחת התמונה
    res.send(buffer);

  } catch (error) {
    console.error('Proxy Error:', error);
    res.status(500).send('Error fetching image');
  }
}