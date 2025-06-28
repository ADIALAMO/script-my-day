import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import path from 'path';
import axios from 'axios';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';

const app = express();
const PORT = process.env.PORT || 50000;

// פתרון עבור __dirname במודולי ES
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// הגדרות CORS
app.use((req, res, next) => {
    // APP_FRONTEND_URL יגיע ממשתני הסביבה ב-Render בסביבת פרודקשן
    const appFrontendUrl = process.env.APP_FRONTEND_URL;
    
    // בודק אם הסביבה היא פרודקשן ו-APP_FRONTEND_URL מוגדר,
    // אחרת משתמש בכתובות מקומיות (localhost)
    const allowedOrigins = [];
    if (process.env.NODE_ENV === 'production' && appFrontendUrl) {
        allowedOrigins.push(appFrontendUrl);
    } else {
        allowedOrigins.push(`http://localhost:${PORT}`);
        allowedOrigins.push('http://127.0.0.1:50000');
    }
    
    const origin = req.headers.origin;

    if (origin && allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else if (!origin && req.method === 'GET') {
        // לאפשר גישה לבקשות GET ללא Origin (כמו גישה ישירה לקובץ)
        res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (process.env.NODE_ENV === 'production' && appFrontendUrl && req.headers.referer && req.headers.referer.startsWith(appFrontendUrl)) {
        // מנגנון גיבוי עבור Referer במידה ו-Origin לא נשלח מאיזושהי סיבה
        res.setHeader('Access-Control-Allow-Origin', appFrontendUrl);
    } else if (process.env.NODE_ENV === 'production' && origin && !allowedOrigins.includes(origin)) {
        // במצב פרודקשן, אם ה-Origin לא מורשה, דחה את הבקשה.
        // אזהרה: יש לוודא ש-APP_FRONTEND_URL מוגדר נכון לפני הפריסה.
        console.warn(`Blocked request from untrusted origin in production: ${origin}`);
        return res.status(403).send('Forbidden');
    }


    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', true);
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ודא שמפתח ה-API של OpenRouter מוגדר
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) {
    // ההודעה הזו תופיע בלוגים רק אם המפתח חסר לגמרי (ולא רק אם הוא ריק או שגוי)
    console.error('Error: OPENROUTER_API_KEY is not set. Please set this environment variable.');
    process.exit(1);
}

// הודעה זו תופיע תמיד כיוון שהיא אינפורמטיבית לגבי הטעינה של משתני הסביבה.
console.log('[dotenv] Environment variables loaded.');

// הגדרת נתיבי תיקיות השמירה
const DIARY_DIR = path.join(__dirname, 'saved_diaries');
const SCRIPT_DIR = path.join(__dirname, 'saved_scripts');

// פונקציה ליצירת תיקיות אם אינן קיימות
async function ensureDirectoriesExist() {
    try {
        await fs.mkdir(DIARY_DIR, { recursive: true });
        await fs.mkdir(SCRIPT_DIR, { recursive: true });
        // הודעה זו תופיע תמיד, מכיוון שהיא קשורה לפעולה של השרת
        console.log('Save directories ensured.');
    } catch (error) {
        console.error('Error ensuring directories:', error);
    }
}
ensureDirectoriesExist(); // קרא לפונקציה בעת הפעלת השרת


// נקודת קצה ליצירת תסריט מהיומן האישי
app.post('/api/generateScript', async (req, res) => {
    const { diaryEntry, genre, lang } = req.body;

    if (!diaryEntry || !genre) {
        return res.status(400).json({ error: 'Diary entry and genre are required.' });
    }

    // חישוב אורך היומן כדי להתאים את ציפיית התסריט
    const diaryLength = diaryEntry.split(/\s+/).length; // מספר מילים ביומן
    let desiredScriptLengthHint;

    if (lang === 'he') {
        if (diaryLength < 30) { // יומן קצר מאוד
            desiredScriptLengthHint = `צור תסריט קצר מאוד (1-2 סצנות, כ-50-100 מילים).`;
        } else if (diaryLength < 100) { // יומן בינוני
            desiredScriptLengthHint = `צור תסריט קצר (2-3 סצנות, כ-100-300 מילים), בהתאם לאורך היומן.`;
        } else { // יומן ארוך
            desiredScriptLengthHint = `צור תסריט באורך בינוני עד ארוך (3-5 סצנות, עד 500 מילים), בהתאם לאורך היומן.`;
        }
    } else { // English (default or 'en')
        if (diaryLength < 30) { // Very short entry
            desiredScriptLengthHint = `Create a very short script (1-2 scenes, about 50-100 words).`;
        } else if (diaryLength < 100) { // Medium entry
            desiredScriptLengthHint = `Create a short script (2-3 scenes, about 100-300 words), adapting to the diary length.`;
        } else { // Long entry
            desiredScriptLengthHint = `Create a medium to long script (3-5 scenes, up to 500 words), adapting to the diary length.`;
        }
    }

    const promptTemplate = {
        he: `אתה תסריטאי מומחה.
        ${desiredScriptLengthHint}
        התסריט צריך להפוך את קטע היומן למשהו משעשע/מרגש/מפתיע (בהתאם לז'אנר: ${genre}).
        
        התסריט צריך לכלול:
        - כותרת: (שם קצר וקליט המבוסס על היומן)
        - דמויות: (רשימה קצרה, עם דמות ראשית המבוססת על כותב היומן)
        - תיאור סצנה (Scene description): תיאור של המיקום והפעולה, לדוגמה: "[פתיחה] לילה. סמטה חשוכה. חתול שחור הולך בשקט."
        - דיאלוגים (Dialogue): שם הדמות ואחריה הדיאלוג שלה.
        
        קטע היומן: "${diaryEntry}"
        
        תסריט:
        `,
        en: `You are an expert scriptwriter.
        ${desiredScriptLengthHint}
        The script should transform the diary entry into something entertaining/emotional/surprising (depending on the genre: ${genre}).
        
        The script should include:
        - Title: (A short, catchy title based on the diary)
        - Characters: (A brief list, with a main character based on the diary writer)
        - Scene description: Description of the location and action, e.g.: "[Opening] Night. A dark alley. A black cat walks silently."
        - Dialogue: Character name followed by their dialogue.
        
        My diary entry: "${diaryEntry}"
        
        Script:
        `
    };

    const currentPrompt = promptTemplate[lang] || promptTemplate.he;

    try {
        const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: 'deepseek/deepseek-chat-v3-0324:free', // המודל שנבחר
                messages: [
                    { role: 'user', content: currentPrompt }
                ],
                max_tokens: 1000 // הגדלנו את המגבלה המקסימלית ל-1000 טוקנים
            },
            {
                headers: {
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const script = response.data.choices[0].message.content.trim();
        res.json({ script });
    } catch (error) {
        console.error('Error generating script:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to generate script.' });
    }
});

// נקודת קצה לשמירת יומן
app.post('/api/saveDiaryEntry', async (req, res) => {
    const { diaryEntry } = req.body;
    if (!diaryEntry) {
        return res.status(400).json({ error: 'No diary entry provided to save.' });
    }

    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '_');
    const filename = path.join(DIARY_DIR, `diary_${timestamp}.txt`);

    try {
        await fs.writeFile(filename, diaryEntry, 'utf8');
        res.status(200).json({ message: 'Diary entry saved successfully!', filename });
        console.log(`Diary entry saved to: ${filename}`);
    } catch (error) {
        console.error('Error saving diary entry:', error);
        res.status(500).json({ error: 'Failed to save diary entry.' });
    }
});

// נקודת קצה לשמירת תסריט
app.post('/api/saveScript', async (req, res) => {
    const { script } = req.body;
    if (!script) {
        return res.status(400).json({ error: 'No script provided to save.' });
    }

    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '_');
    const filename = path.join(SCRIPT_DIR, `script_${timestamp}.txt`);

    try {
        await fs.writeFile(filename, script, 'utf8');
        res.status(200).json({ message: 'Script saved successfully!', filename });
        console.log(`Script saved to: ${filename}`);
    } catch (error) {
        console.error('Error saving script:', error);
        res.status(500).json({ error: 'Failed to save script.' });
    }
});

// נקודת קצה לקבלת רשימת יומנים שמורים
app.get('/api/savedDiaries', async (req, res) => {
    try {
        const files = await fs.readdir(DIARY_DIR);
        const diaryFiles = files.filter(file => file.endsWith('.txt')).map(file => {
            const filePath = path.join(DIARY_DIR, file);
            return { name: file, path: `/api/diaryContent/${file}` };
        });
        res.json(diaryFiles);
    } catch (error) {
        console.error('Error listing saved diaries:', error);
        res.status(500).json({ error: 'Failed to retrieve saved diaries.' });
    }
});

// נקודת קצה לקבלת תוכן של יומן ספציפי
app.get('/api/diaryContent/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(DIARY_DIR, filename);
        const content = await fs.readFile(filePath, 'utf8');
        res.send(content);
    } catch (error) {
        console.error(`Error retrieving diary content for ${req.params.filename}:`, error);
        res.status(500).json({ error: 'Failed to retrieve diary content.' });
    }
});

// נקודת קצה לקבלת רשימת תסריטים שמורים
app.get('/api/savedScripts', async (req, res) => {
    try {
        const files = await fs.readdir(SCRIPT_DIR);
        const scriptFiles = files.filter(file => file.endsWith('.txt')).map(file => {
            const filePath = path.join(SCRIPT_DIR, file);
            return { name: file, path: `/api/scriptContent/${file}` };
        });
        res.json(scriptFiles);
    } catch (error) {
        console.error('Error listing saved scripts:', error);
        res.status(500).json({ error: 'Failed to retrieve saved scripts.' });
    }
});

// נקודת קצה לקבלת תוכן של תסריט ספציפי
app.get('/api/scriptContent/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(SCRIPT_DIR, filename);
        const content = await fs.readFile(filePath, 'utf8');
        res.send(content);
    } catch (error) {
        console.error(`Error retrieving script content for ${req.params.filename}:`, error);
        res.status(500).json({ error: 'Failed to retrieve script content.' });
    }
});

app.listen(PORT, () => {
    const isProduction = process.env.NODE_ENV === 'production';

    // הודעת הפעלה של השרת
    // תציג את localhost רק אם אינה בסביבת פרודקשן
    if (!isProduction) {
        console.log(`🚀 Personal Diary Script is running on: http://localhost:${PORT}`);
        console.log('💡 Remember to set OPENROUTER_API_KEY in your .env file for local development.');
        console.warn(`⚠️ Warning: HTTP-Referer is set to localhost. In a production environment, change APP_FRONTEND_URL in .env to your app's actual domain.`);
    } else {
        // בפריסה, נציג את ה-URL הציבורי שבו השרת באמת זמין
        console.log(`🚀 Personal Diary Script Backend is running.`);
        console.log(`==> Available at your primary URL ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`}`); // RENDER_EXTERNAL_URL הוא משתנה סביבה ש-Render מגדיר
    }
});