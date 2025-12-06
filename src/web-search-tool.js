// Web search tool for Ollama integration
// Evaluates if web search is needed and performs web search + fetch workflow

const ollamaClient = require('./ollama-client');

module.exports = (ollama, config, logger) => ({
    name: 'hubot_ollama_web_search',
    description: 'Search the web for relevant information to answer the user prompt',
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
            ? { text: 'Searching web for relevant sources...', mrkdwn: true }
            : 'Searching web for relevant sources...';
          msg.send(formattedMsg);
        }

        // Use the query provided by the model directly - no need to re-evaluate
        if (!searchQuery) {
          return { needsWeb: false, context: null, message: 'No search query provided' };
        }

        logger?.debug(`Search query: ${searchQuery}`);

        // Perform web search with the query provided by the model
        let results = [];
        try {
          results = await ollamaClient.runWebSearch(ollama, searchQuery, config.WEB_MAX_RESULTS);
        } catch (err) {
          logger?.debug(`webSearch failed: ${err && err.message}`);
        }
        logger?.debug(`webSearch results=${results.length}`);

        if (!results.length) {
          return { needsWeb: true, context: null, message: 'No search results found' };
        }

        // Fetch pages in parallel
        let pages = [];
        try {
          pages = await ollamaClient.runWebFetchMany(
            ollama,
            results,
            config.WEB_MAX_BYTES,
            config.WEB_FETCH_CONCURRENCY,
            config.WEB_TIMEOUT_MS,
            logger
          );
        } catch (err) {
          logger?.debug(`webFetch failed: ${err && err.message}`);
        }
        logger?.debug(`Fetched pages count=${pages.length}`);

        if (!pages.length) {
          return { needsWeb: true, context: null, message: 'Could not fetch search results' };
        }

        // Build context from fetched pages
        const contextText = ollamaClient.buildWebContextMessage(pages, 800);
        logger?.debug(`Built web context: ${contextText.length} characters`);

        return {
          needsWeb: true,
          context: contextText,
          resultCount: pages.length
        };
      } catch (error) {
        logger?.error(`Web search tool error: ${error.message}`);
        return { error: error.message };
      }
    }
  });
