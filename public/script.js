document.getElementById('journal-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const journalEntry = document.getElementById('journal-entry').value.trim();
  const genre = document.getElementById('genre').value;
  const loading = document.getElementById('loading');
  const error = document.getElementById('error');
  const output = document.getElementById('script-output');

  // אימות קלט
  if (!journalEntry || !genre) {
    error.style.display = 'block';
    error.textContent = 'אנא מלא את כל השדות.';
    return;
  }

  // איפוס ממשק
  error.style.display = 'none';
  output.textContent = '';
  loading.style.display = 'block';

  try {
    const response = await fetch('/api/generateScript', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ journalEntry, genre })
    });

    if (!response.ok) {
      throw new Error(`שגיאת שרת: ${response.status}`);
    }

    const data = await response.json();
    output.textContent = data.script || 'לא נוצר תסריט.';
  } catch (err) {
    error.style.display = 'block';
    error.textContent = `שגיאה: ${err.message}`;
  } finally {
    loading.style.display = 'none';
  }
});