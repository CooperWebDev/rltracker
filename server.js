const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the root directory
app.use(express.static(__dirname));

// Define a route for the root path to serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/stats/:epicId', async (req, res) => {
  const epicId = req.params.epicId;
  const url = `https://rlstats.net/profile/Epic/${epicId}`;

  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    const headers = [];
    const values = [];

    $('table tr').each((i, elem) => {
      $(elem).find('th').each((_, th) => headers.push($(th).text().trim()));
      $(elem).find('td').each((_, td) => values.push($(td).text().trim()));
    });

    res.json({ headers, values });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch stats. Make sure the Epic ID is correct.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});