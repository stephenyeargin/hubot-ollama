const Helper = require('hubot-test-helper');
const nock = require('nock');

const helper = new Helper([
  './adapters/slack.js',
  './../src/hubot-ollama.js'
]);

describe('hubot-ollama slack', () => {
  let room = null;
  const OLLAMA_HOST = 'http://127.0.0.1:11434';

  beforeEach(() => {
    process.env.HUBOT_OLLAMA_MODEL = 'llama3.2';
    room = helper.createRoom();

    // Mock robot.logger methods
    ['debug', 'info', 'warning', 'error'].forEach((method) => {
      room.robot.logger[method] = jest.fn();
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
    } else if (options.stream) {
      // For streaming responses
      scope.reply(200, () => {
        const chunks = response.split(' ').map((word) =>
          JSON.stringify({ message: { role: 'assistant', content: word + ' ' } }) + '\n'
        );
        return chunks.join('');
      });
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
      beforeEach((done) => {
        mockOllamaChat('The capital of France is **Paris**.');

        room.user.say('alice', 'hubot ask what is the capital of France?');
        setTimeout(done, 150);
      });

      it('hubot responds with ollama output', () => {
        expect(room.messages).toEqual([
          ['alice', 'hubot ask what is the capital of France?'],
          ['hubot', {
            text: 'The capital of France is **Paris**.',
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
});
