const path = require('path');

const Helper = require('hubot-test-helper');

jest.mock('ollama', () => {
  class MockOllama {
    constructor() {}
    async show({ }) {
      return { capabilities: ['tools'] };
    }
    async chat(req) {
      const last = req.messages[req.messages.length - 1];
      // Decision prompt: reply YES to trigger web flow
      if (req.messages[0].content && /Reply with ONLY/.test(req.messages[0].content)) {
        return { message: { content: 'YES' } };
      }
      // Search term generation: return fixed terms
      if (last && last.content && /Generate 2-4 concise search terms/.test(last.content)) {
        return { message: { content: 'node.js, release notes' } };
      }
      // Final chat: echo that web context was present by checking messages
      const hadContext = req.messages.some(m => m.role === 'assistant' && /Web context synthesized/.test(m.content));
      return { message: { content: hadContext ? 'Answer with web context' : 'Answer without web' } };
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
    delete process.env.HUBOT_OLLAMA_WEB_ENABLED;
    delete process.env.HUBOT_OLLAMA_API_KEY;
  });

  it('runs web flow when model says YES and includes context', async () => {
    await room.user.say('alice', 'hubot ask summarize latest node release');
    // Allow async chain (decision -> terms -> search -> fetch -> final)
    await new Promise((resolve) => setTimeout(resolve, 250));
    // Expect status message
    expect(room.messages.some(m => /Searching for relevant sources/.test(m[1]))).toBe(true);
    // Final answer should indicate web context was included
    const last = room.messages[room.messages.length - 1][1];
    expect(last).toMatch(/Answer with web context/);
  });

  it('falls back when web disabled', async () => {
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
