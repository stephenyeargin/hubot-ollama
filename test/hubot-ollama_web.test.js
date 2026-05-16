const path = require('path');

const mockRequire = require('mock-require');

const registry = require('../src/tool-registry');

const Helper = require('./helpers/hubot-helper');


class MockOllama {
  constructor() {}
  async show({ }) {
    return { capabilities: ['tools'] };
  }
  async chat(req) {
    const last = req.messages[req.messages.length - 1];

    // If tools are available and this is not a tool result follow-up, and web search tool is available, simulate tool call
    const hasWebSearchTool = req.tools && req.tools.some(t => (t.function && t.function.name) === 'hubot_ollama_web_search');
    const hasWebFetchTool = req.tools && req.tools.some(t => (t.function && t.function.name) === 'hubot_ollama_web_fetch');

    if (req.tools && req.tools.length > 0 && hasWebSearchTool && !req.messages.some(m => m.role === 'user' && typeof m.content === 'string' && /^{/.test(m.content))) {
      // Simulate the model choosing the web search tool
      return {
        message: {
          content: 'I will search for information',
          tool_calls: [{
            function: {
              name: 'hubot_ollama_web_search',
              arguments: { prompt: last.content || 'search' }
            }
          }]
        }
      };
    }

    // If this is a tool result message (JSON content from user), check what was returned
    if (last && last.content && /^{/.test(last.content)) {
      try {
        const result = JSON.parse(last.content);
        // New behavior: web search returns results, web fetch returns pages
        if (result.results && hasWebFetchTool) {
          // Simulate model selecting fetch tool after search
          return {
            message: {
              content: 'I will now fetch the content',
              tool_calls: [{
                function: {
                  name: 'hubot_ollama_web_fetch',
                  arguments: { urls: [result.results[0].url] }
                }
              }]
            }
          };
        }
        if (result.pages || result.results) {
          return { message: { content: 'Answer with web context' } };
        }
      // eslint-disable-next-line no-unused-vars
      } catch (e) {
        // Ignore JSON parse errors in mock
      }
    }

    // Default fallback
    return { message: { content: 'Answer without web context' } };
  }
  async webSearch({ max_results }) {
    return {
      results: [
        { title: 'Node v24.10.0', url: 'https://nodejs.org/en/blog/release/v24.10.0', content: 'Node release notes snippet' },
        { title: 'Changelog', url: 'https://example.com/changelog', content: 'Project changelog summary' },
      ].slice(0, max_results || 5)
    };
  }
  async webFetch({ url }) {
    if (/example.com\/changelog/.test(url)) {
      throw new Error('Network error');
    }
    return { text: `Content for ${url}` };
  }
}

mockRequire('ollama', { Ollama: MockOllama });

const helper = new Helper(path.join(__dirname, '..', 'src', 'hubot-ollama.js'));
const slackHelper = new Helper([
  path.join(__dirname, 'adapters', 'slack.js'),
  path.join(__dirname, '..', 'src', 'hubot-ollama.js')
]);

const createMockTextMessage = (text, {
  userName = 'alice',
  userId = 'U123',
  room = 'room1',
  rawMessage = undefined
} = {}) => ({
  text,
  user: {
    id: userId,
    name: userName,
    room
  },
  room,
  rawMessage,
  done: false,
  match(regex) {
    return this.text.match(regex);
  },
  toString() {
    return this.text;
  }
});

describe('hubot-ollama web-enabled flow', () => {
  let room;

  afterAll(() => {
    mockRequire.stop('ollama');
  });

  beforeEach(async () => {
    process.env.HUBOT_OLLAMA_WEB_ENABLED = 'true';
    process.env.HUBOT_OLLAMA_API_KEY = 'test-key';
    room = await helper.createRoom();
    // Mock robot.logger to avoid noisy output and allow call checks if needed
    ['debug', 'info', 'warning', 'error'].forEach((method) => {
      room.robot.logger[method] = vi.fn();
    });
  });

  afterEach(() => {
    room.destroy();
    registry.clearTools();
    delete process.env.HUBOT_OLLAMA_WEB_ENABLED;
    delete process.env.HUBOT_OLLAMA_API_KEY;
  });

  it('runs web flow when model says YES and includes context', async () => {
    await room.user.say('alice', 'hubot ask summarize latest node release');
    // Allow async chain (decision -> terms -> search -> fetch -> final)
    await new Promise((resolve) => setTimeout(resolve, 250));
    // Expect status message
    expect(room.messages.some(m => /Searching (web for )?relevant sources/.test(m[1]))).toBe(true);
    // Final answer should indicate web context was included
    const last = room.messages[room.messages.length - 1][1];
    expect(last).toMatch(/Answer with web context/);
  });

  it('falls back when web disabled', async () => {
    // Clear tools from previous test first
    registry.clearTools();
    // Recreate room so WEB_ENABLED is re-read at module init time
    room.destroy();
    process.env.HUBOT_OLLAMA_WEB_ENABLED = 'false';
    room = await helper.createRoom();
    ['debug', 'info', 'warning', 'error'].forEach((method) => {
      room.robot.logger[method] = vi.fn();
    });
    await room.user.say('alice', 'hubot ask summarize latest node release');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const last = room.messages[room.messages.length - 1][1];
    expect(last).toMatch(/Answer without web/);
  });

  it('keeps web-search status messaging when Slack reactions are not permitted', async () => {
    room.destroy();
    room = await slackHelper.createRoom();
    ['debug', 'info', 'warning', 'error'].forEach((method) => {
      room.robot.logger[method] = vi.fn();
    });

    room.robot.adapter.client = {
      web: {
        reactions: {
          add: vi.fn().mockRejectedValue(new Error('missing_scope')),
          remove: vi.fn().mockRejectedValue(new Error('missing_scope'))
        }
      }
    };

    await room.user.say('alice', createMockTextMessage('hubot ask summarize latest node release', {
      room: 'room1',
      rawMessage: { ts: '1716400000.000300' }
    }));
    await new Promise((resolve) => setTimeout(resolve, 250));

    const hasSearchStatus = room.messages.some((m) => {
      const payload = m[1];
      return m[0] === 'hubot' &&
        typeof payload === 'object' &&
        typeof payload.text === 'string' &&
        /Searching web for relevant sources/.test(payload.text);
    });

    const last = room.messages[room.messages.length - 1][1];
    const lastText = typeof last === 'string' ? last : last.text;
    expect(hasSearchStatus).toBe(true);
    expect(lastText).toMatch(/Answer with web context/);
  });

  it('adds and removes tool reaction during Slack web tool execution', async () => {
    room.destroy();
    room = await slackHelper.createRoom();
    ['debug', 'info', 'warning', 'error'].forEach((method) => {
      room.robot.logger[method] = vi.fn();
    });

    const addReaction = vi.fn().mockResolvedValue({ ok: true });
    const removeReaction = vi.fn().mockResolvedValue({ ok: true });
    room.robot.adapter.client = {
      web: {
        reactions: {
          add: addReaction,
          remove: removeReaction
        }
      }
    };

    await room.user.say('alice', createMockTextMessage('hubot ask summarize latest node release', {
      room: 'room1',
      rawMessage: { ts: '1716400000.000400' }
    }));
    await new Promise((resolve) => setTimeout(resolve, 250));

    const addedNames = addReaction.mock.calls.map((call) => call[0].name);
    const removedNames = removeReaction.mock.calls.map((call) => call[0].name);

    expect(addedNames).toContain('thought_balloon');
    expect(addedNames).toContain('hammer_and_wrench');
    expect(removedNames).toContain('thought_balloon');
    expect(removedNames).toContain('hammer_and_wrench');
  });
});
