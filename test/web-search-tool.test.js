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

  test('handler returns no results when query is empty', async () => {
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

    expect(result).toHaveProperty('needsWeb');
    expect(result.needsWeb).toBe(false);
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

    // Mock successful web search and fetch
    ollamaClient.runWebSearch.mockResolvedValue([
      { title: 'Result 1', url: 'https://example.com/1', content: 'Content 1' }
    ]);
    ollamaClient.runWebFetchMany.mockResolvedValue([
      { title: 'Result 1', url: 'https://example.com/1', text: 'Fetched content' }
    ]);
    ollamaClient.buildWebContextMessage.mockReturnValue('Built context');

    const tool = webSearchTool(mockOllama, config, logger);
    const result = await tool.handler({ query: 'test search' }, {}, {});

    expect(result).toHaveProperty('context');
    expect(result.context).toBe('Built context');
    expect(ollamaClient.runWebSearch).toHaveBeenCalledWith(mockOllama, 'test search', 5);
  });

  test('handler gracefully handles search errors', async () => {
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

    // Should return no results found, not error
    expect(result).toHaveProperty('needsWeb');
    expect(result.message).toBe('No search results found');
  });
});
