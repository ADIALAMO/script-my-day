const translations = {
    he: {
        app_title: "יומן חיים 🎬 - תסריט מהיום שלי",
        language_selector_label: "שפה:",
        main_title: "✍️ יומן החיים שלי בראי הקומיקס",
        diary_label: "מה קרה היום? רשום כאן את מחשבותיך/חוויותיך:",
        diary_placeholder: "לדוגמה: היום הכלב שלי אכל את שיעורי הבית, ואז פגשתי חייזר עם שלוש עיניים בחנות מכולת...",
        genre_label: "בחר ז'אנר לתסריט",
        genre_comedy: "קומדיה",
        genre_drama: "דרמה",
        genre_fantasy: "פנטזיה",
        genre_scifi: "מדע בדיוני",
        genre_adventure: "הרפתקאות",
        genre_action: "פעולה",
        genre_slice_of_life: "פרוסת חיים (פרוזאי)",
        generate_script_button: "הפוך לסיפור קומיקס!",
        save_diary_button: "שמור יומן",
        save_script_button: "שמור תסריט",
        show_saved_button: "הצג שמורים",
        close_button: "סגור",
        script_output_title: "התסריט של היום שלך:",
        script_placeholder: "התסריט יופיע כאן לאחר יצירתו.",
        loading_message_script: "הופך את היומן לתסריט קומיקס... בבקשה המתן",
        saving_diary_message: "שומר את היומן...",
        saving_script_message: "שומר את התסריט...",
        success_diary_saved: "היומן נשמר בהצלחה!",
        success_script_saved: "התסריט נשמר בהצלחה!",
        error_enter_diary: "אנא הזן משהו מהיומן שלך.",
        error_select_genre: "אנא בחר ז'אנר.",
        error_script_creation_failed: "אירעה שגיאה ביצירת התסריט מהיומן.",
        error_unknown_server: "שגיאה לא ידועה מהשרת. נסה שוב מאוחר יותר.",
        error_connection_server: "שגיאת תקשורת עם השרת. אנא בדוק את חיבור האינטרנט שלך ונסה שוב.",
        error_saving_diary: "אירעה שגיאה בשמירת היומן.",
        error_saving_script: "אירעה שגיאה בשמירת התסריט.",
        saved_files_title: "יומנים ותסריטים שמורים:",
        saved_diaries_list_title: "יומנים:",
        saved_scripts_list_title: "תסריטים:",
        view_button: "הצג",
        error_fetching_saved_files: "אירעה שגיאה באחזור קבצים שמורים.",
        error_fetching_file_content: "אירעה שגיאה באחזור תוכן קובץ.",
        loading_message_fetching_diaries: "טוען יומנים שמורים...",
        loading_message_fetching_scripts: "טוען תסריטים שמורים...",
        loading_message_fetching_content: "טוען תוכן קובץ...",
        no_diaries_saved: "אין יומנים שמורים.",
        no_scripts_saved: "אין תסריטים שמורים.",
        word_count: "{} מילים" // הסוגריים המסולסלים ישמשו למילוי המספר
    },
    en: {
        app_title: "My Life Diary 🎬 - Script from My Day",
        language_selector_label: "Language:",
        main_title: "✍️ My Life Diary in Comic Form",
        diary_label: "What happened today? Write your thoughts/experiences here:",
        diary_placeholder: "Example: Today my dog ate my homework, then I met a three-eyed alien at the grocery store...",
        genre_label: "Choose a Genre for the Script",
        genre_comedy: "Comedy",
        genre_drama: "Drama",
        genre_fantasy: "Fantasy",
        genre_scifi: "Science Fiction",
        genre_adventure: "Adventure",
        genre_action: "Action",
        genre_slice_of_life: "Slice of Life",
        generate_script_button: "Turn into a Comic Story!",
        save_diary_button: "Save Diary",
        save_script_button: "Save Script",
        show_saved_button: "Show Saved",
        close_button: "Close",
        script_output_title: "Today's Script:",
        script_placeholder: "The script will appear here after it's generated.",
        loading_message_script: "Turning your diary into a comic script... Please wait",
        saving_diary_message: "Saving diary entry...",
        saving_script_message: "Saving script...",
        success_diary_saved: "Diary entry saved successfully!",
        success_script_saved: "Script saved successfully!",
        error_enter_diary: "Please enter something from your diary.",
        error_select_genre: "Please select a genre.",
        error_script_creation_failed: "An error occurred while creating the script from your diary.",
        error_unknown_server: "Unknown server error. Please try again later.",
        error_connection_server: "Communication error with the server. Please check your internet connection and try again.",
        error_saving_diary: "An error occurred while saving the diary entry.",
        error_saving_script: "An error occurred while saving the script.",
        saved_files_title: "Saved Diaries and Scripts:",
        saved_diaries_list_title: "Diaries:",
        saved_scripts_list_title: "Scripts:",
        view_button: "View",
        error_fetching_saved_files: "An error occurred fetching saved files.",
        error_fetching_file_content: "An error occurred fetching file content.",
        loading_message_fetching_diaries: "Loading saved diaries...",
        loading_message_fetching_scripts: "Loading saved scripts...",
        loading_message_fetching_content: "Loading file content...",
        no_diaries_saved: "No diaries saved.",
        no_scripts_saved: "No scripts saved.",
        word_count: "{} words"
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const languageSelect = document.getElementById("languageSelect");
    const diaryEntryInput = document.getElementById("diaryEntry");
    const genreSelect = document.getElementById("genre");
    const generateButton = document.getElementById("generateButton");
    const saveDiaryButton = document.getElementById("saveDiaryButton");
    const saveScriptButton = document.getElementById("saveScriptButton");
    const scriptOutput = document.getElementById("scriptOutput");
    const loadingMessage = document.getElementById("loadingMessage");
    const errorMessage = document.getElementById("errorMessage");
    const successMessage = document.getElementById("successMessage");
    const scriptOutputContainer = document.getElementById("resultContainer");

    const showSavedButton = document.getElementById("showSavedButton");
    const savedFilesContainer = document.getElementById("savedFilesContainer");
    const closeSavedFilesButton = document.getElementById("closeSavedFiles");
    const diariesList = document.getElementById("diariesList");
    const scriptsList = document.getElementById("scriptsList");
    const savedContentDisplay = document.getElementById("savedContentDisplay");
    const savedContentTitle = document.getElementById("savedContentTitle");
    const savedContentText = document.getElementById("savedContentText");
    const closeContentDisplayButton = document.getElementById("closeContentDisplay");

    const diaryWordCount = document.getElementById("diaryWordCount");
    const scriptWordCount = document.getElementById("scriptWordCount");


    const BASE_API_URL = window.location.origin;

    // Direct reference to the Netlify function path for generation
    const API_GENERATE_SCRIPT_URL = `${BASE_API_URL}/.netlify/functions/generateScript`; 
    
    // Consistent direct references to Netlify function paths for saving
    const API_SAVE_DIARY_URL = `${BASE_API_URL}/.netlify/functions/saveDiaryEntry`; // Changed for consistency
    const API_SAVE_SCRIPT_URL = `${BASE_API_URL}/.netlify/functions/saveScript`;   // Changed for consistency


    let currentLang = localStorage.getItem('appLanguage') || 'he';
    let currentDiaryEntry = "";
    let currentScript = "";

    function setLanguage(lang) {
        currentLang = lang;
        localStorage.setItem('appLanguage', lang);
        applyTranslations();
        document.documentElement.lang = lang;
        languageSelect.value = lang;
    }

    function applyTranslations() {
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            if (translations[currentLang] && translations[currentLang][key]) {
                element.textContent = translations[currentLang][key];
            }
        });

        document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
            const key = element.getAttribute('data-i18n-placeholder');
            if (translations[currentLang] && translations[currentLang][key]) {
                element.placeholder = translations[currentLang][key];
            }
        });

        document.querySelectorAll('#genre option').forEach(option => {
            const originalValue = option.value;
            const key = option.getAttribute('data-i18n');
            if (translations[currentLang] && translations[currentLang][key]) {
                option.textContent = translations[currentLang][key];
            } else if (originalValue === "") {
                option.textContent = translations[currentLang].genre_label.replace("בחר ז'אנר לתסריט", "-- בחר ז'אנר --");
            }
            option.value = originalValue;
        });

        const initialScriptPlaceholderHebrew = "התסריט יופיע כאן לאחר יצירתו.";
        const initialScriptPlaceholderEnglish = "The script will appear here after generation.";
        if (scriptOutput.value.trim() === initialScriptPlaceholderHebrew || 
            scriptOutput.value.trim() === initialScriptPlaceholderEnglish || 
            scriptOutput.value.trim() === "") { 
            scriptOutput.value = translations[currentLang].script_placeholder; 
        }
        updateWordCount(diaryEntryInput, diaryWordCount);
        updateWordCount(scriptOutput, scriptWordCount);
    }

    setLanguage(currentLang);
    updateWordCount(diaryEntryInput, diaryWordCount);
    updateWordCount(scriptOutput, scriptWordCount); 

    languageSelect.addEventListener('change', (event) => {
        setLanguage(event.target.value);
    });

    function clearStatusMessages() {
        loadingMessage.style.display = "none";
        errorMessage.style.display = "none";
        successMessage.style.display = "none";
        errorMessage.textContent = "";
        successMessage.textContent = "";
    }

    function showLoadingMessage(messageKey) {
        loadingMessage.textContent = translations[currentLang][messageKey];
        loadingMessage.style.display = "block";
    }

    function showErrorMessage(messageKey, fallback = '') {
        errorMessage.textContent = translations[currentLang][messageKey] || fallback;
        errorMessage.style.display = "block";
    }

    function showSuccessMessage(messageKey) {
        successMessage.textContent = translations[currentLang][messageKey];
        successMessage.style.display = "block";
        setTimeout(() => {
            successMessage.style.display = "none";
        }, 3000);
    }

    function disableSaveButtons() {
        saveDiaryButton.disabled = true;
        saveScriptButton.disabled = true;
    }

    function enableSaveButtons() {
        saveDiaryButton.disabled = !currentDiaryEntry;
        saveScriptButton.disabled = !currentScript;
    }

    function updateWordCount(textareaElement, countElement) {
        const text = textareaElement.value.trim();
        const words = text ? text.split(/\s+/).filter(word => word.length > 0).length : 0;
        countElement.textContent = translations[currentLang].word_count.replace("{}", words);
    }

    disableSaveButtons();

    // Generic function to fetch and display saved files
    async function fetchAndDisplayFiles(type, listElement) {
        clearStatusMessages();
        listElement.innerHTML = ''; 
        showLoadingMessage(`loading_message_fetching_${type}`);

        try {
            // Adjust API URL for fetching saved files (assuming these are separate Netlify functions or static files)
            const apiPath = type === 'diaries' ? '/.netlify/functions/getSavedDiaries' : '/.netlify/functions/getSavedScripts'; 
            const response = await fetch(`${BASE_API_URL}${apiPath}`); 
            const files = await response.json();

            if (response.ok) {
                if (files.length === 0) {
                    listElement.innerHTML = `<p data-i18n="no_${type}_saved">אין ${type === 'diaries' ? 'יומנים' : 'תסריטים'} שמורים.</p>`;
                    applyTranslations();
                } else {
                    files.forEach(file => {
                        const li = document.createElement('li');
                        const fileNameSpan = document.createElement('span');
                        const displayFileName = file.name.replace(/(diary_|script_)/, '').replace(/\.txt$/, '').split('T')[0]; 
                        fileNameSpan.textContent = displayFileName;

                        const viewButton = document.createElement('button');
                        viewButton.textContent = translations[currentLang].view_button;
                        viewButton.classList.add('save-button');
                        viewButton.onclick = () => fetchFileContent(file.path, file.name);

                        li.appendChild(fileNameSpan);
                        li.appendChild(viewButton);
                        listElement.appendChild(li);
                    });
                    applyTranslations();
                }
            } else {
                showErrorMessage('error_fetching_saved_files', files.error);
            }
        } catch (error) {
            console.error(`Error fetching saved ${type}:`, error);
            showErrorMessage('error_connection_server');
        } finally {
            loadingMessage.style.display = "none";
        }
    }

    // Function to display file content
    async function fetchFileContent(filePath, fileName) {
        clearStatusMessages();
        showLoadingMessage('loading_message_fetching_content');
        savedContentDisplay.style.display = 'none';

        try {
            const response = await fetch(filePath);
            const content = await response.text();

            if (response.ok) {
                savedContentTitle.textContent = fileName;
                savedContentText.textContent = content;
                savedContentDisplay.style.display = 'block';
                savedFilesContainer.scrollTop = savedContentDisplay.offsetTop;
            } else {
                showErrorMessage('error_fetching_file_content', content);
            }
        } catch (error) {
            console.error("Error fetching file content:", error);
            showErrorMessage('error_connection_server');
        } finally {
            loadingMessage.style.display = "none";
        }
    }


    generateButton.addEventListener("click", async () => {
        clearStatusMessages();
        scriptOutput.value = translations[currentLang].script_placeholder;
        updateWordCount(scriptOutput, scriptWordCount);
        scriptOutputContainer.style.display = 'none';
        disableSaveButtons();

        const diaryEntry = diaryEntryInput.value.trim();
        const genre = genreSelect.value;

        if (!diaryEntry) {
            showErrorMessage('error_enter_diary');
            return;
        }
        if (!genre) {
            showErrorMessage('error_select_genre');
            return;
        }

        currentDiaryEntry = diaryEntry;
        currentScript = "";

        generateButton.disabled = true;
        showLoadingMessage('loading_message_script');

        try {
            const response = await fetch(API_GENERATE_SCRIPT_URL, { 
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ diaryEntry, genre, lang: currentLang }),
            });

            const data = await response.json();

            if (response.ok) {
                scriptOutput.value = data.script;
                currentScript = data.script;
                scriptOutputContainer.style.display = 'block';
                enableSaveButtons();
                updateWordCount(scriptOutput, scriptWordCount);
            } else {
                const errorMsg = data.error || translations[currentLang].error_unknown_server;
                showErrorMessage('error_script_creation_failed', errorMsg);
                scriptOutput.value = translations[currentLang].error_script_creation_failed;
                currentScript = "";
                scriptOutputContainer.style.display = 'block';
                updateWordCount(scriptOutput, scriptWordCount);
            }

        } catch (error) {
            console.error("Error sending request or receiving response:", error);
            showErrorMessage('error_connection_server');
            scriptOutput.value = translations[currentLang].error_script_creation_failed;
            scriptOutputContainer.style.display = 'block';
            updateWordCount(scriptOutput, scriptWordCount);
        } finally {
            generateButton.disabled = false;
            loadingMessage.style.display = "none";
        }
    });

    saveDiaryButton.addEventListener("click", async () => {
        clearStatusMessages();
        if (!currentDiaryEntry) {
            showErrorMessage('error_enter_diary');
            return;
        }
        saveDiaryButton.disabled = true;
        showLoadingMessage('saving_diary_message');

        try {
            // Adjust API URL for saving diary
            const response = await fetch(API_SAVE_DIARY_URL, { // Now directly uses the updated API_SAVE_DIARY_URL
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ diaryEntry: currentDiaryEntry, lang: currentLang }),
            });

            if (response.ok) {
                showSuccessMessage('success_diary_saved');
            } else {
                const errorData = await response.json();
                showErrorMessage('error_saving_diary', errorData.error);
            }
        } catch (error) {
            console.error("Error saving diary:", error);
            showErrorMessage('error_connection_server');
        } finally {
            saveDiaryButton.disabled = false;
            loadingMessage.style.display = "none";
        }
    });

    saveScriptButton.addEventListener("click", async () => {
        clearStatusMessages();
        if (!currentScript) {
            showErrorMessage('error_script_creation_failed');
            return;
        }
        saveScriptButton.disabled = true;
        showLoadingMessage('saving_script_message');

        try {
            // Adjust API URL for saving script
            const response = await fetch(API_SAVE_SCRIPT_URL, { // Now directly uses the updated API_SAVE_SCRIPT_URL
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ script: currentScript, lang: currentLang }),
            });

            if (response.ok) {
                showSuccessMessage('success_script_saved');
            } else {
                const errorData = await response.json();
                showErrorMessage('error_saving_script', errorData.error);
            }
        } catch (error) {
            console.error("Error saving script:", error);
            showErrorMessage('error_connection_server');
        } finally {
            saveScriptButton.disabled = false;
            loadingMessage.style.display = "none";
        }
    });

    diaryEntryInput.addEventListener('input', () => {
        currentDiaryEntry = diaryEntryInput.value.trim();
        saveDiaryButton.disabled = currentDiaryEntry === "";
        updateWordCount(diaryEntryInput, diaryWordCount);
    });

    scriptOutput.addEventListener('input', () => {
        currentScript = scriptOutput.value.trim();
        saveScriptButton.disabled = currentScript === "";
        updateWordCount(scriptOutput, scriptWordCount);
    });

    // Event listener for "Show Saved" button
    showSavedButton.addEventListener('click', async () => {
        clearStatusMessages();
        document.querySelector('.input-section').style.display = 'none'; 
        scriptOutputContainer.style.display = 'none'; 
        savedFilesContainer.style.display = 'block'; 
        savedContentDisplay.style.display = 'none'; 

        await fetchAndDisplayFiles('diaries', diariesList);
        await fetchAndDisplayFiles('scripts', scriptsList);
    });

    // Event listener for "Close" button in saved files area
    closeSavedFilesButton.addEventListener('click', () => {
        clearStatusMessages();
        savedFilesContainer.style.display = 'none';
        savedContentDisplay.style.display = 'none';
        document.querySelector('.input-section').style.display = 'block'; 
        scriptOutput.value = translations[currentLang].script_placeholder;
        currentScript = "";
        updateWordCount(scriptOutput, scriptWordCount);
    });

    // Event listener for "Close" button in file content display
    closeContentDisplayButton.addEventListener('click', () => {
        clearStatusMessages();
        savedContentDisplay.style.display = 'none';
    });
});
