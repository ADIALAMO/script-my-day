// תרגומים לשפות שונות
const translations = {
    he: {
        appTitle: 'יומני היקר, תסרט לי את חיי',
        mainHeading: 'יומני היקר, תסרט לי את חיי',
        subtitle: 'ספר לי מה עבר עליך היום ואת השאר תשאיר לי',
        journalSectionHeading: 'כתוב את היומן שלך',
        journalLabel: 'רשומה יומית:',
        journalPlaceholder: 'כתוב כאן את הרשומה היומית שלך...',
        genreLabel: 'בחר ז\'אנר קומיקס:',
        generateButton: 'צור תסריט',
        loadingMessage: 'טוען...',
        errorMessagePrefix: 'שגיאה: ',
        missingFieldsError: 'אנא מלא את כל השדות.',
        serverErrorPrefix: 'שגיאת שרת: ',
        scriptOutputHeading: 'התסריט שלך:',
        langHebrew: 'עברית',
        langEnglish: 'English',
        continueScriptBtn: 'המשך תסריט',
        saveScriptBtn: 'שמור תסריט',
        saveStoryBtn: 'שמור סיפור'
    },
    en: {
        appTitle: 'Dear Diary, Script My Life',
        mainHeading: 'Dear Diary, Script My Life',
        subtitle: 'Tell me about your day, and I’ll do the rest',
        journalSectionHeading: 'Write Your Journal Entry',
        journalLabel: 'Journal Entry:',
        journalPlaceholder: 'Write your daily entry here...',
        genreLabel: 'Select Comic Genre:',
        generateButton: 'Generate Script',
        loadingMessage: 'Loading...',
        errorMessagePrefix: 'Error: ',
        missingFieldsError: 'Please fill in all fields.',
        serverErrorPrefix: 'Server error: ',
        scriptOutputHeading: 'Your Script:',
        langHebrew: 'עברית',
        langEnglish: 'English',
        continueScriptBtn: 'Continue Script',
        saveScriptBtn: 'Save Script',
        saveStoryBtn: 'Save Story'
    }
};

let currentLang; // הגדרה גלובלית בלבד

document.addEventListener('DOMContentLoaded', () => {
    // אלמנטים ב-DOM
    const appTitle = document.getElementById('app-title');
    const mainHeading = document.getElementById('main-heading');
    const journalSectionHeading = document.getElementById('journal-section-heading');
    const journalLabel = document.getElementById('journal-label');
    const journalEntry = document.getElementById('journal-entry');
    const genreLabel = document.getElementById('genre-label');
    const generateButton = document.getElementById('generate-button');
    const loadingDiv = document.getElementById('loading');
    const errorDiv = document.getElementById('error');
    const scriptOutput = document.getElementById('script-output');
    const scriptOutputHeading = document.getElementById('script-output-heading');
    const langToggleHe = document.getElementById('lang-toggle-he');
    const langToggleEn = document.getElementById('lang-toggle-en');
    const htmlElement = document.documentElement;
    const subtitle = document.getElementById('subtitle');
    const saveScriptBtn = document.getElementById('save-script');
    const saveStoryBtn = document.getElementById('save-story');

    // ז'אנרים - מיפוי לערכים ולתרגום
    const genres = [
        { value: 'adventure', he: 'הרפתקאות', en: 'Adventure' },
        { value: 'comedy', he: 'קומדיה', en: 'Comedy' },
        { value: 'drama', he: 'דרמה', en: 'Drama' },
        { value: 'sci-fi', he: 'מדע בדיוני', en: 'Sci-Fi' },
        { value: 'horror', he: 'אימה', en: 'Horror' },
        { value: 'fantasy', he: 'פנטזיה', en: 'Fantasy' },
        { value: 'romance', he: 'רומנטיקה', en: 'Romance' },
        { value: 'action', he: 'פעולה', en: 'Action' },
        { value: 'mystery', he: 'מסתורין', en: 'Mystery' }
    ];

    // עדכון בחירת ז'אנר לרדיו
    const genreRadios = document.querySelectorAll('input[name="genre"]');
    function getSelectedGenre() {
        return genreSelect.value;
    }
    // עדכון טקסטים של אפשרויות הז'אנר (רדיו) כולל ערך value
    function updateGenreRadios(lang) {
        const genreRadioLabels = document.querySelectorAll('.genre-list label');
        const genreRadioValues = [
            'adventure', 'comedy', 'drama', 'sci-fi', 'horror', 'fantasy', 'romance', 'action', 'mystery'
        ];
        genreRadioLabels.forEach((label, i) => {
            const value = genreRadioValues[i];
            const input = label.querySelector('input');
            if (input && value) {
                input.value = value;
                // עדכון טקסט בלבד
                label.lastChild.nodeValue = ' ' + translations[lang][value.replace('-', '')];
            }
        });
    }

    // יצירת select דינמי לז'אנרים
    const genreSelect = document.createElement('select');
    genreSelect.id = 'genre-select';
    genreSelect.required = true;
    genreSelect.className = 'genre-select';
    function renderGenreOptions(lang) {
        genreSelect.innerHTML = '';
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.disabled = true;
        defaultOption.selected = true;
        defaultOption.hidden = true;
        defaultOption.textContent = lang === 'he' ? 'בחר ז׳אנר' : 'Select Genre';
        genreSelect.appendChild(defaultOption);
        genres.forEach(g => {
            const opt = document.createElement('option');
            opt.value = g.value;
            opt.textContent = g[lang];
            genreSelect.appendChild(opt);
        });
    }

    // כפתור המשך תסריט
    const continueScriptBtn = document.createElement('button');
    continueScriptBtn.type = 'button';
    continueScriptBtn.id = 'continue-script';
    continueScriptBtn.className = 'secondary-btn';
    continueScriptBtn.style.display = 'none';
    continueScriptBtn.textContent = translations[currentLang]?.continueScriptBtn || 'המשך תסריט';
    scriptOutput.parentNode.appendChild(continueScriptBtn);

    let lastScript = '';
    let continueUsed = false;

    // פונקציה לעדכון טקסטים לפי שפה
    function updateContent(lang) {
        appTitle.textContent = translations[lang].appTitle;
        mainHeading.textContent = translations[lang].mainHeading;
        if (subtitle) subtitle.textContent = translations[lang].subtitle;
        journalSectionHeading.textContent = translations[lang].journalSectionHeading;
        journalLabel.textContent = translations[lang].journalLabel;
        journalEntry.placeholder = translations[lang].journalPlaceholder;
        genreLabel.textContent = translations[lang].genreLabel;
        generateButton.textContent = translations[lang].generateButton;
        loadingDiv.textContent = translations[lang].loadingMessage;
        if (scriptOutputHeading.style.display !== 'none') {
            scriptOutputHeading.textContent = translations[lang].scriptOutputHeading;
        }
        langToggleHe.textContent = translations[lang].langHebrew;
        langToggleEn.textContent = translations[lang].langEnglish;
        continueScriptBtn.textContent = translations[lang].continueScriptBtn;
        renderGenreOptions(lang);
        // עדכון כפתורי שמירה
        saveScriptBtn.textContent = translations[lang].saveScriptBtn || (lang === 'he' ? 'שמור תסריט' : 'Save Script');
        saveStoryBtn.textContent = translations[lang].saveStoryBtn || (lang === 'he' ? 'שמור סיפור' : 'Save Story');
        if (lang === 'he') {
            htmlElement.setAttribute('lang', 'he');
            htmlElement.setAttribute('dir', 'rtl');
            document.body.style.textAlign = 'right';
        } else {
            htmlElement.setAttribute('lang', 'en');
            htmlElement.setAttribute('dir', 'ltr');
            document.body.style.textAlign = 'left';
        }
        langToggleHe.classList.toggle('active', lang === 'he');
        langToggleEn.classList.toggle('active', lang === 'en');
    }

    // קביעת שפת ברירת המחדל
    currentLang = htmlElement.getAttribute('lang') || 'he';
    updateContent(currentLang);

    // הוספת מאזינים לכפתורי השפה
    langToggleHe.addEventListener('click', () => {
        currentLang = 'he';
        updateContent('he');
    });
    langToggleEn.addEventListener('click', () => {
        currentLang = 'en';
        updateContent('en');
    });

    // מאזין לשליחת הטופס
    document.getElementById('journal-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        console.log('submit event fired');
        const journalEntryValue = journalEntry.value.trim();
        const genre = getSelectedGenre();
        if (!journalEntryValue || !genre) {
            errorDiv.style.display = 'block';
            errorDiv.textContent = translations[currentLang].missingFieldsError;
            return;
        }
        errorDiv.style.display = 'none';
        scriptOutput.textContent = '';
        scriptOutputHeading.style.display = 'none';
        loadingDiv.style.display = 'block';
        try {
            const response = await fetch('/api/generateScript', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ journalEntry: journalEntryValue, genre })
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`${translations[currentLang].serverErrorPrefix}${response.status} - ${errorData.error || 'Unknown error'}`);
            }
            const data = await response.json();
            scriptOutput.innerHTML = `<pre>${data.script}</pre>`;
            lastScript = data.script;
            continueUsed = false;
            showSaveScriptBtn(true);
            scriptOutputHeading.textContent = translations[currentLang].scriptOutputHeading;
            scriptOutputHeading.style.display = 'block';
            continueScriptBtn.style.display = 'inline-block';
            continueScriptBtn.disabled = false;
        } catch (err) {
            errorDiv.style.display = 'block';
            errorDiv.textContent = `${translations[currentLang].errorMessagePrefix}${err.message}`;
        } finally {
            loadingDiv.style.display = 'none';
        }
    });

    // הסר את כפתור המשך תסריט מה-DOM
    if (document.getElementById('continue-script')) {
        document.getElementById('continue-script').remove();
    }

    // כפתור שמירת תסריט
    saveScriptBtn.addEventListener('click', () => {
        const script = scriptOutput.textContent;
        if (!script) return;
        const blob = new Blob([script], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'comic-script.txt';
        a.click();
    });

    // הצג כפתור שמירה רק אם יש תסריט
    function showSaveScriptBtn(show) {
        saveScriptBtn.style.display = show ? 'inline-block' : 'none';
    }

    // כפתור שמירת סיפור
    saveStoryBtn.addEventListener('click', () => {
        const story = journalEntry.value.trim();
        if (!story) return;
        const blob = new Blob([story], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'my-story.txt';
        a.click();
    });

    // הסתר כפתור שמירה אם אין תסריט
    scriptOutput.textContent = '';
    showSaveScriptBtn(false);
});