// Web search tool for Ollama integration
// Performs web search and returns ONLY metadata (title, url, snippet)
// Fetching is handled by a separate hubot_ollama_web_fetch tool

const ollamaClient = require('./ollama-client');

module.exports = (ollama, config, logger) => ({
  name: 'hubot_ollama_web_search',
  description: 'Search the web for relevant information. Returns search result metadata only (title, url, snippet).',
  parameters: {
    query: {
      type: 'string',
      description: 'Search query to look up on the web'
    }
  },
  handler: async (args, robot, msg) => {
    // The model has already decided to use web search and provided the query
    const searchQuery = args.query || args.prompt || '';
    logger?.debug(`Web search tool invoked with query: "${searchQuery}" (args: ${JSON.stringify(args)})`);

    try {
      // Send status message to user first
      if (msg && msg.send) {
        const formattedMsg = robot && robot.adapterName && /slack/i.test(robot.adapterName)
          ? { text: '⏳ _Searching web for relevant sources..._', mrkdwn: true }
          : '⏳ Searching web for relevant sources...';
        msg.reply(formattedMsg);
      }

      // Use the query provided by the model directly - no need to re-evaluate
      if (!searchQuery) {
        return { error: 'No search query provided' };
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

      return {
        results: formattedResults
      };
    } catch (error) {
      logger?.error(`Web search tool error: ${error.message}`);
      return { error: error.message };
    }
  }
});
