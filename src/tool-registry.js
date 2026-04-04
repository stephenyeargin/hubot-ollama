const tools = {};

/**
 * Register Available Tools
 */
module.exports = {
  registerTool(name, definition) {
    if (!name) {
      throw new Error('Tool must have a name');
    }
    if (!definition || typeof definition !== "object") {
      throw new Error(`Tool "${name}" must provide a definition object`);
    }
    if (typeof definition.handler !== 'function') {
      throw new Error(`Tool "${name}" must provide an async handler function`);
    }
    if (!definition.description) {
      throw new Error(`Tool "${name}" must provide a description`);
    }

    // Normalize parameters to JSON Schema object shape: { type, properties, required? }
    // Tools that pass a flat { fieldName: { type, description } } map get wrapped automatically.
    const rawParams = definition.parameters || {};
    const parameters = (rawParams.type || rawParams.properties)
      ? rawParams
      : { type: 'object', properties: rawParams };

    tools[name] = {
      name,
      ...definition,
      parameters
    };
  },

  getTools() {
    return { ...tools };
  },

  clearTools() {
    // Clear all tools except the built-in one
    for (const key of Object.keys(tools)) {
      if (key !== 'hubot_ollama_get_current_time') {
        delete tools[key];
      }
    }
  }
};

// Built-in tool: Get current time
module.exports.registerTool('hubot_ollama_get_current_time', {
  description: 'Get the current date and time in ISO 8601 format (UTC)',
  parameters: {},
  handler: async () => ({
    timestamp: new Date().toISOString()
  })
});
