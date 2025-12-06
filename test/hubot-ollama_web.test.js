const path = require('path');

const Helper = require('hubot-test-helper');

const registry = require('../src/tool-registry');

jest.mock('ollama', () => {
  class MockOllama {
    constructor() {}
    async show({ }) {
      return { capabilities: ['tools'] };
    }
    async chat(req) {
      const last = req.messages[req.messages.length - 1];

      // If tools are available and this is not a tool result follow-up, and web search tool is available, simulate tool call
      const hasWebSearchTool = req.tools && req.tools.some(t => t.name === 'hubot_ollama_web_search');
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

      // If this is a tool result message (JSON content from user), return final answer
      if (last && last.content && /^{/.test(last.content)) {
        try {
          const result = JSON.parse(last.content);
          if (result.context) {
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
  return { Ollama: MockOllama };
});

const helper = new Helper(path.join(__dirname, '..', 'src', 'hubot-ollama.js'));

describe('hubot-ollama web-enabled flow', () => {
  let room;

  beforeEach(() => {
    process.env.HUBOT_OLLAMA_WEB_ENABLED = 'true';
    process.env.HUBOT_OLLAMA_API_KEY = 'test-key';
    room = helper.createRoom();
    // Mock robot.logger to avoid noisy output and allow call checks if needed
    ['debug', 'info', 'warning', 'error'].forEach((method) => {
      room.robot.logger[method] = jest.fn();
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
    room = helper.createRoom();
    ['debug', 'info', 'warning', 'error'].forEach((method) => {
      room.robot.logger[method] = jest.fn();
    });
    await room.user.say('alice', 'hubot ask summarize latest node release');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const last = room.messages[room.messages.length - 1][1];
    expect(last).toMatch(/Answer without web/);
  });
});
