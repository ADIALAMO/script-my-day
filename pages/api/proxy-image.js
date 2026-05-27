// pages/api/proxy-image.js
const ALLOWED_HOSTS = [
  'image.pollinations.ai',
  'pollinations.ai',
];

export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).send('No URL');

  // --- SSRF Guard: parse and validate the URL before touching the network ---
  let parsedUrl;
  try {
    parsedUrl = new URL(decodeURIComponent(url));
  } catch {
    console.warn('⛔ Proxy rejected malformed URL');
    return res.status(400).send('Invalid URL');
  }

  if (parsedUrl.protocol !== 'https:') {
    console.warn(`⛔ Proxy rejected non-HTTPS URL: ${parsedUrl.href}`);
    return res.status(400).send('HTTPS required');
  }

  if (!ALLOWED_HOSTS.includes(parsedUrl.hostname)) {
    console.warn(`⛔ Proxy blocked disallowed host: ${parsedUrl.hostname}`);
    return res.status(403).send('Host not permitted');
  }

  const finalUrl = parsedUrl.href;
  console.log("🎯 Proxy fetching:", finalUrl);

  try {
    const response = await fetch(finalUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    if (!response.ok) {
      console.error(`❌ Source failed: ${response.status} ${response.statusText}`);
      return res.status(response.status).send(`Pollinations failed: ${response.status}`);
    }

    const contentType = response.headers.get('content-type');
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader('Content-Type', contentType || 'image/png');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    return res.send(buffer);
  } catch (error) {
    console.error('🔥 Proxy Critical Error:', error.message);
    return res.status(500).send("Proxy error");
  }
}
