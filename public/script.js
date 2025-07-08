// תרגומים לשפות שונות
const translations = {
    he: {
        appTitle: 'יומן חיים - מחולל תסריטי קומיקס',
        mainHeading: 'יומן חיים - מחולל תסריטי קומיקס',
        journalSectionHeading: 'כתוב את היומן שלך',
        journalLabel: 'רשומה יומית:',
        journalPlaceholder: 'כתוב כאן את הרשומה היומית שלך...',
        genreLabel: 'בחר ז\'אנר קומיקס:',
        selectGenreOption: 'בחר ז\'אנר',
        adventure: 'הרפתקאות',
        comedy: 'קומדיה',
        drama: 'דרמה',
        sciFi: 'מדע בדיוני',
        generateButton: 'צור תסריט',
        loadingMessage: 'טוען...',
        errorMessagePrefix: 'שגיאה: ',
        missingFieldsError: 'אנא מלא את כל השדות.',
        serverErrorPrefix: 'שגיאת שרת: ',
        scriptOutputHeading: 'התסריט שלך:',
        langHebrew: 'עברית',
        langEnglish: 'English'
    },
    en: {
        appTitle: 'Life Journal - Comic Script Generator',
        mainHeading: 'Life Journal - Comic Script Generator',
        journalSectionHeading: 'Write Your Journal Entry',
        journalLabel: 'Journal Entry:',
        journalPlaceholder: 'Write your daily entry here...',
        genreLabel: 'Select Comic Genre:',
        selectGenreOption: 'Select a genre',
        adventure: 'Adventure',
        comedy: 'Comedy',
        drama: 'Drama',
        sciFi: 'Sci-Fi',
        generateButton: 'Generate Script',
        loadingMessage: 'Loading...',
        errorMessagePrefix: 'Error: ',
        missingFieldsError: 'Please fill in all fields.',
        serverErrorPrefix: 'Server error: ',
        scriptOutputHeading: 'Your Script:',
        langHebrew: 'עברית',
        langEnglish: 'English'
    }
};

// אלמנטים ב-DOM
const appTitle = document.getElementById('app-title');
const mainHeading = document.getElementById('main-heading');
const journalSectionHeading = document.getElementById('journal-section-heading');
const journalLabel = document.getElementById('journal-label');
const journalEntry = document.getElementById('journal-entry');
const genreLabel = document.getElementById('genre-label');
const selectGenreOption = document.getElementById('select-genre-option');
const genreSelect = document.getElementById('genre');
const generateButton = document.getElementById('generate-button');
const loadingDiv = document.getElementById('loading');
const errorDiv = document.getElementById('error');
const scriptOutput = document.getElementById('script-output');
const scriptOutputHeading = document.getElementById('script-output-heading');
const langToggleHe = document.getElementById('lang-toggle-he');
const langToggleEn = document.getElementById('lang-toggle-en');
const htmlElement = document.documentElement; // אלמנט ה-html כולו

// פונקציה לעדכון טקסטים לפי שפה
function updateContent(lang) {
    appTitle.textContent = translations[lang].appTitle;
    mainHeading.textContent = translations[lang].mainHeading;
    journalSectionHeading.textContent = translations[lang].journalSectionHeading;
    journalLabel.textContent = translations[lang].journalLabel;
    journalEntry.placeholder = translations[lang].journalPlaceholder;
    genreLabel.textContent = translations[lang].genreLabel;
    selectGenreOption.textContent = translations[lang].selectGenreOption;
    generateButton.textContent = translations[lang].generateButton;
    loadingDiv.textContent = translations[lang].loadingMessage;
    // עדכון כותרת התסריט רק אם היא מוצגת
    if (scriptOutputHeading.style.display !== 'none') {
        scriptOutputHeading.textContent = translations[lang].scriptOutputHeading;
    }
    langToggleHe.textContent = translations[lang].langHebrew;
    langToggleEn.textContent = translations[lang].langEnglish;

    // עדכון טקסטים של אפשרויות הז'אנר
    Array.from(genreSelect.options).forEach(option => {
        if (option.value) { // לדלג על האפשרות הריקה (בחר ז'אנר)
            option.textContent = translations[lang][option.value.replace('-', '')]; // adventure -> adventure, sci-fi -> sciFi
        }
    });

    // עדכון כיווניות (RTL/LTR)
    if (lang === 'he') {
        htmlElement.setAttribute('lang', 'he');
        htmlElement.setAttribute('dir', 'rtl');
        document.body.style.textAlign = 'right'; // ליתר ביטחון
    } else {
        htmlElement.setAttribute('lang', 'en');
        htmlElement.setAttribute('dir', 'ltr');
        document.body.style.textAlign = 'left'; // ליתר ביטחון
    }

    // עדכון כפתורי בחירת השפה
    langToggleHe.classList.toggle('active', lang === 'he');
    langToggleEn.classList.toggle('active', lang === 'en');
}

// קביעת שפת ברירת המחדל
let currentLang = htmlElement.getAttribute('lang') || 'he';
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

    const journalEntryValue = journalEntry.value.trim();
    const genre = genreSelect.value;

    // אימות קלט
    if (!journalEntryValue || !genre) {
        errorDiv.style.display = 'block';
        errorDiv.textContent = translations[currentLang].missingFieldsError;
        return;
    }

    // איפוס ממשק
    errorDiv.style.display = 'none';
    scriptOutput.textContent = '';
    scriptOutputHeading.style.display = 'none'; // הסתר כותרת התסריט כשהוא טוען
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
        // הצגת התסריט בתוך תג <pre> לשמירה על עיצוב
        scriptOutput.innerHTML = `<pre>${data.script}</pre>`;
        scriptOutputHeading.textContent = translations[currentLang].scriptOutputHeading; // עדכן את כותרת התסריט
        scriptOutputHeading.style.display = 'block'; // הצג את כותרת התסריט
    } catch (err) {
        errorDiv.style.display = 'block';
        errorDiv.textContent = `${translations[currentLang].errorMessagePrefix}${err.message}`;
    } finally {
        loadingDiv.style.display = 'none';
    }
});