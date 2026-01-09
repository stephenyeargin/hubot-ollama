// Web search tool for Ollama integration
// Performs web search and returns ONLY metadata (title, url, snippet)
// Fetching is handled by a separate hubot_ollama_web_fetch tool

const { getAdapterType } = require('../utils/ollama-utils');

const ollamaClient = require('./ollama-client');

module.exports = (ollama, config, logger) => ({
  name: 'hubot_ollama_web_search',
  description: 'Search the web for information using a search query. This is for finding relevant web pages. For fetching content from a specific URL, use hubot_ollama_web_fetch instead. Returns search result metadata (title, url, snippet).',
  parameters: {
    query: {
      type: 'string',
      description: 'Search query text to find relevant web pages. Do not use URLs here - use hubot_ollama_web_fetch for fetching specific URLs.'
    }
  },
  handler: async (args, robot, msg) => {
    // Use the query provided by the model
    const searchQuery = args.query || args.prompt || '';

    logger?.debug(`Web search tool invoked with query: "${searchQuery}" (args: ${JSON.stringify(args)})`);

    try {
      // Reject if no search query provided
      if (!searchQuery) {
        return { error: 'No search query provided' };
      }

      // Send status message to user first
      if (msg && msg.send) {
        const statusText = '⏳ _Searching web for relevant sources..._';

        if (getAdapterType(robot) === 'slack') {
          const userId = msg?.message?.user?.id || msg?.message?.user?.name || '';
          const mention = userId ? `<@${userId}> ` : '';
          const threadTs = msg?.message?.thread_ts || msg?.message?.ts || msg?.message?.rawMessage?.ts || undefined;
          msg.send({ text: `${mention}${statusText}`, mrkdwn: true, thread_ts: threadTs });
        } else {
          msg.reply(statusText);
        }
      }

      logger?.debug(`Search query: ${searchQuery}`);

      // Perform web search with the query provided by the model
      let results = [];
      try {
        results = await ollamaClient.runWebSearch(ollama, searchQuery, config.WEB_MAX_RESULTS);
      } catch (err) {
        logger?.debug(`webSearch failed: ${err && err.message}`);
        return { error: `Web search failed: ${err && err.message}` };
      }

      logger?.debug(`webSearch results=${results.length}`);

      if (!results.length) {
        return { error: 'No search results found' };
      }

      // Return ONLY search metadata (title, url, snippet)
      // Do NOT fetch pages - let the model decide which URLs to fetch via hubot_ollama_web_fetch
      const formattedResults = results.map(r => ({
        title: r.title || '',
        url: r.url || '',
        snippet: r.snippet || r.description || ''
      }));

      logger?.debug(`Returning ${formattedResults.length} search results`);

      return { results: formattedResults };
    } catch (error) {
      logger?.error(`Web search tool error: ${error.message}`);
      return { error: error.message };
    }
  }
});
