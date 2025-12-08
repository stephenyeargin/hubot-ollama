const ollamaClient = require('../src/tools/ollama-client');
const webSearchTool = require('../src/tools/web-search-tool');

jest.mock('../src/tools/ollama-client');

describe('web-search-tool', () => {
  test('tool definition includes required properties', () => {
    const mockOllama = {};
    const config = {
      WEB_MAX_RESULTS: 5,
      WEB_MAX_BYTES: 120000,
      WEB_FETCH_CONCURRENCY: 3,
      WEB_TIMEOUT_MS: 45000
    };
    const logger = { debug: jest.fn(), error: jest.fn() };

    const tool = webSearchTool(mockOllama, config, logger);

    expect(tool.name).toBe('hubot_ollama_web_search');
    expect(tool.description).toBeTruthy();
    expect(typeof tool.handler).toBe('function');
    expect(tool.parameters).toBeTruthy();
    expect(tool.parameters.query).toBeTruthy();
  });

  test('handler returns error when query is empty', async () => {
    const mockOllama = {};
    const config = {
      WEB_MAX_RESULTS: 5,
      WEB_MAX_BYTES: 120000,
      WEB_FETCH_CONCURRENCY: 3,
      WEB_TIMEOUT_MS: 45000
    };
    const logger = { debug: jest.fn(), error: jest.fn() };

    const tool = webSearchTool(mockOllama, config, logger);
    const result = await tool.handler({ query: '' }, {}, {});

    expect(result).toHaveProperty('error');
    expect(result.error).toBe('No search query provided');
  });

  test('handler returns ONLY search metadata (title, url, snippet)', async () => {
    const mockOllama = {};
    const config = {
      WEB_MAX_RESULTS: 5,
      WEB_MAX_BYTES: 120000,
      WEB_FETCH_CONCURRENCY: 3,
      WEB_TIMEOUT_MS: 45000
    };
    const logger = { debug: jest.fn(), error: jest.fn() };

    // Mock successful web search (NO fetch)
    ollamaClient.runWebSearch.mockResolvedValue([
      { title: 'Result 1', url: 'https://example.com/1', snippet: 'This is a snippet', content: 'This content should NOT be returned' },
      { title: 'Result 2', url: 'https://example.com/2', description: 'Alternative description' }
    ]);

    const tool = webSearchTool(mockOllama, config, logger);
    const result = await tool.handler({ query: 'test search' }, {}, {});

    expect(result).toHaveProperty('results');
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results.length).toBe(2);

    // Verify only metadata is returned
    expect(result.results[0]).toEqual({
      title: 'Result 1',
      url: 'https://example.com/1',
      snippet: 'This is a snippet'
    });

    expect(result.results[1]).toEqual({
      title: 'Result 2',
      url: 'https://example.com/2',
      snippet: 'Alternative description'
    });

    // Verify fetch was NOT called
    expect(ollamaClient.runWebFetchMany).not.toHaveBeenCalled();
    expect(ollamaClient.buildWebContextMessage).not.toHaveBeenCalled();
  });

  test('handler performs web search with provided query', async () => {
    const mockOllama = {};
    const config = {
      WEB_MAX_RESULTS: 5,
      WEB_MAX_BYTES: 120000,
      WEB_FETCH_CONCURRENCY: 3,
      WEB_TIMEOUT_MS: 45000
    };
    const logger = { debug: jest.fn(), error: jest.fn() };

    // Mock successful web search
    ollamaClient.runWebSearch.mockResolvedValue([
      { title: 'Result 1', url: 'https://example.com/1', snippet: 'Snippet 1' }
    ]);

    const tool = webSearchTool(mockOllama, config, logger);
    const result = await tool.handler({ query: 'test search' }, {}, {});

    expect(result.results).toBeTruthy();
    expect(result.results.length).toBe(1);
    expect(ollamaClient.runWebSearch).toHaveBeenCalledWith(mockOllama, 'test search', 5);
  });

  test('handler returns error when search fails', async () => {
    const mockOllama = {};
    const config = {
      WEB_MAX_RESULTS: 5,
      WEB_MAX_BYTES: 120000,
      WEB_FETCH_CONCURRENCY: 3,
      WEB_TIMEOUT_MS: 45000
    };
    const logger = { debug: jest.fn(), error: jest.fn() };

    // Mock search failure
    ollamaClient.runWebSearch.mockRejectedValue(new Error('Search API failure'));

    const tool = webSearchTool(mockOllama, config, logger);
    const result = await tool.handler({ query: 'test' }, {}, {});

    expect(result).toHaveProperty('error');
    expect(result.error).toContain('Web search failed');
  });

  test('handler returns error when no results found', async () => {
    const mockOllama = {};
    const config = {
      WEB_MAX_RESULTS: 5,
      WEB_MAX_BYTES: 120000,
      WEB_FETCH_CONCURRENCY: 3,
      WEB_TIMEOUT_MS: 45000
    };
    const logger = { debug: jest.fn(), error: jest.fn() };

    // Mock empty results
    ollamaClient.runWebSearch.mockResolvedValue([]);

    const tool = webSearchTool(mockOllama, config, logger);
    const result = await tool.handler({ query: 'test' }, {}, {});

    expect(result).toHaveProperty('error');
    expect(result.error).toBe('No search results found');
  });
});
