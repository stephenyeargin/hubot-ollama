const nock = require('nock').default;

const registry = require('../src/tool-registry');
const createCloudUsageTool = require('../src/tools/cloud-usage-tool');
const { fetchCloudUsage } = require('../src/tools/ollama-client');
const { formatCloudUsage } = require('../src/utils/ollama-utils');

const Helper = require('./helpers/hubot-helper');

const helper = new Helper('./../src/hubot-ollama.js');
const CLOUD = 'https://ollama.com';

const BALANCE = {
  included: {
    balance_usd: 72.5,
    allowance_usd: 100,
    period: { from: '2026-09-15T09:30:00Z', until: '2026-10-15T09:30:00Z' }
  },
  purchased: { balance_usd: 25 }
};
const LEGACY_BALANCE = {
  included: {
    session: { remaining_percent: 75, resets_at: '2026-10-01T07:00:00Z' },
    weekly: { remaining_percent: 40, resets_at: '2026-10-05T00:00:00Z' }
  },
  purchased: { balance_usd: 0 }
};
const USAGE = {
  range: '7d',
  scope: 'self',
  granularity: 'day',
  totals: { request_count: 15, usage_usd: 0.01718, input_tokens: 106000, cached_input_tokens: 46000, output_tokens: 13600 },
  buckets: []
};

const mockCloud = ({ balance = BALANCE, usage = USAGE, range = '7d' } = {}) => {
  const balanceScope = nock(CLOUD).matchHeader('authorization', 'Bearer test-key').get('/api/balance').reply(200, balance);
  const usageScope = nock(CLOUD).matchHeader('authorization', 'Bearer test-key').get('/api/usage').query({ range }).reply(200, usage);
  return { balanceScope, usageScope };
};

afterEach(() => {
  nock.cleanAll();
});

describe('fetchCloudUsage', () => {
  test('returns balance and usage from ollama.com', async () => {
    mockCloud();
    const result = await fetchCloudUsage('test-key');
    expect(result.balance).toEqual(BALANCE);
    expect(result.usage).toEqual(USAGE);
    expect(result.balanceError).toBeNull();
    expect(result.usageError).toBeNull();
  });

  test('returns one result when the other request fails', async () => {
    nock(CLOUD).get('/api/balance').reply(401, { error: 'unauthorized' });
    nock(CLOUD).get('/api/usage').query({ range: '24h' }).reply(200, USAGE);
    const result = await fetchCloudUsage('test-key', { range: '24h' });
    expect(result.balance).toBeNull();
    expect(result.balanceError.status).toBe(401);
    expect(result.balanceError.message).toContain('unauthorized');
    expect(result.usage).toEqual(USAGE);
  });

  test('captures Retry-After on 429', async () => {
    nock(CLOUD).get('/api/balance').reply(429, { error: 'too many requests' }, { 'Retry-After': '42' });
    nock(CLOUD).get('/api/usage').query(true).reply(503, { error: 'unavailable' });
    const result = await fetchCloudUsage('test-key');
    expect(result.balanceError.retryAfterSec).toBe(42);
    expect(result.usageError.status).toBe(503);
  });

  test('times out slow requests', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const result = await fetchCloudUsage('test-key', { timeoutMs: 50 });
    fetchSpy.mockRestore();
    expect(result.balance).toBeNull();
    expect(result.balanceError.name).toBe('AbortError');
    expect(result.usage).toBeNull();
  });
});

describe('formatCloudUsage', () => {
  test('formats current plan balance and usage', () => {
    const text = formatCloudUsage({ balance: BALANCE, usage: USAGE });
    expect(text).toContain('*Included credit:* $72.50 of $100.00 (73% left), resets 2026-10-15 09:30 UTC');
    expect(text).toContain('*Purchased credit:* $25.00');
    expect(text).toContain('*Usage (7d):* 15 requests, $0.02, 106,000 input tokens, 13,600 output tokens');
  });

  test('formats legacy session/weekly limits', () => {
    const text = formatCloudUsage({ balance: LEGACY_BALANCE, usage: null });
    expect(text).toContain('*Session limit:* 75% remaining, resets 2026-10-01 07:00 UTC');
    expect(text).toContain('*Weekly limit:* 40% remaining, resets 2026-10-05 00:00 UTC');
    expect(text).not.toContain('Usage');
  });

  test('omits cost and tokens for legacy usage', () => {
    const text = formatCloudUsage({ balance: null, usage: { range: '24h', totals: { request_count: 3 } } });
    expect(text).toBe('*Usage (24h):* 3 requests');
  });

  test('reports unavailable when nothing is returned', () => {
    expect(formatCloudUsage({ balance: null, usage: null })).toBe('Ollama cloud usage is unavailable right now.');
  });
});

describe('cloud usage tool', () => {
  test('has the expected shape', () => {
    const tool = createCloudUsageTool(null, { getCloudUsage: vi.fn() });
    expect(tool.name).toBe('hubot_ollama_cloud_usage');
    expect(tool.parameters.properties.range.enum).toEqual(['24h', '7d', '30d']);
  });

  test('defaults invalid range to 7d and returns totals', async () => {
    const getCloudUsage = vi.fn().mockResolvedValue({ balance: BALANCE, usage: USAGE });
    const tool = createCloudUsageTool(null, { getCloudUsage });
    const result = await tool.handler({ range: '1y' });
    expect(getCloudUsage).toHaveBeenCalledWith('7d');
    expect(result.summary).toContain('Included credit');
    expect(result.usage_totals).toMatchObject({ range: '7d', request_count: 15 });
  });

  test('returns an error when both requests failed', async () => {
    const getCloudUsage = vi.fn().mockResolvedValue({ balance: null, usage: null, balanceError: new Error('boom') });
    const tool = createCloudUsageTool(null, { getCloudUsage });
    expect(await tool.handler({})).toEqual({ error: 'Ollama cloud usage unavailable: boom' });
  });
});

describe('hubot ollama usage command', () => {
  let room = null;

  const createRoom = async (env) => {
    Object.assign(process.env, env);
    room = await helper.createRoom();
    ['debug', 'info', 'warn', 'warning', 'error'].forEach((method) => {
      room.robot.logger[method] = vi.fn();
    });
  };

  const say = async (text) => {
    await room.user.say('alice', text);
    await new Promise((resolve) => setTimeout(resolve, 150));
  };

  afterEach(() => {
    room?.destroy();
    registry.clearTools();
    delete process.env.HUBOT_OLLAMA_HOST;
    delete process.env.HUBOT_OLLAMA_API_KEY;
    delete process.env.HUBOT_OLLAMA_WEB_ENABLED;
    delete process.env.HUBOT_OLLAMA_MODEL;
  });

  test('local-only setup replies without network calls or tool registration', async () => {
    await createRoom({});
    await say('hubot ollama usage');
    expect(room.messages[1][1]).toBe('No Ollama API key is configured, so cloud usage is unavailable.');
    expect(registry.getTools()['hubot_ollama_cloud_usage']).toBeUndefined();
  });

  test('API key with a local model still reports no cloud usage', async () => {
    await createRoom({ HUBOT_OLLAMA_API_KEY: 'test-key' });
    await say('hubot ollama balance');
    expect(room.messages[1][1]).toBe('This bot only runs local models, so no Ollama cloud credit is being used.');
  });

  test('cloud host reports balance and caches the result', async () => {
    await createRoom({ HUBOT_OLLAMA_API_KEY: 'test-key', HUBOT_OLLAMA_HOST: 'https://ollama.com' });
    mockCloud({ range: '30d', usage: { ...USAGE, range: '30d' } });
    await say('hubot ollama usage 30d');
    expect(room.messages[1][1]).toContain('Included credit');
    expect(room.messages[1][1]).toContain('Usage (30d)');
    expect(nock.isDone()).toBe(true);

    await say('hubot ollama usage 30d');
    expect(room.messages[3][1]).toBe(room.messages[1][1]);
    expect(registry.getTools()['hubot_ollama_cloud_usage']).toBeDefined();
  });

  test('cloud model on a local host registers the tool', async () => {
    await createRoom({ HUBOT_OLLAMA_API_KEY: 'test-key', HUBOT_OLLAMA_MODEL: 'gpt-oss:120b-cloud' });
    expect(registry.getTools()['hubot_ollama_cloud_usage']).toBeDefined();
  });

  test('web tools on a local host register the tool', async () => {
    await createRoom({ HUBOT_OLLAMA_API_KEY: 'test-key', HUBOT_OLLAMA_WEB_ENABLED: 'true' });
    expect(registry.getTools()['hubot_ollama_cloud_usage']).toBeDefined();
  });
});
