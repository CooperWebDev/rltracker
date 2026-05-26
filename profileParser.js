const cheerio = require('cheerio');

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseIntFromText(value) {
  const match = String(value || '').match(/\d+(?:,\d+)*/);
  if (!match) return null;
  return Number(match[0].replace(/,/g, ''));
}

function parseRatingValue(value) {
  const digits = String(value || '').match(/\d+/g);
  if (!digits) return null;

  const ratingCandidates = digits
    .map((digit) => Number(digit))
    .filter((digit) => digit >= 100);

  if (ratingCandidates.length) {
    return ratingCandidates[0];
  }

  return Number(digits[digits.length - 1]);
}

function parseStreak(value) {
  const text = normalizeWhitespace(value || '');
  if (!text) return null;

  const type = /win streak/i.test(text) ? 'win' : /loss streak/i.test(text) ? 'loss' : null;
  const count = parseIntFromText(text);

  if (!type || count === null) {
    return null;
  }

  return { type, count };
}

function parseMatches(value) {
  const text = normalizeWhitespace(value || '');
  if (!text) return null;

  const match = text.match(/Matches Played:\s*(\d+(?:,\d+)*)/i);
  if (!match) return null;

  return Number(match[1].replace(/,/g, ''));
}

function parseStatsTableFromHtml($, statsBlock) {
  const labels = statsBlock
    .find('th img')
    .map((_, img) => normalizeWhitespace($(img).attr('alt')))
    .get()
    .filter(Boolean);

  const values = statsBlock
    .find('tr')
    .last()
    .find('td')
    .map((_, td) => normalizeWhitespace($(td).text()))
    .get()
    .filter(Boolean);

  return {
    labels,
    values,
  };
}

function parseHtmlSeason(block, $) {
  const season = Number($(block).attr('data-season'));
  const rewardBlock = $(block).find('.block-reward').first();
  const progress = rewardBlock.find('progress').first();
  const firstHeading = normalizeWhitespace(rewardBlock.find('h2').first().text());
  const winsText = normalizeWhitespace(rewardBlock.find('h2').last().text());
  const requirement = normalizeWhitespace(rewardBlock.find('p').last().text());

  const modes = [];
  $(block)
    .find('.block-skills > table')
    .each((_, tableEl) => {
      const table = $(tableEl);
      const rows = table
        .find('tr')
        .map((_, row) =>
          $(row)
            .find('th, td')
            .map((__, cell) => normalizeWhitespace($(cell).text()))
            .get()
        )
        .get()
        .filter((row) => row.length);

      if (!rows.length) {
        return;
      }

      const headers = rows[0];
      const rankRow = rows[1] || [];
      const divisionRow = rows[2] || [];
      const ratingRow = rows[3] || [];
      const matchesRow = rows[5] || [];
      const streakRow = rows[6] || [];

      headers.forEach((label, index) => {
        const rank = rankRow[index] || null;
        const division = divisionRow[index] || null;
        const ratingText = ratingRow[index] || null;
        const rating = parseRatingValue(ratingText);
        const matchesPlayed = parseMatches(matchesRow[index]);
        const streak = parseStreak(streakRow[index]);

        if (!label) {
          return;
        }

        modes.push({
          label,
          rank,
          division,
          rating,
          ratingRaw: ratingText,
          matchesPlayed,
          streak,
        });
      });
    });

  const casualBlock = $(block).find('.unranked-block').first();
  const casual = casualBlock.length
    ? {
        label: normalizeWhitespace(casualBlock.find('th').first().text()) || 'Casual',
        rating: parseRatingValue(normalizeWhitespace(casualBlock.find('td').last().text()).replace(/^Rating\s+/i, '')),
        imageAlt: normalizeWhitespace(casualBlock.find('img').first().attr('alt')),
      }
    : null;

  return {
    season,
    reward: {
      title: firstHeading,
      winsText,
      requirement,
      imageAlt: normalizeWhitespace(rewardBlock.find('img').first().attr('alt')),
      progress: {
        value: Number(progress.attr('value') || 0),
        max: Number(progress.attr('max') || 0),
      },
    },
    modes,
    casual,
  };
}

function parseMarkdownStatsTable(lines) {
  const tableRows = lines.filter((line) => line.startsWith('|'));
  const valueLine = tableRows[2] || tableRows.find((line) => /Wins|MVPs|Goals|Assists|Saves|Shots/.test(line));

  if (!valueLine) {
    return { labels: [], values: [] };
  }

  const values = valueLine
    .split('|')
    .slice(1, -1)
    .map((cell) => normalizeWhitespace(cell))
    .filter(Boolean);

  return {
    labels: ['Wins', 'MVPs', 'Goals', 'Assists', 'Saves', 'Shots'],
    values,
  };
}

function parseMarkdownUpdateHistory(lines) {
  const startIndex = lines.findIndex((line) => /^####\s*Update History/i.test(line));
  if (startIndex === -1) {
    return [];
  }

  const rows = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.startsWith('|')) {
      break;
    }

    if (/^\|\s*-+/.test(line)) {
      continue;
    }

    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => normalizeWhitespace(cell));

    if (cells.length < 5) {
      continue;
    }

    if (cells[0] === 'Updated' && cells[1] === 'Playlist') {
      continue;
    }

    rows.push({
      updated: cells[0] || null,
      playlist: cells[1] || null,
      matches: parseIntFromText(cells[2]),
      rating: parseIntFromText(cells[3]),
      change: cells[4] || null,
    });
  }

  return rows;
}

function extractMarkdownTables(lines) {
  const tables = [];
  let currentTable = [];

  for (const line of lines) {
    if (line.startsWith('|')) {
      currentTable.push(line);
      continue;
    }

    if (currentTable.length) {
      tables.push(currentTable);
      currentTable = [];
    }
  }

  if (currentTable.length) {
    tables.push(currentTable);
  }

  return tables;
}

function extractSkillTables(lines) {
  const allowedLabels = new Set([
    '1v1 Duel',
    '2v2 Doubles',
    '3v3 Standard',
    'Tournaments',
    '2v2 Heatseeker',
    '2v2 Hoops',
    '3v3 Rumble',
    '3v3 Dropshot',
    '3v3 Snow Day',
  ]);

  const skillTables = [];
  let currentTable = [];

  for (const line of lines) {
    if (!line.startsWith('|')) {
      continue;
    }

    const cells = line.split('|').slice(1, -1).map((cell) => normalizeWhitespace(cell));
    const isSkillHeader = cells.some((cell) => allowedLabels.has(cell));

    if (isSkillHeader && currentTable.length) {
      skillTables.push(currentTable);
      currentTable = [line];
      continue;
    }

    currentTable.push(line);
  }

  if (currentTable.length) {
    skillTables.push(currentTable);
  }

  return skillTables.filter((table) => {
    const headers = table[0]?.split('|').slice(1, -1).map((cell) => normalizeWhitespace(cell)) || [];
    return headers.some((label) => allowedLabels.has(label));
  });
}

function extractImageUrl(value) {
  const match = String(value || '').match(/\((https?:\/\/[^)]+)\)/);
  return match ? match[1] : null;
}

function parseMarkdownSkillTable(table) {
  const rows = table.map((line) => line.split('|').slice(1, -1).map((cell) => normalizeWhitespace(cell)));
  const headers = rows[0] || [];
  const rankRow = rows[2] || [];
  const divisionRow = rows[3] || [];
  const ratingRow = rows[4] || [];
  const imageRow = rows[5] || [];
  const matchesRow = rows[6] || [];
  const streakRow = rows[7] || [];

  return headers.map((label, index) => ({
    label,
    rank: rankRow[index] || null,
    division: divisionRow[index] || null,
    rating: parseRatingValue(ratingRow[index]),
    ratingRaw: ratingRow[index] || null,
    imageUrl: extractImageUrl(imageRow[index]),
    matchesPlayed: parseMatches(matchesRow[index]),
    streak: parseStreak(streakRow[index]),
  }));
}

function parseMarkdownSeason(lines) {
  const rewardTitle = normalizeWhitespace(lines.find((line) => /^##\s+/.test(line))?.replace(/^##\s+/, ''));
  const winsLine = normalizeWhitespace(lines.find((line) => /^##\s+\d+\/\d+\s+Wins$/.test(line)) || '');
  const requirementLine = normalizeWhitespace(lines.find((line) => /^Win at\s+/.test(line)) || '');
  const rewardImageUrl = extractImageUrl(lines.find((line) => line.includes('s32rl') && line.includes('https://')));

  const allowedLabels = new Set([
    '1v1 Duel',
    '2v2 Doubles',
    '3v3 Standard',
    'Tournaments',
    '2v2 Heatseeker',
    '2v2 Hoops',
    '3v3 Rumble',
    '3v3 Dropshot',
    '3v3 Snow Day',
  ]);

  const skillTables = extractSkillTables(lines);
  const modes = skillTables.flatMap((table) => parseMarkdownSkillTable(table)).filter((mode) => allowedLabels.has(mode.label));

  const casual = (() => {
    const casualLine = lines.find((line) => /^Casual$/.test(line));
    const ratingLine = lines.find((line) => /^Rating\s+\d+$/.test(line));
    const casualImageUrl = extractImageUrl(lines.find((line) => line.includes('Unranked') && line.includes('https://')));

    if (!casualLine || !ratingLine) {
      return null;
    }

    return {
      label: 'Casual',
      rating: parseIntFromText(ratingLine),
      imageUrl: casualImageUrl,
    };
  })();

  return {
    season: 36,
    reward: {
      title: rewardTitle,
      winsText: winsLine.replace(/^##\s+/, ''),
      requirement: requirementLine,
      imageUrl: rewardImageUrl,
    },
    modes,
    casual,
  };
}

function buildRatingHistoryFromUpdates(updateHistory) {
  if (!Array.isArray(updateHistory) || !updateHistory.length) {
    return null;
  }

  const rows = updateHistory
    .filter((entry) => entry.rating !== null && entry.rating !== undefined)
    .map((entry) => [entry.updated || 'Unknown', entry.rating]);

  if (!rows.length) {
    return null;
  }

  return [['Update', 'Rating'], ...rows];
}

function parseMarkdownProfile(markdown) {
  const lines = markdown
    .split('\n')
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  const heading = lines.find((line) => line.startsWith('## '));
  const profileName = heading?.match(/([A-Za-z0-9_]+)\s+Updated\s+.+$/)?.[1] || 'Unknown';
  const updated = heading ? heading.match(/Updated\s+(.+)$/)?.[1] || null : null;

  const statsIndex = lines.findIndex((line) => line.includes('#### Stats (Total)'));
  const skillIndex = lines.findIndex((line) => line.includes('#### Skill Rating'));
  const titlesEnd = statsIndex >= 0 ? statsIndex : skillIndex >= 0 ? skillIndex : lines.length;
  const skillStart = skillIndex >= 0 ? skillIndex : lines.length;

  const titles = lines
    .slice(1, titlesEnd)
    .map((line) => line.replace(/!\[.*?\]\(.*?\)/g, '').replace(/^\s+|\s+$/g, ''))
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line && !line.startsWith('Image') && !line.includes('Updated') && !line.includes('Avatar'))
    .filter((line) => !/URL Source|Markdown Content/i.test(line))
    .filter((line) => !/^S\d+$/i.test(line));

  const totalStats = parseMarkdownStatsTable(lines.slice(statsIndex >= 0 ? statsIndex : lines.length, skillStart));
  const currentSeason = parseMarkdownSeason(lines.slice(skillStart));
  const updateHistory = parseMarkdownUpdateHistory(lines);
  const ratingHistory = buildRatingHistoryFromUpdates(updateHistory);

  return {
    displayName: profileName,
    platform: 'Epic',
    updated,
    titles,
    totalStats,
    currentSeason,
    updateHistory,
    ratingHistory,
  };
}

function extractChartData(html) {
  // Extract the chart data from the JavaScript embedded in the HTML
  const dataMatch = html.match(/data\.addRows\(\[([\s\S]*?)\]\)/);
  if (!dataMatch) return null;

  const dataRows = dataMatch[1];
  
  // Parse each row: [new Date(timestamp*1000), val1, val2, ...]
  const rows = [];
  const rowMatches = [...dataRows.matchAll(/\[new Date\((\d+)\*1000\),\s*([^\]]+)\]/g)];
  
  if (rowMatches.length === 0) return null;

  // Build header: ['Date', 'Duel', 'Doubles', 'Standard', 'Tournament', 'Quads', 'Heatseeker', 'Hoops', 'Rumble', 'Dropshot', 'Snow Day', 'Casual']
  const header = ['Date', 'Duel', 'Doubles', 'Standard', 'Tournament', 'Quads', 'Heatseeker', 'Hoops', 'Rumble', 'Dropshot', 'Snow Day', 'Casual'];
  const result = [header];

  // Parse each row
  for (const match of rowMatches) {
    const timestamp = parseInt(match[1]) * 1000; // Convert to milliseconds
    const values = match[2]
      .split(',')
      .map((v) => parseInt(normalizeWhitespace(v)))
      .filter((v) => !isNaN(v));

    if (values.length > 0) {
      result.push([new Date(timestamp), ...values]);
    }
  }

  return result.length > 1 ? result : null;
}

function parseHtmlProfile(html) {
  const $ = cheerio.load(html);
  const h1Text = normalizeWhitespace($('#userinfo h1').text());
  const displayName = h1Text.replace(/\s*Updated\s+.*$/i, '').trim();
  const updated = normalizeWhitespace($('#userinfo h1 span').first().attr('title')) || null;

  const titles = $('#titles .title')
    .map((_, element) => normalizeWhitespace($(element).text()))
    .get()
    .filter(Boolean);

  const statsBlock = $('#stats .block-stats').first();
  const totalStats = parseStatsTableFromHtml($, statsBlock);

  const seasons = $('#skills .block-body[data-season]')
    .map((_, block) => parseHtmlSeason(block, $))
    .get();

  const currentSeason = seasons.find((season) => season.season === 36) || seasons[0] || null;

  const updateRows = $('#history .block-updates table tr')
    .toArray()
    .slice(1)
    .map((row) => {
      const cells = $(row)
        .find('td')
        .map((_, cell) => normalizeWhitespace($(cell).text()))
        .get()
        .filter(Boolean);

      if (!cells.length) {
        return null;
      }

      return {
        updated: cells[0] || null,
        playlist: cells[1] || null,
        matches: parseIntFromText(cells[2]),
        rating: parseIntFromText(cells[3]),
        change: cells[4] || null,
      };
    })
    .filter(Boolean);

  let ratingHistory = extractChartData(html);
  if (!ratingHistory) {
    ratingHistory = buildRatingHistoryFromUpdates(updateRows);
  }

  return {
    displayName,
    platform: 'Epic',
    updated,
    titles,
    totalStats,
    currentSeason,
    updateHistory: updateRows,
    ratingHistory,
  };
}

function parseProfile(content, format = null) {
  if (format === 'markdown' || (!format && !content.includes('<html') && !content.includes('<!doctype'))) {
    return parseMarkdownProfile(content);
  }

  return parseHtmlProfile(content);
}

module.exports = { parseProfile };
