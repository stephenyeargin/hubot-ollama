// Runs inside a worker thread spawned by javascript-repl-tool.js. Isolated in
// its own process-level worker (not just a vm context) so the parent can
// forcibly terminate it if sandboxed code escapes vm's synchronous-only
// timeout via a scheduled microtask/timer (e.g. `Promise.resolve().then(() =>
// { while (true) {} })`) — vm's `timeout` option only bounds the initial
// synchronous execution, not anything the script schedules for later.

const vm = require('node:vm');
const { parentPort, workerData } = require('node:worker_threads');

const MAX_OUTPUT_LEN = 2000;

const serialize = (result) => {
  if (result === undefined) return 'undefined';
  if (result === null) return 'null';
  if (typeof result === 'object') {
    const seen = new WeakSet();
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
  return str.length > MAX_OUTPUT_LEN ? str.slice(0, MAX_OUTPUT_LEN) + '…[truncated]' : str;
};

const { code } = workerData;

// Create a null-prototype sandbox and expose a minimal, frozen API
const context = Object.create(null);
Object.defineProperty(context, 'Math', { value: Object.freeze(Math), enumerable: true });
Object.defineProperty(context, 'JSON', { value: Object.freeze(JSON), enumerable: true });
Object.defineProperty(context, 'isNaN', { value: isNaN, enumerable: true });
Object.defineProperty(context, 'isFinite', { value: isFinite, enumerable: true });
Object.defineProperty(context, 'parseInt', { value: parseInt, enumerable: true });
Object.defineProperty(context, 'parseFloat', { value: parseFloat, enumerable: true });

try {
  const script = new vm.Script(code, { displayErrors: true });
  const sandbox = vm.createContext(context);
  const result = script.runInNewContext(sandbox, { timeout: 1000 });
  parentPort.postMessage({ ok: true, value: serialize(result) });
} catch (err) {
  parentPort.postMessage({ ok: false, message: err && err.message });
}
