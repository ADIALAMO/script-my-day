// Copy for the in-app "Report" control (components/ReportButton.jsx). Every string exists in he AND en.
export const REPORT_COPY = {
  button:     { en: 'Report', he: 'דווח' },
  buttonAria: { en: 'Report this image as inappropriate', he: 'דווח על התמונה כלא הולמת' },
  title: {
    poster: { en: 'Report this poster', he: 'דיווח על הפוסטר' },
    panel:  { en: 'Report this image',  he: 'דיווח על התמונה' },
    reel:   { en: 'Report this reel',   he: 'דיווח על הריל' },
  },
  intro: {
    en: 'Tell us what is wrong. The image will be hidden and our team will be notified.',
    he: 'ספר לנו מה לא בסדר. התמונה תוסתר והצוות שלנו יקבל התראה.',
  },
  reasons: {
    sexual:  { en: 'Sexual content or nudity', he: 'תוכן מיני או עירום' },
    violent: { en: 'Violent or disturbing',    he: 'אלים או מטריד' },
    other:   { en: 'Something else',           he: 'אחר' },
  },
  send:    { en: 'Send report', he: 'שלח דיווח' },
  sending: { en: 'Sending…',    he: 'שולח…' },
  cancel:  { en: 'Cancel',      he: 'ביטול' },
  done:    { en: 'Thanks. This image is hidden and our team has been notified.', he: 'תודה. התמונה הוסתרה והצוות שלנו קיבל התראה.' },
  errors: {
    rate:    { en: 'Too many reports. Try again in a few minutes.', he: 'יותר מדי דיווחים. נסה שוב בעוד כמה דקות.' },
    failed:  { en: "Couldn't send the report. Check your connection and try again.", he: 'לא הצלחנו לשלוח את הדיווח. בדוק את החיבור ונסה שוב.' },
    invalid: { en: "This image can't be reported.", he: 'לא ניתן לדווח על התמונה הזו.' },
  },
  hiddenTile: { en: 'Hidden after your report', he: 'הוסתר לאחר הדיווח שלך' },
  reelNotice: { en: 'Reel removed after your report.', he: 'הריל הוסר לאחר הדיווח שלך.' },
};

export const reportText = (entry, lang) => (entry && (entry[lang] ?? entry.en)) || '';
