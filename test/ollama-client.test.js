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

  describe('runWebFetchMany', () => {
    test('returns fetched content for successful requests', async () => {
      const ollama = { webFetch: vi.fn().mockResolvedValue({ text: 'fetched body' }) };
      const results = await client.runWebFetchMany(
        ollama, [{ url: 'http://a', title: 'A' }], 1000, 2, 1000, undefined
      );
      expect(results).toEqual([{ title: 'A', url: 'http://a', text: 'fetched body' }]);
    });

    test('falls back to the search snippet when the fetch fails and one is available', async () => {
      const ollama = { webFetch: vi.fn().mockRejectedValue(new Error('network error')) };
      const logger = { debug: vi.fn(), error: vi.fn() };
      const results = await client.runWebFetchMany(
        ollama, [{ url: 'http://a', title: 'A', content: 'snippet from search results' }], 1000, 2, 1000, logger
      );
      expect(results).toEqual([{ title: 'A', url: 'http://a', text: 'snippet from search results' }]);
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('using search snippet fallback'));
      expect(logger.error).not.toHaveBeenCalled();
    });

    test('drops the URL and logs an error when the fetch fails with no snippet to fall back on', async () => {
      const ollama = { webFetch: vi.fn().mockRejectedValue(new Error('network error')) };
      const logger = { debug: vi.fn(), error: vi.fn() };
      const results = await client.runWebFetchMany(
        ollama, [{ url: 'http://a', title: 'A' }], 1000, 2, 1000, logger
      );
      expect(results).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Fetch for <http://a> failed') }));
    });

    test('falls back to the search snippet when the fetch succeeds but returns no usable body field', async () => {
      const ollama = { webFetch: vi.fn().mockResolvedValue({}) };
      const results = await client.runWebFetchMany(
        ollama, [{ url: 'http://a', title: 'A', content: 'snippet' }], 1000, 2, 1000, undefined
      );
      expect(results).toEqual([{ title: 'A', url: 'http://a', text: 'snippet' }]);
    });

    test('processes multiple URLs with bounded concurrency', async () => {
      const ollama = { webFetch: vi.fn().mockImplementation(({ url }) => Promise.resolve({ text: `body for ${url}` })) };
      const urls = [{ url: 'http://a' }, { url: 'http://b' }, { url: 'http://c' }];
      const results = await client.runWebFetchMany(ollama, urls, 1000, 2, 1000, undefined);
      expect(results.map((r) => r.url).sort()).toEqual(['http://a', 'http://b', 'http://c']);
      expect(ollama.webFetch).toHaveBeenCalledTimes(3);
    });
  });
});
