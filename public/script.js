/*
Copyright (c) 2025 adi alamo. All rights reserved.
This file and all related source code are the intellectual property of adi alamo.
Unauthorized copying, distribution, or use of this code or its concept is strictly prohibited.
For license details, see the LICENSE file in the project root.
Contact: adialamo@gmail.com
*/

// תרגומים לשפות שונות
const translations = {
    he: {
        appTitle: 'החיים כסרט',
        mainHeading: 'החיים כסרט',
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
        appTitle: 'Life as a Movie',
        mainHeading: 'Life as a Movie',
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
    const themeToggle = document.getElementById('theme-toggle');

    // בדיקת קיום אלמנטים קריטיים
    if (!appTitle || !mainHeading || !journalSectionHeading || !journalLabel || !journalEntry || !genreLabel || !generateButton || !loadingDiv || !errorDiv || !scriptOutput || !scriptOutputHeading || !langToggleHe || !langToggleEn || !saveScriptBtn || !saveStoryBtn || !themeToggle) {
        console.error('חסר אלמנט קריטי ב-HTML. ודא שכל ה-id-ים קיימים.');
        return;
    }

    // ז'אנרים עם אייקונים SVG (בהתאם לעיצוב המצורף)
    const genres = [
        { value: 'adventure', he: 'הרפתקאות', en: 'Adventure', icon: '🧭' },
        { value: 'comedy', he: 'קומדיה', en: 'Comedy', icon: '😂' },
        { value: 'drama', he: 'דרמה', en: 'Drama', icon: '🎭' },
        { value: 'sci-fi', he: 'מדע בדיוני', en: 'Sci-Fi', icon: '🤖' },
        { value: 'horror', he: 'אימה', en: 'Horror', icon: '👻' },
        { value: 'fantasy', he: 'פנטזיה', en: 'Fantasy', icon: '🧙‍♂️' },
        { value: 'romance', he: 'רומנטיקה', en: 'Romance', icon: '💖' },
        { value: 'action', he: 'פעולה', en: 'Action', icon: '💥' },
    ];
    let selectedGenre = genres[0].value;

    // כפתור המשך תסריט (רק אחרי currentLang)
    let currentLang = htmlElement.getAttribute('lang') || 'he';

    const continueScriptBtn = document.createElement('button');
    continueScriptBtn.type = 'button';
    continueScriptBtn.id = 'continue-script';
    continueScriptBtn.className = 'secondary-btn';
    continueScriptBtn.style.display = 'none';
    continueScriptBtn.textContent = translations[currentLang]?.continueScriptBtn || 'המשך תסריט';
    scriptOutput.parentNode.appendChild(continueScriptBtn);

    let lastScript = '';
    let continueUsed = false;

    // פונקציה ליצירת גריד ז'אנרים
    function renderGenreGrid(lang) {
        console.log('renderGenreGrid called with lang:', lang);
        const grid = document.getElementById('genre-carousel');
        if (!grid) {
            console.error('genre-carousel לא קיים ב-DOM!');
            return;
        }
        grid.innerHTML = '';
        genres.forEach(g => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'genre-btn';
            btn.dataset.value = g.value;
            btn.setAttribute('aria-label', g[lang]);
            btn.innerHTML = g.icon + `<span>${g[lang]}</span>`;
            if (g.value === selectedGenre) btn.classList.add('selected');
            btn.addEventListener('click', () => {
                selectedGenre = g.value;
                document.querySelectorAll('.genre-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            });
            grid.appendChild(btn);
        });
        console.log('סיום renderGenreGrid, כפתורים ב-grid:', grid.children.length);
    }

    // פונקציה לעדכון טקסטים לפי שפה
    function updateContent(lang) {
        console.log('updateContent called with lang:', lang);
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
        renderGenreGrid(lang);
    }

    // קביעת שפת ברירת המחדל
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

    // מאזין למצב כהה - תיקון סופי: תמיכה גם בכפתור עם אייקון/טקסט, סנכרון ראשוני מלא
    function setDarkMode(active, persist = true) {
        if (active) {
            document.documentElement.classList.add('dark');
            if (themeToggle) {
                themeToggle.innerHTML = '<span aria-hidden="true">☀️</span><span class="visually-hidden">מצב בהיר</span>';
                themeToggle.setAttribute('aria-label', 'מצב בהיר');
            }
            if (persist) localStorage.setItem('theme', 'dark');
        } else {
            document.documentElement.classList.remove('dark');
            if (themeToggle) {
                themeToggle.innerHTML = '<span aria-hidden="true">🌙</span><span class="visually-hidden">מצב כהה</span>';
                themeToggle.setAttribute('aria-label', 'מצב כהה');
            }
            if (persist) localStorage.setItem('theme', 'light');
        }
    }
    themeToggle.addEventListener('click', () => {
        setDarkMode(!document.documentElement.classList.contains('dark'));
    });
    // טעינה ראשונית: קודם localStorage, אם אין – לפי מערכת
    (function() {
        const userPref = localStorage.getItem('theme');
        const systemPref = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (userPref === 'dark' || (!userPref && systemPref)) {
            setDarkMode(true, false);
        } else {
            setDarkMode(false, false);
        }
    })();
    // עזר נגישות: מחלקה ל-visually-hidden
    (function() {
        if (!document.getElementById('visually-hidden-style')) {
            const style = document.createElement('style');
            style.id = 'visually-hidden-style';
            style.textContent = `.visually-hidden { position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; }`;
            document.head.appendChild(style);
        }
    })();

    // מאזין לשליחת הטופס
    document.getElementById('journal-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        console.log('submit event fired');
        const journalEntryValue = journalEntry.value.trim();
        const genre = selectedGenre;
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
                if (response.status === 429) {
                    throw new Error('המערכת עמוסה כרגע. נסה שוב בעוד מספר דקות.');
                }
                throw new Error(`${translations[currentLang].serverErrorPrefix}${response.status} - ${errorData.error || 'Unknown error'}`);
            }
            const data = await response.json();
            // === Professional Script Output ===
            let warningHtml = '';
            if (data.warning) {
                warningHtml = `<div class="script-warning" style="color:#b71c1c;font-weight:bold;background:#fff3f3;border:1.5px solid #b71c1c;padding:0.7em 1em;margin-bottom:0.7em;border-radius:8px;direction:rtl;text-align:right;">⚠️ ${data.warning}</div>`;
            }
            scriptOutput.innerHTML = warningHtml + `<pre class="script-professional">${(data.script || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').trim()}</pre>`;
            lastScript = data.script;
            continueUsed = false;
            showSaveScriptBtn(true);
            scriptOutputHeading.textContent = translations[currentLang].scriptOutputHeading;
            scriptOutputHeading.style.display = 'block';
            document.getElementById('result-card').style.display = 'block';
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

    // הסר את האלמנט הישן של בחירת ז'אנר (אם קיים)
    const oldGenreSelect = document.getElementById('genre-select');
    if (oldGenreSelect) oldGenreSelect.remove();
    const oldGenreRadios = document.querySelector('.genre-list');
    if (oldGenreRadios) oldGenreRadios.remove();

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
        document.getElementById('result-card').style.display = show ? 'block' : 'none';
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

    // ודא שחלון התסריט לא יגלוש ויהיה גלילה פנימית
    const scriptOutputStyle = document.createElement('style');
    scriptOutputStyle.textContent = `
    #script-output {
        max-width: 100%;
        max-height: 350px;
        overflow-x: auto;
        overflow-y: auto;
        background: #f7f7fa;
        border-radius: 10px;
        border: 1px solid #d1d1e0;
        margin: 0.5em 0 1em 0;
        padding: 1em 1.2em;
        font-size: 1.08em;
        white-space: pre-wrap;
        word-break: break-word;
        box-sizing: border-box;
        transition: box-shadow 0.2s;
        box-shadow: 0 2px 8px rgba(0,0,0,0.07);
    }
    #script-output pre {
        margin: 0;
        font-family: inherit;
        background: none;
        white-space: pre-wrap;
        word-break: break-word;
    }
    `;
    document.head.appendChild(scriptOutputStyle);

    // === Word Count Indicator ===
    const wordLimit = 300;
    const wordCountDiv = document.createElement('div');
    wordCountDiv.id = 'word-count-indicator';
    wordCountDiv.style.textAlign = 'left';
    wordCountDiv.style.fontSize = '0.98em';
    wordCountDiv.style.color = '#888';
    wordCountDiv.style.marginTop = '0.2em';
    if (journalEntry && journalEntry.parentNode) {
        journalEntry.parentNode.insertBefore(wordCountDiv, journalEntry.nextSibling);
    } else {
        console.error('journalEntry או הורה שלו לא קיימים ב-DOM. לא ניתן להוסיף word-count-indicator.');
    }
    // בדיקה עבור genreLabel
    if (!genreLabel) {
        console.error('genreLabel לא קיים ב-DOM. ודא שיש אלמנט עם id="genre-label" ב-HTML.');
    } else if (!genreLabel.parentNode) {
        console.error('genreLabel.parentNode הוא null. ייתכן שהאלמנט לא שובץ נכון ב-HTML.');
    }
    // אין גישה ל-genreLabel.parentNode מעבר לבדיקה זו!

    function updateWordCount() {
        const count = journalEntry.value.trim() ? journalEntry.value.trim().split(/\s+/).length : 0;
        wordCountDiv.textContent = `${count}/${wordLimit}`;
        if (count > wordLimit) {
            wordCountDiv.style.color = '#d32f2f';
        } else {
            wordCountDiv.style.color = '#888';
        }
    }
    journalEntry.addEventListener('input', updateWordCount);
    updateWordCount();

    // === Word Count Enforcement + Professional Feedback ===
    journalEntry.addEventListener('input', () => {
        const words = journalEntry.value.trim() ? journalEntry.value.trim().split(/\s+/) : [];
        if (words.length > wordLimit) {
            journalEntry.value = words.slice(0, wordLimit).join(' ');
            wordCountDiv.classList.add('word-limit-reached');
            wordCountDiv.textContent = `${wordLimit}/${wordLimit} (Limit reached)`;
            // רטט קל במכשירים תומכים
            if (window.navigator.vibrate) window.navigator.vibrate(80);
        } else {
            wordCountDiv.classList.remove('word-limit-reached');
            updateWordCount();
        }
    });

    // עיצוב מקצועי לאזהרת מגבלה
    const wordLimitStyle = document.createElement('style');
    wordLimitStyle.textContent = `
    #word-count-indicator.word-limit-reached {
      color: #d32f2f !important;
      font-weight: bold;
      animation: shake 0.18s 1;
    }
    @keyframes shake {
      0% { transform: translateX(0); }
      30% { transform: translateX(-4px); }
      60% { transform: translateX(4px); }
      100% { transform: translateX(0); }
    }
    `;
    document.head.appendChild(wordLimitStyle);

    // === Spinner Animation ===
    loadingDiv.innerHTML = '<span class="spinner"></span>' + translations[currentLang].loadingMessage;
    const spinnerStyle = document.createElement('style');
    spinnerStyle.textContent = `
    .spinner {
      display: inline-block;
      width: 1.1em;
      height: 1.1em;
      border: 3px solid #bdbdf7;
      border-top: 3px solid #5a5ad6;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-inline-end: 0.5em;
      vertical-align: middle;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    `;
    document.head.appendChild(spinnerStyle);

    // === Button Hover Effects ===
    const buttonHoverStyle = document.createElement('style');
    buttonHoverStyle.textContent = `
    button, .genre-select-btn {
      transition: background 0.18s, box-shadow 0.18s, color 0.18s;
    }
    button:hover, .genre-select-btn:hover {
      background: #e0e0f7 !important;
      color: #222;
      box-shadow: 0 2px 8px rgba(90,90,214,0.10);
    }
    #save-script:hover, #save-story:hover {
      background: #d1d1e0 !important;
    }
    `;
    document.head.appendChild(buttonHoverStyle);

    // Dark Mode Toggle
    function setDarkMode(active) {
        if (active) {
            document.documentElement.classList.add('dark');
            themeToggle.innerHTML = '☀️';
            themeToggle.setAttribute('aria-label', 'מצב בהיר');
        } else {
            document.documentElement.classList.remove('dark');
            themeToggle.innerHTML = '🌙';
            themeToggle.setAttribute('aria-label', 'מצב כהה');
        }
    }
    themeToggle.addEventListener('click', () => {
        setDarkMode(!document.documentElement.classList.contains('dark'));
    });
    // טעינה ראשונית: קודם localStorage, אם אין – לפי מערכת
    (function() {
        const userPref = localStorage.getItem('theme');
        const systemPref = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (userPref === 'dark' || (!userPref && systemPref)) {
            setDarkMode(true, false);
        } else {
            setDarkMode(false, false);
        }
    })();

    // נגישות: פוקוס אוטומטי על תיבת תסריט כשיש תוצאה
    const observer = new MutationObserver(() => {
        if (scriptOutput.textContent.trim().length > 0) {
            scriptOutput.setAttribute('tabindex', '0');
            scriptOutput.focus();
        }
    });
    observer.observe(scriptOutput, { childList: true });

    // Tooltip לכל כפתור פעולה
    document.querySelectorAll('.result-actions button').forEach(btn => {
        btn.addEventListener('focus', function() {
            this.classList.add('show-tooltip');
        });
        btn.addEventListener('blur', function() {
            this.classList.remove('show-tooltip');
        });
    });

    // DEBUG: Log themeToggle and add fallback click handler
    console.log('themeToggle:', themeToggle);
    if (!themeToggle) {
        alert('כפתור מצב כהה (theme-toggle) לא נמצא ב-DOM!');
    } else {
        themeToggle.addEventListener('click', () => {
            console.log('Night mode button clicked!');
            setDarkMode(!document.documentElement.classList.contains('dark'));
        });
    }
});