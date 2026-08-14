const createJavaScriptReplTool = require('../src/tools/javascript-repl-tool');

describe('JavaScript REPL Tool', () => {
  let tool;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn()
    };
    tool = createJavaScriptReplTool(null, {}, mockLogger);
  });

  it('should have correct name and structure', () => {
    expect(tool.name).toBe('hubot_ollama_run_javascript');
    expect(typeof tool.description).toBe('string');
    expect(typeof tool.parameters).toBe('object');
    expect(typeof tool.handler).toBe('function');
  });

  it('should execute basic math operations', async () => {
    const result = await tool.handler({ code: '2 + 2' });
    expect(result).toBe('4');
  });

  it('should execute Math functions', async () => {
    const result = await tool.handler({ code: 'Math.sqrt(16)' });
    expect(result).toBe('4');
  });

  it('should execute Math.PI', async () => {
    const result = await tool.handler({ code: 'Math.PI' });
    expect(result).toBe(String(Math.PI));
  });

  it('should handle complex expressions', async () => {
    const result = await tool.handler({ code: 'Math.pow(2, 10)' });
    expect(result).toBe('1024');
  });

  it('should handle array operations', async () => {
    const result = await tool.handler({ code: '[1, 2, 3].reduce((a, b) => a + b, 0)' });
    expect(result).toBe('6');
  });

  it('should handle number formatting', async () => {
    const result = await tool.handler({ code: '(1234.5678).toFixed(2)' });
    expect(result).toBe('1234.57');
  });

  it('should sandbox and prevent access to require', async () => {
    await expect(tool.handler({ code: 'require("fs")' }))
      .rejects.toThrow('require is not defined');
  });

  it('should sandbox and prevent access to process', async () => {
    await expect(tool.handler({ code: 'process.exit(1)' }))
      .rejects.toThrow('process is not defined');
  });

  it('should enforce timeout', async () => {
    await expect(tool.handler({ code: 'while(true) {}' }))
      .rejects.toThrow('Script execution timed out');
  });

  it('terminates the worker after a script that keeps rescheduling itself via microtasks, instead of leaving it running forever', async () => {
    // vm's `timeout` option only bounds the script's initial synchronous
    // execution. Code that reschedules itself via Promise.then() always
    // returns synchronously right away (that's what makes this an escape:
    // vm's timeout never even gets a chance to trigger), then keeps the
    // worker's event loop spinning forever afterward — unless the worker
    // itself gets torn down once we have our answer, which is what the
    // external worker.terminate() call must guarantee regardless of what's
    // still pending inside it.
    const { Worker } = require('node:worker_threads');
    const terminateSpy = vi.spyOn(Worker.prototype, 'terminate');

    const result = await tool.handler({ code: 'function spin() { Promise.resolve().then(spin); } spin(); "ok"' });

    expect(result).toBe('ok');
    expect(terminateSpy).toHaveBeenCalled();
  });

  it('should handle syntax errors gracefully', async () => {
    await expect(tool.handler({ code: 'this is not valid javascript' }))
      .rejects.toThrow();
  });

  it('should serialize circular references as [Circular] instead of throwing', async () => {
    const result = await tool.handler({ code: 'const o = {}; o.self = o; o' });
    expect(result).toBe('{"self":"[Circular]"}');
  });

  it('should serialize function-valued properties as [Function]', async () => {
    const result = await tool.handler({ code: '({ fn: function() {}, value: 1 })' });
    expect(result).toBe('{"fn":"[Function]","value":1}');
  });

  it('should truncate oversized object results at 2000 characters', async () => {
    const result = await tool.handler({ code: '({ big: "x".repeat(3000) })' });
    expect(result.length).toBe(2000 + '…[truncated]'.length);
    expect(result.endsWith('…[truncated]')).toBe(true);
  });

  it('should truncate oversized string results at 2000 characters', async () => {
    const result = await tool.handler({ code: '"x".repeat(3000)' });
    expect(result.length).toBe(2000 + '…[truncated]'.length);
    expect(result.endsWith('…[truncated]')).toBe(true);
  });

  it('should return string representation of results', async () => {
    const result = await tool.handler({ code: '{ foo: "bar" }' });
    expect(typeof result).toBe('string');
  });

  it('should handle division', async () => {
    const result = await tool.handler({ code: '100 / 4' });
    expect(result).toBe('25');
  });

  it('should handle modulo', async () => {
    const result = await tool.handler({ code: '10 % 3' });
    expect(result).toBe('1');
  });

  it('should handle floating point arithmetic', async () => {
    const result = await tool.handler({ code: '0.1 + 0.2' });
    expect(result).toBe(String(0.1 + 0.2));
  });

  it('should handle Math.round', async () => {
    const result = await tool.handler({ code: 'Math.round(4.7)' });
    expect(result).toBe('5');
  });

  it('should handle Math.floor', async () => {
    const result = await tool.handler({ code: 'Math.floor(4.7)' });
    expect(result).toBe('4');
  });

  it('should handle Math.ceil', async () => {
    const result = await tool.handler({ code: 'Math.ceil(4.3)' });
    expect(result).toBe('5');
  });

  it('should handle Math.max', async () => {
    const result = await tool.handler({ code: 'Math.max(10, 20, 5, 30)' });
    expect(result).toBe('30');
  });

  it('should handle Math.min', async () => {
    const result = await tool.handler({ code: 'Math.min(10, 20, 5, 30)' });
    expect(result).toBe('5');
  });

  it('should reject empty code', async () => {
    await expect(tool.handler({ code: '' }))
      .rejects.toThrow('Code parameter is required');
  });

  it('should reject missing code parameter', async () => {
    await expect(tool.handler({}))
      .rejects.toThrow('Code parameter is required');
  });

  it('should reject non-string code', async () => {
    await expect(tool.handler({ code: 123 }))
      .rejects.toThrow('Code parameter is required');
  });

  it('should reject excessively long code', async () => {
    const longCode = 'x = 1;'.repeat(2000);
    await expect(tool.handler({ code: longCode }))
      .rejects.toThrow('Code exceeds maximum length');
  });

  it('should handle undefined results', async () => {
    const result = await tool.handler({ code: 'undefined' });
    expect(result).toBe('undefined');
  });

  it('should handle null results', async () => {
    const result = await tool.handler({ code: 'null' });
    expect(result).toBe('null');
  });

  it('should handle boolean results', async () => {
    const result = await tool.handler({ code: 'true' });
    expect(result).toBe('true');
  });

  it('should handle object results as JSON', async () => {
    const result = await tool.handler({ code: '({a: 1, b: 2})' });
    expect(result).toBe('{"a":1,"b":2}');
  });

  it('should handle array results as JSON', async () => {
    const result = await tool.handler({ code: '[1, 2, 3]' });
    expect(result).toBe('[1,2,3]');
  });

  it('should support parseFloat', async () => {
    const result = await tool.handler({ code: 'parseFloat("3.14")' });
    expect(result).toBe('3.14');
  });

  it('should support parseInt', async () => {
    const result = await tool.handler({ code: 'parseInt("42")' });
    expect(result).toBe('42');
  });

  it('should support JSON operations', async () => {
    const result = await tool.handler({ code: 'JSON.stringify({test: 123})' });
    expect(result).toBe('{"test":123}');
  });

  it('should support isNaN', async () => {
    const result = await tool.handler({ code: 'isNaN("hello")' });
    expect(result).toBe('true');
  });

  it('should support Date operations', async () => {
    const result = await tool.handler({ code: 'new Date(2025, 0, 1).getFullYear()' });
    expect(result).toBe('2025');
  });
});
