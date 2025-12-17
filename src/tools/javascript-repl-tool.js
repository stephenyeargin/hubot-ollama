const vm = require('node:vm');

module.exports = (_ollama, _config, logger) => ({
  name: 'hubot_ollama_run_javascript',
  description: 'Run sandboxed JavaScript for deterministic calculations and data transformation',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'JavaScript code to execute',
      }
    },
    required: [ 'code' ]
  },
  handler: async (args) => {
    const { code } = args;

    if (!code || typeof code !== 'string') {
      throw new Error('Code parameter is required and must be a string');
    }

    // Prevent excessively long code
    if (code.length > 10000) {
      throw new Error('Code exceeds maximum length of 10000 characters');
    }

    // Create a null-prototype sandbox and expose a minimal, frozen API
    const context = Object.create(null);

    // Deterministic, computation-focused built-ins
    Object.defineProperty(context, 'Math', { value: Object.freeze(Math), enumerable: true });
    Object.defineProperty(context, 'JSON', { value: Object.freeze(JSON), enumerable: true });
    Object.defineProperty(context, 'isNaN', { value: isNaN, enumerable: true });
    Object.defineProperty(context, 'isFinite', { value: isFinite, enumerable: true });
    Object.defineProperty(context, 'parseInt', { value: parseInt, enumerable: true });
    Object.defineProperty(context, 'parseFloat', { value: parseFloat, enumerable: true });

    try {
      const script = new vm.Script(code, { displayErrors: true });
      const sandbox = vm.createContext(context);

      // Execute in a new context with a strict timeout to reduce DoS risk
      const result = script.runInNewContext(sandbox, { timeout: 1000 });

      // Handle various result types
      if (result === undefined) {
        return 'undefined';
      }
      if (result === null) {
        return 'null';
      }
      if (typeof result === 'object') {
        // Safe serialization with truncation and circular handling
        const seen = new WeakSet();
        const MAX_OUTPUT_LEN = 2000;
        const json = JSON.stringify(result, (key, value) => {
          if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) return '[Circular]';
            seen.add(value);
          }
          if (typeof value === 'function') return '[Function]';
          return value;
        });
        return json.length > MAX_OUTPUT_LEN ? json.slice(0, MAX_OUTPUT_LEN) + '…[truncated]' : json;
      }

      const str = String(result);
      return str.length > 2000 ? str.slice(0, 2000) + '…[truncated]' : str;
    } catch (err) {
      logger?.debug(`JavaScript REPL error: ${err.message}`);
      throw err;
    }
  }
});
