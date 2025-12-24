// script.js
const form = document.getElementById('scriptForm');
const scriptText = document.getElementById('scriptText');
const errorDiv = document.getElementById('error');
const loadingDiv = document.getElementById('loading');
const submitButton = form.querySelector('button');

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const journalEntry = document.getElementById('journalEntry').value;
  const genre = document.getElementById('genre').value;

  submitButton.disabled = true;
  loadingDiv.classList.remove('hidden');
  errorDiv.classList.add('hidden');
  errorDiv.textContent = '';
  scriptText.textContent = '';

  try {
    const response = await fetch('/api/generate-script', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ journalEntry, genre }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = await response.json();
    scriptText.textContent = data.script;

  } catch (err) {
    errorDiv.classList.remove('hidden');
    errorDiv.textContent = 'Error: ' + (err.message || 'Something went wrong!');
  } finally {
    submitButton.disabled = false;
    loadingDiv.classList.add('hidden');
  }
});
