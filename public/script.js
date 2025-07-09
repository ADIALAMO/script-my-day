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

    // יצירת כפתור בחירת ז'אנר וחלונית (modal) לבחירה
    const genreSelectBtn = document.createElement('button');
    genreSelectBtn.id = 'genre-select-btn';
    genreSelectBtn.type = 'button';
    genreSelectBtn.className = 'genre-select-btn';
    genreSelectBtn.textContent = translations[currentLang]?.genreLabel || 'בחר ז\'אנר קומיקס:';
    genreLabel.parentNode.insertBefore(genreSelectBtn, genreLabel.nextSibling);

    // יצירת modal
    const genreModal = document.createElement('div');
    genreModal.id = 'genre-modal';
    genreModal.className = 'genre-modal';
    genreModal.style.display = 'none';
    genreModal.innerHTML = `
        <div class="genre-modal-content">
            <span class="genre-modal-close">&times;</span>
            <h3 id="genre-modal-title"></h3>
            <ul id="genre-modal-list" class="genre-modal-list"></ul>
        </div>
    `;
    document.body.appendChild(genreModal);
    const genreModalTitle = genreModal.querySelector('#genre-modal-title');
    const genreModalList = genreModal.querySelector('#genre-modal-list');
    const genreModalClose = genreModal.querySelector('.genre-modal-close');

    let selectedGenre = '';

    // פונקציה לעדכון רשימת הז'אנרים במודל
    function renderGenreModalOptions(lang) {
        genreModalList.innerHTML = '';
        genres.forEach(g => {
            const li = document.createElement('li');
            li.className = 'genre-modal-item';
            li.dataset.value = g.value;
            li.textContent = g[lang];
            if (g.value === selectedGenre) li.classList.add('selected');
            li.addEventListener('click', () => {
                selectedGenre = g.value;
                genreSelectBtn.textContent = g[lang];
                genreModal.style.display = 'none';
            });
            genreModalList.appendChild(li);
        });
    }

    // פותח את המודל
    genreSelectBtn.addEventListener('click', () => {
        genreModal.style.display = 'block';
        renderGenreModalOptions(currentLang);
        genreModalTitle.textContent = translations[currentLang].genreLabel;
    });
    // סגירת המודל
    genreModalClose.addEventListener('click', () => {
        genreModal.style.display = 'none';
    });
    window.addEventListener('click', (e) => {
        if (e.target === genreModal) genreModal.style.display = 'none';
    });

    // מחזיר את הז'אנר הנבחר
    function getSelectedGenre() {
        return selectedGenre;
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
        genreSelectBtn.textContent = selectedGenre
            ? genres.find(g => g.value === selectedGenre)[lang]
            : translations[lang].genreLabel;
        renderGenreModalOptions(lang); // <-- עדכון הז'אנרים בשפה הנכונה
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

    // הסר קוד ישן של רדיו/רשימת ז'אנרים

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

    // הסתרת כפתור שמירה אם אין תסריט
    scriptOutput.textContent = '';
    showSaveScriptBtn(false);

    // CSS בסיסי לחלונית (modal) ולכפתור
    const modalStyle = document.createElement('style');
    modalStyle.textContent = `
    .genre-select-btn {
        padding: 0.5em 1.2em;
        font-size: 1em;
        border-radius: 8px;
        border: 1px solid #888;
        background: #f7f7fa;
        cursor: pointer;
        margin-bottom: 1em;
        margin-top: 0.5em;
        transition: background 0.2s;
    }
    .genre-select-btn:hover {
        background: #e0e0f7;
    }
    .genre-modal {
        display: none;
        position: fixed;
        z-index: 1000;
        left: 0; top: 0; width: 100vw; height: 100vh;
        background: rgba(0,0,0,0.3);
        justify-content: center;
        align-items: center;
    }
    .genre-modal-content {
        background: #fff;
        margin: 10vh auto;
        padding: 2em 1.5em 1.5em 1.5em;
        border-radius: 12px;
        max-width: 350px;
        box-shadow: 0 2px 16px rgba(0,0,0,0.18);
        position: relative;
        text-align: center;
    }
    .genre-modal-close {
        position: absolute;
        top: 0.7em; right: 1em;
        font-size: 1.5em;
        color: #888;
        cursor: pointer;
    }
    .genre-modal-list {
        list-style: none;
        padding: 0;
        margin: 1em 0 0 0;
    }
    .genre-modal-item {
        padding: 0.6em 0.5em;
        margin: 0.2em 0;
        border-radius: 6px;
        cursor: pointer;
        font-size: 1.08em;
        transition: background 0.15s;
    }
    .genre-modal-item.selected, .genre-modal-item:hover {
        background: #e0e0f7;
        font-weight: bold;
    }
    `;
    document.head.appendChild(modalStyle);
});