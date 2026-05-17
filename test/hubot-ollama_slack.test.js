const nock = require('nock');

const Helper = require('./helpers/hubot-helper');
const { createMockTextMessage } = require('./helpers/mock-message');

const helper = new Helper([
  './adapters/slack.js',
  './../src/hubot-ollama.js'
]);

describe('hubot-ollama slack', () => {
  let room = null;
  const OLLAMA_HOST = 'http://127.0.0.1:11434';

  beforeEach(async () => {
    process.env.HUBOT_OLLAMA_MODEL = 'llama3.2';
    room = await helper.createRoom();

    // Mock robot.logger methods
    ['debug', 'info', 'warning', 'error'].forEach((method) => {
      room.robot.logger[method] = vi.fn();
    });

    // Clean all HTTP mocks
    nock.cleanAll();
  });

  afterEach(() => {
    room.destroy();
    nock.cleanAll();
    delete process.env.HUBOT_OLLAMA_MODEL;
    delete process.env.HUBOT_OLLAMA_SYSTEM_PROMPT;
    delete process.env.HUBOT_OLLAMA_CONTEXT_SCOPE;
    delete process.env.HUBOT_OLLAMA_CONTEXT_TURNS;
    delete process.env.HUBOT_OLLAMA_HOST;
    delete process.env.HUBOT_OLLAMA_API_KEY;
    delete process.env.HUBOT_OLLAMA_TOOLS_ENABLED;
  });  // Helper to create a mock Ollama API response
  const mockOllamaChat = (response, options = {}) => {
    const scope = nock(OLLAMA_HOST)
      .post('/api/chat', (body) => {
        // Validate request structure
        expect(body.model).toBeDefined();
        expect(body.messages).toBeInstanceOf(Array);
        return true;
      });

    if (options.timeout) {
      scope.delayConnection(options.timeout);
    }

    if (options.error) {
      scope.replyWithError(options.error);
    } else if (options.statusCode) {
      scope.reply(options.statusCode, options.body || { error: 'API Error' });
    } else {
      scope.reply(200, {
        message: {
          role: 'assistant',
          content: response
        },
        done: true
      });
    }

    return scope;
  };

  describe('Slack Formatting Handling', () => {
    describe('ask hubot a question', () => {
      beforeEach(async () => {
        mockOllamaChat('The capital of France is **Paris**.');

        room.user.say('alice', 'hubot ask what is the capital of France?');
        await new Promise((resolve) => setTimeout(resolve, 150));
      });

      it('hubot responds with ollama output', () => {
        expect(room.messages).toEqual([
          ['alice', 'hubot ask what is the capital of France?'],
          ['hubot', {
            text: 'The capital of France is *Paris*.',
            mrkdwn: true,
          }],
        ]);
      });

      it('calls ollama API with correct model', () => {
        expect(nock.isDone()).toBe(true);
      });

      it('logs debug message', () => {
        expect(room.robot.logger.debug).toHaveBeenCalledWith('Calling Ollama API with model: llama3.2');
      });
    });
  });

  describe('Slack Reaction Lifecycle', () => {
    it('adds and removes thought balloon reaction around prompt handling', async () => {
      process.env.HUBOT_OLLAMA_TOOLS_ENABLED = 'false';
      room.destroy();
      room = await helper.createRoom();
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

      nock(OLLAMA_HOST)
        .post('/api/show', { name: 'llama3.2' })
        .reply(200, { capabilities: [] });

      mockOllamaChat('Hello from Slack.');

      await room.user.say('alice', createMockTextMessage('hubot ask hello', {
        room: 'room1',
        rawMessage: { ts: '1716400000.000100' }
      }));
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(addReaction).toHaveBeenCalledWith({
        name: 'thought_balloon',
        channel: 'room1',
        timestamp: '1716400000.000100'
      });

      expect(removeReaction).toHaveBeenCalledWith({
        name: 'thought_balloon',
        channel: 'room1',
        timestamp: '1716400000.000100'
      });
    });

    it('derives reaction target from Slack Events-style raw message envelope', async () => {
      process.env.HUBOT_OLLAMA_TOOLS_ENABLED = 'false';
      room.destroy();
      room = await helper.createRoom();
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

      nock(OLLAMA_HOST)
        .post('/api/show', { name: 'llama3.2' })
        .reply(200, { capabilities: [] });

      mockOllamaChat('Hello from Slack envelope payload.');

      await room.user.say('alice', createMockTextMessage('hubot ask hello', {
        room: null,
        rawMessage: {
          event: {
            channel: 'D05PXMQH295',
            ts: '1778993655.375269'
          }
        }
      }));
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(addReaction).toHaveBeenCalledWith({
        name: 'thought_balloon',
        channel: 'D05PXMQH295',
        timestamp: '1778993655.375269'
      });

      expect(removeReaction).toHaveBeenCalledWith({
        name: 'thought_balloon',
        channel: 'D05PXMQH295',
        timestamp: '1778993655.375269'
      });
    });

  });
});
