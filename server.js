const express = require('express');
const axios = require('axios');
const path = require('path');
const { parseProfile } = require('./profileParser');

const app = express();
const PORT = process.env.PORT || 3000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Serve static files from the root directory
app.use(express.static(__dirname));

app.get('/style.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'style.css'));
});

// Define a route for the root path to serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

async function fetchProfileSource(epicId) {
  const directUrl = `https://rlstats.net/profile/Epic/${encodeURIComponent(epicId)}`;

  try {
    const directResponse = await axios.get(directUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 15000,
    });

    const html = String(directResponse.data || '');

    if (directResponse.status !== 200 || /Just a moment/.test(html) || /Enable JavaScript and cookies/.test(html)) {
      throw new Error('Direct fetch returned a challenge page.');
    }

    return { format: 'html', data: html };
  } catch (error) {
    const fallbackUrl = `https://r.jina.ai/http://https://rlstats.net/profile/Epic/${encodeURIComponent(epicId)}`;
    const fallbackResponse = await axios.get(fallbackUrl, {
      headers: {
        'User-Agent': USER_AGENT,
      },
      timeout: 20000,
    });

    return { format: 'markdown', data: String(fallbackResponse.data || '') };
  }
}

app.get('/api/stats/:epicId', async (req, res) => {
  const epicId = req.params.epicId;

  try {
    const source = await fetchProfileSource(epicId);
    const profile = parseProfile(source.data, source.format);

    res.json({ profile });
  } catch (error) {
    console.error('Failed to fetch RLStats profile:', error.message);
    res.status(502).json({
      error: 'Failed to fetch the profile. The page may be blocking automated requests right now.',
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});