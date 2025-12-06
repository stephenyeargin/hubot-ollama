// Ollama API logic and helpers for hubot-ollama

const { truncate } = require('../utils/ollama-utils');

async function runWebSearch(ollama, query, maxResults) {
  const searchRes = await ollama.webSearch({ query, max_results: maxResults });
  const items = (searchRes && searchRes.results) || [];
  const seen = new Set();
  const dedup = [];
  for (const it of items) {
    const url = it.url || it.link || it.href;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    dedup.push({ title: it.title || it.name || url, url, content: it.content || '' });
  }
  return dedup.slice(0, maxResults);
}

async function runWebFetchMany(ollama, urls, maxBytes, concurrency, timeoutMs, logger) {
  const results = [];
  let idx = 0;
  const workers = Array(Math.min(concurrency, urls.length)).fill(0).map(() => (async () => {
    while (idx < urls.length) {
      const i = idx++;
      const entry = urls[i];
      const u = entry.url;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const res = await ollama.webFetch({ url: u, signal: controller.signal });
        clearTimeout(timeout);
        let body = (res && (res.text || res.content || res.body || res.data)) || '';
        if (!body && entry.content) {
          body = entry.content;
        }
        results.push({ title: entry.title, url: u, text: truncate(body, maxBytes) });
      } catch (error) {
        if (entry && entry.content) {
          results.push({ title: entry.title, url: u, text: truncate(entry.content, maxBytes) });
          logger?.debug(`Fetch failed for <${u}>; using search snippet fallback.`);
        } else {
          logger?.error({ message: `Fetch for <${u}> failed!`, error });
        }
      }
    }
  })());
  await Promise.all(workers);
  return results;
}

function buildWebContextMessage(pages, maxTextLen = 800) {
  const lines = [];
  for (const p of pages) {
    lines.push(`- ${p.title} (${p.url})\n${truncate(p.text || '', maxTextLen)}`);
  }
  return lines.join('\n\n');
}

module.exports = {
  runWebSearch,
  runWebFetchMany,
  buildWebContextMessage,
};
