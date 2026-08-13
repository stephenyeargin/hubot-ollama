const ollamaClient = require('../src/tools/ollama-client');
const webFetchTool = require('../src/tools/web-fetch-tool');

describe('web-fetch-tool', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(ollamaClient, 'runWebFetchMany');
  });

  test('tool definition includes required properties', () => {
    const mockOllama = {};
    const config = {
      WEB_MAX_RESULTS: 5,
      WEB_MAX_BYTES: 120000,
      WEB_FETCH_CONCURRENCY: 3,
      WEB_TIMEOUT_MS: 45000
    };
    const logger = { debug: vi.fn(), error: vi.fn(), warn: vi.fn() };

    const tool = webFetchTool(mockOllama, config, logger);

    expect(tool.name).toBe('hubot_ollama_web_fetch');
    expect(tool.description).toBeTruthy();
    expect(typeof tool.handler).toBe('function');
    expect(tool.parameters).toBeTruthy();
    expect(tool.parameters.urls).toBeTruthy();
    expect(tool.parameters.urls.type).toBe('array');
  });

  test('handler gracefully handles fetch errors', async () => {
    const mockOllama = {};
    const config = {
      WEB_MAX_RESULTS: 5,
      WEB_MAX_BYTES: 120000,
      WEB_FETCH_CONCURRENCY: 3,
      WEB_TIMEOUT_MS: 45000
    };
    const logger = { debug: vi.fn(), error: vi.fn(), warn: vi.fn() };

    const tool = webFetchTool(mockOllama, config, logger);
    const result = await tool.handler({ urls: [] }, { brain: { get: vi.fn(), set: vi.fn() } }, {});

    expect(result).toHaveProperty('error');
    expect(result.error).toBe('No URLs provided for fetching');
  });

  test('handler returns standardized page format with url and content', async () => {
    const mockOllama = {};
    const config = {
      WEB_MAX_RESULTS: 5,
      WEB_MAX_BYTES: 120000,
      WEB_FETCH_CONCURRENCY: 3,
      WEB_TIMEOUT_MS: 45000
    };
    const logger = { debug: vi.fn(), error: vi.fn(), warn: vi.fn() };

    const mockRobot = {
      brain: {
        get: vi.fn(() => ({})),
        set: vi.fn()
      }
    };

    // Mock successful fetch
    ollamaClient.runWebFetchMany.mockResolvedValue([
      { url: 'https://example.com/1', text: 'Content 1' },
      { url: 'https://example.com/2', content: 'Content 2' }
    ]);

    const tool = webFetchTool(mockOllama, config, logger);
    const result = await tool.handler(
      { urls: ['https://example.com/1', 'https://example.com/2'] },
      mockRobot,
      {}
    );

    expect(result).toHaveProperty('pages');
    expect(Array.isArray(result.pages)).toBe(true);
    expect(result.pages.length).toBe(2);

    // Verify standardized format
    expect(result.pages[0]).toEqual({
      url: 'https://example.com/1',
      content: 'Content 1'
    });

    expect(result.pages[1]).toEqual({
      url: 'https://example.com/2',
      content: 'Content 2'
    });
  });

  test('handler prevents fetching already-fetched URLs', async () => {
    const mockOllama = {};
    const config = {
      WEB_MAX_RESULTS: 5,
      WEB_MAX_BYTES: 120000,
      WEB_FETCH_CONCURRENCY: 3,
      WEB_TIMEOUT_MS: 45000
    };
    const logger = { debug: vi.fn(), error: vi.fn(), warn: vi.fn() };

    // Setup robot with tracked URLs (use array, not Set)
    const invocationContextKey = 'test-invocation-789';
    const fetchedUrls = {
      [invocationContextKey]: ['https://example.com/1']
    };
    const mockRobot = {
      brain: {
        get: vi.fn((key) => key === 'ollamaFetchedUrls' ? fetchedUrls : ({})),
        set: vi.fn()
      }
    };

    const tool = webFetchTool(mockOllama, config, logger);
    const result = await tool.handler(
      {
        urls: ['https://example.com/1'],
        _invocationContextKey: invocationContextKey
      },
      mockRobot,
      { message: { room: 'room', user: { id: 'user' } } }
    );

    expect(result).toHaveProperty('error');
    expect(result.error).toContain('All URLs already fetched');
    expect(ollamaClient.runWebFetchMany).not.toHaveBeenCalled();
  });

  test('handler fetches only new URLs when some are already fetched', async () => {
    const mockOllama = {};
    const config = {
      WEB_MAX_RESULTS: 5,
      WEB_MAX_BYTES: 120000,
      WEB_FETCH_CONCURRENCY: 3,
      WEB_TIMEOUT_MS: 45000
    };
    const logger = { debug: vi.fn(), error: vi.fn(), warn: vi.fn() };

    // Setup robot with one already-fetched URL (use array, not Set)
    const invocationContextKey = 'test-invocation-123';
    const fetchedUrls = {
      [invocationContextKey]: ['https://example.com/1']
    };
    const mockRobot = {
      brain: {
        get: vi.fn((key) => key === 'ollamaFetchedUrls' ? fetchedUrls : ({})),
        set: vi.fn()
      }
    };

    ollamaClient.runWebFetchMany.mockResolvedValue([
      { url: 'https://example.com/2', text: 'Content 2' }
    ]);

    const tool = webFetchTool(mockOllama, config, logger);
    const result = await tool.handler(
      {
        urls: ['https://example.com/1', 'https://example.com/2'],
        _invocationContextKey: invocationContextKey
      },
      mockRobot,
      { message: { room: 'room', user: { id: 'user' } } }
    );

    expect(result).toHaveProperty('pages');
    expect(result.pages.length).toBe(1);
    expect(result.pages[0].url).toBe('https://example.com/2');

    // Verify only the new URL was fetched
    expect(ollamaClient.runWebFetchMany).toHaveBeenCalledWith(
      mockOllama,
      [{ url: 'https://example.com/2' }],
      120000,
      3,
      45000,
      logger
    );
  });

  test('handler tracks fetched URLs in robot brain', async () => {
    const mockOllama = {};
    const config = {
      WEB_MAX_RESULTS: 5,
      WEB_MAX_BYTES: 120000,
      WEB_FETCH_CONCURRENCY: 3,
      WEB_TIMEOUT_MS: 45000
    };
    const logger = { debug: vi.fn(), error: vi.fn(), warn: vi.fn() };

    const invocationContextKey = 'test-invocation-456';
    const fetchedUrls = {};
    const mockRobot = {
      brain: {
        get: vi.fn((key) => key === 'ollamaFetchedUrls' ? fetchedUrls : ({})),
        set: vi.fn()
      }
    };

    ollamaClient.runWebFetchMany.mockResolvedValue([
      { url: 'https://example.com/1', text: 'Content 1' }
    ]);

    const tool = webFetchTool(mockOllama, config, logger);
    await tool.handler(
      {
        urls: ['https://example.com/1'],
        _invocationContextKey: invocationContextKey
      },
      mockRobot,
      { message: { room: 'room', user: { id: 'user' } } }
    );

    // Verify URLs were tracked
    expect(mockRobot.brain.set).toHaveBeenCalledWith('ollamaFetchedUrls', expect.any(Object));
  });

  test('accumulates URLs across multiple fetch calls within the same invocation', async () => {
    // This is the mechanism hubot-ollama.js relies on to aggregate all fetched
    // URLs from an invocation into a single post-response source summary.
    const mockOllama = {};
    const config = {
      WEB_MAX_RESULTS: 5,
      WEB_MAX_BYTES: 120000,
      WEB_FETCH_CONCURRENCY: 3,
      WEB_TIMEOUT_MS: 45000
    };
    const logger = { debug: vi.fn(), error: vi.fn(), warn: vi.fn() };

    const invocationContextKey = 'test-invocation-aggregate';
    const fetchedUrls = {};
    const mockRobot = {
      brain: {
        get: vi.fn((key) => key === 'ollamaFetchedUrls' ? fetchedUrls : ({})),
        set: vi.fn()
      }
    };

    const tool = webFetchTool(mockOllama, config, logger);

    ollamaClient.runWebFetchMany.mockResolvedValueOnce([
      { url: 'https://example.com/1', text: 'Content 1' }
    ]);
    await tool.handler(
      { urls: ['https://example.com/1'], _invocationContextKey: invocationContextKey },
      mockRobot,
      { message: { room: 'room', user: { id: 'user' } } }
    );

    ollamaClient.runWebFetchMany.mockResolvedValueOnce([
      { url: 'https://example.com/2', text: 'Content 2' }
    ]);
    await tool.handler(
      { urls: ['https://example.com/2'], _invocationContextKey: invocationContextKey },
      mockRobot,
      { message: { room: 'room', user: { id: 'user' } } }
    );

    expect(fetchedUrls[invocationContextKey]).toEqual([
      'https://example.com/1',
      'https://example.com/2'
    ]);
  });

  test('handler validates URLs', async () => {
    const mockOllama = {};
    const config = {
      WEB_MAX_RESULTS: 5,
      WEB_MAX_BYTES: 120000,
      WEB_FETCH_CONCURRENCY: 3,
      WEB_TIMEOUT_MS: 45000
    };
    const logger = { debug: vi.fn(), error: vi.fn(), warn: vi.fn() };

    const mockRobot = {
      brain: {
        get: vi.fn(() => ({})),
        set: vi.fn()
      }
    };

    // Mock fetch failure
    ollamaClient.runWebFetchMany.mockRejectedValue(new Error('Fetch API failure'));

    const tool = webFetchTool(mockOllama, config, logger);
    const result = await tool.handler(
      { urls: ['https://example.com/1'] },
      mockRobot,
      {}
    );

    expect(result).toHaveProperty('error');
    expect(result.error).toContain('Failed to fetch URLs');
  });
});
