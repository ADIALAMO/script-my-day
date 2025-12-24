// pages/api/generate-script.js
import { generateScript } from '../../lib/story-service.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  try {
    const { journalEntry, genre } = req.body;

    if (!journalEntry) {
      return res.status(400).json({ message: 'Missing journal entry' });
    }

    const result = await generateScript(journalEntry, genre || 'drama');

    if (!result.success) {
      throw new Error(result.error);
    }

    return res.status(200).json({ script: result.output });
  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ message: error.message });
  }
}