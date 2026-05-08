// Hubot help tool — surfaces available Hubot commands to the LLM so it can
// suggest the correct command when the user appears to have mistyped one, or
// when the user explicitly asks how to use Hubot.

module.exports = (_ollama, _config, logger) => ({
  name: 'hubot_ollama_help',
  description: 'Look up available Hubot commands and their descriptions. ' +
    'Use this tool when a user message looks like a mistyped or misremembered Hubot command, ' +
    'when the user asks what Hubot can do, or when you need to suggest the correct command to ' +
    'trigger a specific Hubot feature (e.g. the user typed "piing" and likely meant "ping"). ' +
    'Returns all registered commands when no query is given, or only commands whose text ' +
    'contains the query string when one is provided.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Optional substring to filter help commands. When omitted, all commands are returned.'
      }
    },
    required: []
  },
  handler: async (args, robot) => {
    if (!robot || typeof robot.helpCommands !== 'function') {
      // Likely means that the hubot-help package is not enabled
      throw new Error('robot.helpCommands is not available');
    }

    const robotName = (robot.alias || robot.name || 'hubot');
    let commands = robot.helpCommands().map((cmd) => {
      // Replace leading "hubot" with the actual bot name (mirrors hubot-help behavior)
      if (robotName.length === 1) {
        return cmd.replace(/^hubot\s*/i, robotName);
      }
      return cmd.replace(/^hubot/i, robotName);
    }).sort();

    const { query } = args || {};
    if (query && typeof query === 'string' && query.trim().length > 0) {
      const pattern = query.trim();
      logger?.debug(`hubot_ollama_help: filtering ${commands.length} commands by query "${pattern}"`);
      commands = commands.filter((cmd) =>
        cmd.toLowerCase().includes(pattern.toLowerCase())
      );
      logger?.info(`hubot_ollama_help: ${commands.length} command(s) matched query "${pattern}"`);
    } else {
      logger?.debug(`hubot_ollama_help: returning all ${commands.length} commands (no query)`);
    }

    if (commands.length === 0) {
      return { commands: [], message: `No commands found matching "${query}".` };
    }

    return { commands };
  }
});

