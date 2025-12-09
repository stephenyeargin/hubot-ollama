// Web fetch tool for Ollama integration
// Fetches content from URLs selected by the model

const { getAdapterType } = require('../utils/ollama-utils');

const ollamaClient = require('./ollama-client');

module.exports = (ollama, config, logger) => ({
  name: 'hubot_ollama_web_fetch',
  description: 'Fetch full content from specific URLs to get detailed information',
  parameters: {
    urls: {
      type: 'array',
      description: 'Array of URLs to fetch content from',
      items: {
        type: 'string'
      }
    }
  },
  handler: async (args, robot, msg) => {
    // Accept both 'url' (single string) and 'urls' (array) for flexibility
    let urls = [];
    if (args.urls) {
      urls = Array.isArray(args.urls) ? args.urls : [args.urls];
    } else if (args.url) {
      urls = Array.isArray(args.url) ? args.url : [args.url];
    }
    logger?.debug(`Web fetch tool invoked with ${urls.length} URL(s)`);

    try {
      // Validate and sanitize URLs
      if (!urls || urls.length === 0) {
        return { error: 'No URLs provided for fetching' };
      }

      // Get or initialize fetched URLs tracking at conversation level
      if (!robot.brain.get('ollamaFetchedUrls')) {
        robot.brain.set('ollamaFetchedUrls', {});
      }

      // Use injected invocation context key for per-invocation URL tracking
      // If not provided (e.g., in tests), generate a temporary one
      let invocationContextKey = args._invocationContextKey;
      if (!invocationContextKey) {
        // Generate a temporary key for backward compatibility (tests, direct calls)
        invocationContextKey = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
        logger?.debug(`No _invocationContextKey provided, using temporary key: ${invocationContextKey}`);
      }
      const fetchedUrls = robot.brain.get('ollamaFetchedUrls');

      // Initialize context as an array if not exists (arrays serialize better than Sets)
      if (!fetchedUrls[invocationContextKey]) {
        fetchedUrls[invocationContextKey] = [];
      }

      // Ensure it's an array (in case of deserialization from storage)
      if (!Array.isArray(fetchedUrls[invocationContextKey])) {
        fetchedUrls[invocationContextKey] = [];
      }

      // Check for already-fetched URLs
      const alreadyFetched = [];
      const urlsToFetch = [];

      for (const url of urls) {
        if (fetchedUrls[invocationContextKey].includes(url)) {
          alreadyFetched.push(url);
        } else {
          urlsToFetch.push(url);
        }
      }

      if (alreadyFetched.length > 0) {
        logger?.debug(`Skipping already-fetched URLs: ${alreadyFetched.join(', ')}`);
      }

      // Return error if all URLs already fetched
      if (urlsToFetch.length === 0) {
        return { error: `All URLs already fetched in this invocation: ${alreadyFetched.join(', ')}` };
      }

      // Send status message to user with domain information
      if (msg && msg.send) {
        const domains = urlsToFetch.map(url => {
          try {
            return new URL(url).hostname;
          } catch {
            return url;
          }
        }).join(', ');

        const statusText = `⏳ _Fetching content from ${urlsToFetch.length} URL(s): ${domains}_`;

        // Handle adapter-specific message formatting
        if (getAdapterType(robot) === 'slack') {
          const userId = msg?.message?.user?.id || msg?.message?.user?.name || '';
          const mention = userId ? `<@${userId}> ` : '';
          msg.send({ text: `${mention}${statusText}`, mrkdwn: true });
        } else {
          msg.reply(statusText);
        }
      }

      // Fetch pages
      let pages = [];
      try {
        pages = await ollamaClient.runWebFetchMany(
          ollama,
          urlsToFetch.map(url => ({ url })), // Convert URLs to the format expected by runWebFetchMany
          config.WEB_MAX_BYTES,
          config.WEB_FETCH_CONCURRENCY,
          config.WEB_TIMEOUT_MS,
          logger
        );
      } catch (err) {
        logger?.debug(`webFetch failed: ${err && err.message}`);
        return { error: `Failed to fetch URLs: ${err && err.message}` };
      }

      logger?.debug(`Fetched ${pages.length} page(s)`);

      if (!pages.length) {
        return { error: 'Could not fetch any of the requested URLs' };
      }

      // Track fetched URLs
      for (const page of pages) {
        if (page.url && !fetchedUrls[invocationContextKey].includes(page.url)) {
          fetchedUrls[invocationContextKey].push(page.url);
        }
      }
      robot.brain.set('ollamaFetchedUrls', fetchedUrls);

      // Return pages in standardized format
      return {
        pages: pages.map(p => ({
          url: p.url,
          content: p.content || p.text || ''
        }))
      };
    } catch (error) {
      logger?.error(`Web fetch tool error: ${error.message}`);
      return { error: error.message };
    }
  }
});
