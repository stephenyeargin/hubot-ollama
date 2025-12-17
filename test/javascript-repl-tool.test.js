const createJavaScriptReplTool = require('../src/tools/javascript-repl-tool');

describe('JavaScript REPL Tool', () => {
  let tool;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn()
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

  it('should handle syntax errors gracefully', async () => {
    await expect(tool.handler({ code: 'this is not valid javascript' }))
      .rejects.toThrow();
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
