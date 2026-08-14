const path = require('node:path');
const { Worker } = require('node:worker_threads');

// The internal vm timeout given to the worker (see javascript-repl-worker.js).
// The external HARD_TIMEOUT_MS below must be strictly larger than this so the
// worker gets a chance to report a normal vm timeout error before we resort
// to force-terminating it.
const HARD_TIMEOUT_MS = 2000;

const WORKER_PATH = path.join(__dirname, 'javascript-repl-worker.js');

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

    return new Promise((resolve, reject) => {
      const worker = new Worker(WORKER_PATH, { workerData: { code } });
      let settled = false;

      const finish = (fn) => {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimeout);
        // Forcibly kill the worker's whole JS realm/event loop, so code that
        // escaped vm's synchronous-only timeout via a microtask or timer
        // can't keep running after we've already moved on.
        worker.terminate().catch(() => {});
        fn();
      };

      const hardTimeout = setTimeout(() => {
        logger?.debug('JavaScript REPL: hard-terminating worker after exceeding external timeout');
        finish(() => reject(new Error('Script execution timed out')));
      }, HARD_TIMEOUT_MS);

      worker.once('message', (msg) => {
        finish(() => {
          if (msg && msg.ok) {
            resolve(msg.value);
          } else {
            const message = (msg && msg.message) || 'Script execution failed';
            logger?.debug(`JavaScript REPL error: ${message}`);
            reject(new Error(message));
          }
        });
      });

      worker.once('error', (err) => {
        finish(() => {
          logger?.debug(`JavaScript REPL worker error: ${err && err.message}`);
          reject(err);
        });
      });

      worker.once('exit', (exitCode) => {
        finish(() => reject(new Error(`Script execution worker exited unexpectedly (code ${exitCode})`)));
      });
    });
  }
});
