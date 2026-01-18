export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt } = req.body;
  
  if (!process.env.HF_TOKEN) {
    return res.status(500).json({ error: "Token missing in .env.local" });
  }

  const maxRetries = 5;
  let delay = 5000; 

  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`Attempt ${i + 1}: Sending to HF...`);
      
      const response = await fetch(
        "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell",
        {
          headers: {
            Authorization: `Bearer ${process.env.HF_TOKEN.trim()}`,
            "Content-Type": "application/json",
          },
          method: "POST",
          body: JSON.stringify({ inputs: prompt }),
        }
      );

      if (response.status === 503 || response.status === 429) {
        console.log(`Model status ${response.status}, retrying in 5s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      if (!response.ok) {
        const errorDetail = await response.text();
        console.error("HF Error:", errorDetail);
        throw new Error(`HF_ERROR: ${response.status}`);
      }

      // הצלחה - שולחים את המידע ועוצרים הכל
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      console.log(`✅ Success on Attempt ${i + 1}. Sending image to client.`);
      
      res.setHeader('Content-Type', 'image/png');
      return res.send(buffer); // ה-return כאן קריטי - הוא שובר את הלולאה ומסיים את הפונקציה

    } catch (error) {
      console.error(`Error on attempt ${i + 1}:`, error.message);
      if (i === maxRetries - 1) {
        return res.status(500).json({ error: error.message });
      }
      // במקרה של שגיאת רשת לא צפויה, נחכה קצת וננסה שוב
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}