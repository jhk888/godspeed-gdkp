const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const BLIZZ_CLIENT_ID = '9054d523435844f1a6f6e977431f90be';
const BLIZZ_CLIENT_SECRET = 'jQZp156Hykxd4pdjHttAKiqV8QxedHAQ';
const QUALITY_STR = { 'POOR':'poor','COMMON':'common','UNCOMMON':'uncommon','RARE':'rare','EPIC':'epic','LEGENDARY':'legendary' };
const TBC_MAX_ITEM_ID = 38000;

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry) return cachedToken;
  const res = await fetch('https://us.battle.net/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + btoa(BLIZZ_CLIENT_ID + ':' + BLIZZ_CLIENT_SECRET),
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error('Token failed ' + res.status);
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = now + (data.expires_in - 60) * 1000;
  return cachedToken;
}

async function getItemIcon(itemId, token) {
  try {
    const url = `https://us.api.blizzard.com/data/wow/media/item/${itemId}?namespace=static-us&locale=en_US`;
    const res = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + token },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const asset = (data.assets || []).find(a => a.key === 'icon');
    if (!asset) return null;
    const match = asset.value.match(/\/([^\/]+)\.jpg$/i);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

async function searchBlizzard(query, token, pageSize = 20) {
  const url = `https://us.api.blizzard.com/data/wow/search/item?namespace=static-us&locale=en_US&name.en_US=${encodeURIComponent(query)}&orderby=name:asc&_page=1&_pageSize=${pageSize}`;
  const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
  if (!res.ok) return [];
  const data = await res.json();
  return data.results || [];
}

async function fetchItemById(id, token) {
  try {
    const url = `https://us.api.blizzard.com/data/wow/item/${id}?namespace=static-us&locale=en_US`;
    const res = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + token },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const q = url.searchParams.get('q');

    if (!q || q.trim().length < 2) {
      return new Response(JSON.stringify([]), { headers: CORS_HEADERS });
    }

    try {
      const token = await getAccessToken();
      const query = q.trim();

      // Build search queries
      const stopWords = new Set(['the','and','for','from','with','into','that','this','have','will','off']);
      const words = query.split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w.toLowerCase()));
      const queries = [query];
      if (query.includes('-')) queries.push(query.replace(/-/g, ' '));
      // Only add sub-word searches for multi-word queries (token items like "vanquished champion")
      // Single-word queries like "vanquisher" should NOT trigger sub-word fallbacks
      if (words.length >= 2) {
        queries.push(words.slice(-2).join(' '));
        const lastWord = words[words.length - 1] || '';
        if (lastWord.length >= 6 && lastWord !== query) queries.push(lastWord);
      }

      // Check if input looks like a Wowhead URL containing item ID
      const idFromUrl = query.match(/item[=\/](\d+)/i);

      const searches = queries.map(q => searchBlizzard(q, token, 20));
      if (idFromUrl) {
        // Direct ID lookup in parallel
        searches.push(fetchItemById(parseInt(idFromUrl[1]), token).then(d => d ? [{data:d}] : []));
      }

      const allResults = (await Promise.all(searches)).flat();

      // Deduplicate by item ID
      const seen = new Set();
      const deduped = allResults.filter(r => {
        const id = r.data?.id;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      if (!deduped.length) {
        return new Response(JSON.stringify([]), { headers: CORS_HEADERS });
      }

      const qualityOrder = { legendary: 0, epic: 1, rare: 2, uncommon: 3, common: 4, poor: 5 };

      const allItems = deduped.map(r => {
        const d = r.data || {};
        const qualityRaw = d.quality?.type || 'COMMON';
        return {
          id: d.id,
          name: d.name?.en_US || d.name || '',
          quality: QUALITY_STR[qualityRaw] || 'common',
          slot: d.inventory_type?.name?.en_US || d.item_subclass?.name?.en_US || '',
        };
      })
      .filter(i => i.name && i.id <= TBC_MAX_ITEM_ID)
      .sort((a, b) => {
        const aLow = a.name.toLowerCase();
        const bLow = b.name.toLowerCase();
        const qLow = query.toLowerCase();
        // Exact match > starts with query > contains query > other
        const score = n => n === qLow ? 0 : n.startsWith(qLow) ? 1 : n.includes(qLow) ? 2 : 3;
        const aSc = score(aLow), bSc = score(bLow);
        if (aSc !== bSc) return aSc - bSc;
        return (qualityOrder[a.quality] ?? 9) - (qualityOrder[b.quality] ?? 9);
      })
      .slice(0, 12);

      // Fetch icons in parallel
      const withIcons = await Promise.all(allItems.map(async item => {
        item.icon = await getItemIcon(item.id, token);
        return item;
      }));

      return new Response(JSON.stringify(withIcons), { headers: CORS_HEADERS });

    } catch (err) {
      return new Response(
        JSON.stringify({ error: err.message }),
        { status: 500, headers: CORS_HEADERS }
      );
    }
  },
};
