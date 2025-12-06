const client = require('../src/tools/ollama-client');

describe('ollama-client', () => {
  test('exports expected functions', () => {
    expect(typeof client.runWebSearch).toBe('function');
    expect(typeof client.runWebFetchMany).toBe('function');
    expect(typeof client.buildWebContextMessage).toBe('function');
  });

  describe('buildWebContextMessage', () => {
    test('formats context from pages', () => {
      const pages = [
        { title: 'Title1', url: 'http://a', text: 'abc' },
        { title: 'Title2', url: 'http://b', text: 'defghijk' }
      ];
      const result = client.buildWebContextMessage(pages, 5);
      expect(result).toContain('Title1');
      expect(result).toContain('Title2');
      expect(result).toContain('abc');
      expect(result).toContain('defgh');
    });
  });
});
