// Ollama cloud usage tool — reports remaining cloud credit and recent spend.
// Only registered when the bot actually consumes cloud credit (cloud host,
// cloud model, or web tools); local models cost nothing.

const { formatCloudUsage } = require('../utils/ollama-utils');

const RANGES = ['24h', '7d', '30d'];

module.exports = (_ollama, config, logger) => ({
  name: 'hubot_ollama_cloud_usage',
  description: 'Look up the remaining Ollama cloud credit balance and recent usage/spend. ' +
    'Use this only when the user asks about Ollama credit, balance, spend, quota, or usage. ' +
    'Cloud models, web search, and web fetch consume credit; local models do not.',
  parameters: {
    type: 'object',
    properties: {
      range: {
        type: 'string',
        enum: RANGES,
        description: 'Usage window: 24h, 7d (default), or 30d.'
      }
    },
    required: []
  },
  handler: async (args) => {
    const range = RANGES.includes(args && args.range) ? args.range : '7d';
    try {
      const result = await config.getCloudUsage(range);
      if (!result.balance && !result.usage) {
        const err = result.balanceError || result.usageError;
        return { error: `Ollama cloud usage unavailable: ${err ? err.message : 'unknown error'}` };
      }
      return {
        summary: formatCloudUsage(result),
        balance: result.balance,
        usage_totals: result.usage ? { range: result.usage.range, ...result.usage.totals } : null
      };
    } catch (error) {
      logger?.error(`Cloud usage tool error: ${error.message}`);
      return { error: error.message };
    }
  }
});
