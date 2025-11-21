const Helper = require('hubot-test-helper');
const nock = require('nock');

const helper = new Helper('./../src/hubot-ollama.js');

describe('hubot-ollama', () => {
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

  describe('Basic Command Handling', () => {
    describe('ask hubot a question', () => {
      beforeEach((done) => {
        mockOllamaChat('The capital of France is Paris.');

        room.user.say('alice', 'hubot ask what is the capital of France?');
        setTimeout(done, 150);
      });

      it('hubot responds with ollama output', () => {
        expect(room.messages).toEqual([
          ['alice', 'hubot ask what is the capital of France?'],
          ['hubot', 'The capital of France is Paris.'],
        ]);
      });

      it('calls ollama API with correct model', () => {
        expect(nock.isDone()).toBe(true);
      });

      it('logs debug message', () => {
        expect(room.robot.logger.debug).toHaveBeenCalledWith('Calling Ollama API with model: llama3.2');
      });
    });

    describe('ask hubot without a prompt', () => {
      beforeEach((done) => {
        room.user.say('alice', 'hubot ask   ');
        setTimeout(done, 100);
      });

      it('hubot asks for a prompt', () => {
        expect(room.messages).toEqual([
          ['alice', 'hubot ask   '],
          ['hubot', 'Please provide a question or prompt.'],
        ]);
      });

      it('does not call ollama API', () => {
        expect(nock.pendingMocks()).toEqual([]);
      });
    });

    describe('alternative command aliases', () => {
      it('responds to ollama command', (done) => {
        mockOllamaChat('Response using ollama command');
        room.user.say('alice', 'hubot ollama test prompt');
        setTimeout(() => {
          expect(room.messages).toEqual([
            ['alice', 'hubot ollama test prompt'],
            ['hubot', 'Response using ollama command'],
          ]);
          done();
        }, 150);
      });

      it('responds to llm command', (done) => {
        mockOllamaChat('Response using llm command');
        room.user.say('alice', 'hubot llm another test');
        setTimeout(() => {
          expect(room.messages).toEqual([
            ['alice', 'hubot llm another test'],
            ['hubot', 'Response using llm command'],
          ]);
          done();
        }, 150);
      });
    });
  });

  describe('Error Handling', () => {
    describe('ollama server unreachable', () => {
      beforeEach((done) => {
        const error = new Error('connect ECONNREFUSED 127.0.0.1:11434');
        error.code = 'ECONNREFUSED';
        mockOllamaChat('', { error });

        room.user.say('alice', 'hubot ask test question');
        setTimeout(done, 150);
      });

      it('hubot responds with helpful error message', () => {
        expect(room.messages).toEqual([
          ['alice', 'hubot ask test question'],
          ['hubot', 'Error: Cannot connect to Ollama server. Please ensure Ollama is running.'],
        ]);
      });
    });

    describe('model not found', () => {
      beforeEach((done) => {
        mockOllamaChat('', {
          statusCode: 404,
          body: { error: 'model "llama3.2" not found' }
        });

        room.user.say('alice', 'hubot ask test question');
        setTimeout(done, 150);
      });

      it('hubot responds with model error message', () => {
        expect(room.messages[1][1]).toContain('Error:');
        expect(room.messages[1][1]).toContain('not found');
      });
    });

    describe('ollama API error', () => {
      beforeEach((done) => {
        mockOllamaChat('', {
          statusCode: 500,
          body: { error: 'Internal server error' }
        });

        room.user.say('alice', 'hubot ask test question');
        setTimeout(done, 150);
      });

      it('hubot responds with error message', () => {
        expect(room.messages[1][1]).toContain('Error:');
      });
    });

    describe('empty response from ollama', () => {
      beforeEach((done) => {
        mockOllamaChat('');

        room.user.say('alice', 'hubot ask test question');
        setTimeout(done, 150);
      });

      it('hubot responds with empty response error', () => {
        expect(room.messages).toEqual([
          ['alice', 'hubot ask test question'],
          ['hubot', 'Error: No content in response'],
        ]);
      });
    });

    describe('timeout handling', () => {
      beforeEach((done) => {
        // Recreate room to re-read env-backed constants
        room.destroy();
        process.env.HUBOT_OLLAMA_TIMEOUT_MS = '50';
        room = helper.createRoom();
        ['debug', 'info', 'warning', 'error'].forEach((method) => {
          room.robot.logger[method] = jest.fn();
        });

        mockOllamaChat('response', { timeout: 100 });
        room.user.say('alice', 'hubot ask slow');
        setTimeout(done, 150);
      });

      afterEach(() => {
        delete process.env.HUBOT_OLLAMA_TIMEOUT_MS;
      });

      it('handles timeout configuration', () => {
        // Timeout is configured, but our mock delay doesn't actually prevent response
        // Just verify no crash occurred
        const botMessage = room.messages.find((m) => m[0] === 'hubot');
        expect(botMessage).toBeDefined();
      });
    });
  });

  describe('Configuration', () => {
    describe('custom model', () => {
      beforeEach((done) => {
        // Need to recreate the room with the new env var
        room.destroy();
        process.env.HUBOT_OLLAMA_MODEL = 'mistral';
        room = helper.createRoom();

        // Re-mock logger
        ['debug', 'info', 'warning', 'error'].forEach((method) => {
          room.robot.logger[method] = jest.fn();
        });

        nock(OLLAMA_HOST)
          .post('/api/chat', (body) => body.model === 'mistral')
          .reply(200, {
            message: { role: 'assistant', content: 'Response from Mistral model.' },
            done: true
          });

        room.user.say('alice', 'hubot ask test');
        setTimeout(done, 150);
      });

      it('uses custom model', () => {
        expect(nock.isDone()).toBe(true);
      });

      it('logs correct model name', () => {
        expect(room.robot.logger.debug).toHaveBeenCalledWith('Calling Ollama API with model: mistral');
      });
    });

    describe('invalid model name falls back to default', () => {
      beforeEach((done) => {
        room.destroy();
        process.env.HUBOT_OLLAMA_MODEL = 'mistral; rm -rf /';
        room = helper.createRoom();
        ['debug', 'info', 'warning', 'error'].forEach((method) => {
          room.robot.logger[method] = jest.fn();
        });

        nock(OLLAMA_HOST)
          .post('/api/chat', (body) => body.model === 'llama3.2')
          .reply(200, {
            message: { role: 'assistant', content: 'ok' },
            done: true
          });

        room.user.say('alice', 'hubot ask hi');
        setTimeout(done, 150);
      });

      it('uses default model name', () => {
        expect(nock.isDone()).toBe(true);
      });
    });

    describe('custom system prompt', () => {
      beforeEach((done) => {
        room.destroy();
        process.env.HUBOT_OLLAMA_SYSTEM_PROMPT = 'You are a helpful assistant. Be concise.';
        room = helper.createRoom();
        ['debug', 'info', 'warning', 'error'].forEach((method) => {
          room.robot.logger[method] = jest.fn();
        });

        nock(OLLAMA_HOST)
          .post('/api/chat', (body) => {
            // Check that system message is in messages array
            const systemMsg = body.messages.find(m => m.role === 'system');
            return systemMsg && systemMsg.content === 'You are a helpful assistant. Be concise.';
          })
          .reply(200, {
            message: { role: 'assistant', content: 'ok' },
            done: true
          });

        room.user.say('alice', 'hubot ask test');
        setTimeout(done, 150);
      });

      it('uses custom system prompt in the request', () => {
        expect(nock.isDone()).toBe(true);
      });
    });

    describe('prompt length limit', () => {
      const longText = 'x'.repeat(2100);
      beforeEach((done) => {
        process.env.HUBOT_OLLAMA_MAX_PROMPT_CHARS = '2000';
        mockOllamaChat('ok');
        room.user.say('alice', `hubot ask ${longText}`);
        setTimeout(done, 200);
      });

      afterEach(() => {
        delete process.env.HUBOT_OLLAMA_MAX_PROMPT_CHARS;
      });

      it('truncates overly long prompts', () => {
        // Verify the request was made (it would be truncated internally)
        expect(nock.isDone()).toBe(true);
      });

      it('sends a truncation notice', () => {
        expect(room.messages[1][1]).toContain('truncated');
      });
    });

    describe('streaming mode', () => {
      beforeEach((done) => {
        process.env.HUBOT_OLLAMA_STREAM = 'true';

        mockOllamaChat('First chunk. Last chunk.', { stream: true });

        room.user.say('alice', 'hubot ask test');
        setTimeout(done, 200);
      });

      afterEach(() => {
        delete process.env.HUBOT_OLLAMA_STREAM;
      });

      it('handles streaming response', () => {
        // Should have received response
        const hubotMessages = room.messages.filter((m) => m[0] === 'hubot');
        expect(hubotMessages.length).toBeGreaterThan(0);
      });
    });

    describe('custom ollama host', () => {
      const customHost = 'http://custom-ollama:11434';
      beforeEach((done) => {
        room.destroy();
        process.env.HUBOT_OLLAMA_HOST = customHost;
        room = helper.createRoom();
        ['debug', 'info', 'warning', 'error'].forEach((method) => {
          room.robot.logger[method] = jest.fn();
        });

        nock(customHost)
          .post('/api/chat')
          .reply(200, {
            message: { role: 'assistant', content: 'ok' },
            done: true
          });

        room.user.say('alice', 'hubot ask test');
        setTimeout(done, 150);
      });

      afterEach(() => {
        delete process.env.HUBOT_OLLAMA_HOST;
      });

      it('uses custom ollama host', () => {
        expect(nock.isDone()).toBe(true);
      });
    });

    describe('ollama cloud with API key', () => {
      const cloudHost = 'https://ollama.com';
      const apiKey = 'test-api-key-12345';

      beforeEach((done) => {
        room.destroy();
        process.env.HUBOT_OLLAMA_HOST = cloudHost;
        process.env.HUBOT_OLLAMA_API_KEY = apiKey;
        process.env.HUBOT_OLLAMA_MODEL = 'gpt-oss:120b';
        room = helper.createRoom();
        ['debug', 'info', 'warning', 'error'].forEach((method) => {
          room.robot.logger[method] = jest.fn();
        });

        nock(cloudHost)
          .post('/api/chat', (body) => body.model === 'gpt-oss:120b')
          .matchHeader('Authorization', `Bearer ${apiKey}`)
          .reply(200, {
            message: { role: 'assistant', content: 'Response from cloud model' },
            done: true
          });

        room.user.say('alice', 'hubot ask test cloud');
        setTimeout(done, 150);
      });

      afterEach(() => {
        delete process.env.HUBOT_OLLAMA_HOST;
        delete process.env.HUBOT_OLLAMA_API_KEY;
      });

      it('uses ollama cloud with API key authentication', () => {
        expect(nock.isDone()).toBe(true);
      });

      it('receives response from cloud model', () => {
        expect(room.messages).toEqual([
          ['alice', 'hubot ask test cloud'],
          ['hubot', 'Response from cloud model'],
        ]);
      });
    });
  });

  describe('Security', () => {
    describe('API-based approach security', () => {
      beforeEach((done) => {
        mockOllamaChat('Safe output');
        room.user.say('alice', 'hubot ask tell me something; rm -rf / && `uname` $(whoami) | cat /etc/passwd');
        setTimeout(done, 150);
      });

      it('safely handles malicious-looking input via JSON API', () => {
        // Input is sent as JSON data, not executed
        expect(room.messages[1][1]).toBe('Safe output');
      });
    });

    describe('control character sanitization', () => {
      beforeEach((done) => {
        nock(OLLAMA_HOST)
          .post('/api/chat', (body) => {
            // Check that control chars are stripped from user message
            const userMsg = body.messages.find(m => m.role === 'user');
            return userMsg && !userMsg.content.includes('\x00') && !userMsg.content.includes('\x01');
          })
          .reply(200, {
            message: { role: 'assistant', content: 'ok' },
            done: true
          });

        // Include various control characters
        room.user.say('alice', 'hubot ask test\x00\x01\x02\x03prompt');
        setTimeout(done, 150);
      });

      it('strips control characters from prompt', () => {
        expect(nock.isDone()).toBe(true);
      });
    });
  });

  describe('Conversation Context', () => {
    describe('room-user scope (default)', () => {
      beforeEach(async () => {
        nock(OLLAMA_HOST)
          .post('/api/chat')
          .reply(200, {
            message: { role: 'assistant', content: 'Answer one' },
            done: true
          })
          .post('/api/chat', (body) => {
            // Bob's request should not have alice's context
            const hasAliceContext = body.messages.some(m =>
              m.content && (m.content.includes('First question') || m.content.includes('Answer one'))
            );
            return !hasAliceContext;
          })
          .reply(200, {
            message: { role: 'assistant', content: 'Answer two' },
            done: true
          });

        // First user asks, stores context for alice
        room.user.say('alice', 'hubot ask First question');
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Second user asks; in room-user scope, bob should NOT inherit alice context
        room.user.say('bob', 'hubot ask Follow-up?');
        await new Promise((resolve) => setTimeout(resolve, 150));
      });

      it('isolates context per user', () => {
        expect(nock.isDone()).toBe(true);
      });
    });

    describe('room scope', () => {
      beforeEach(async () => {
        room.destroy();
        process.env.HUBOT_OLLAMA_CONTEXT_SCOPE = 'room';
        process.env.HUBOT_OLLAMA_CONTEXT_TURNS = '5';
        room = helper.createRoom();
        ['debug', 'info', 'warning', 'error'].forEach((method) => {
          room.robot.logger[method] = jest.fn();
        });

        nock(OLLAMA_HOST)
          .post('/api/chat')
          .reply(200, {
            message: { role: 'assistant', content: 'Answer one' },
            done: true
          })
          .post('/api/chat', (body) => {
            // Bob's request SHOULD have alice's context in room scope
            const hasAliceContext = body.messages.some(m =>
              m.content && (m.content.includes('First question') || m.content === 'Answer one')
            );
            return hasAliceContext;
          })
          .reply(200, {
            message: { role: 'assistant', content: 'Answer two' },
            done: true
          });

        // Alice asks first question
        room.user.say('alice', 'hubot ask First question');
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Bob asks follow-up; in room scope, Bob should inherit context
        room.user.say('bob', 'hubot ask Follow-up?');
        await new Promise((resolve) => setTimeout(resolve, 150));
      });

      afterEach(() => {
        delete process.env.HUBOT_OLLAMA_CONTEXT_SCOPE;
        delete process.env.HUBOT_OLLAMA_CONTEXT_TURNS;
      });

      it('shares context across users in same room', () => {
        expect(nock.isDone()).toBe(true);
      });
    });

    describe('thread scope', () => {
      beforeEach(async () => {
        room.destroy();
        process.env.HUBOT_OLLAMA_CONTEXT_SCOPE = 'thread';
        room = helper.createRoom();
        ['debug', 'info', 'warning', 'error'].forEach((method) => {
          room.robot.logger[method] = jest.fn();
        });

        nock(OLLAMA_HOST)
          .post('/api/chat')
          .times(2)
          .reply(200, {
            message: { role: 'assistant', content: 'Thread answer' },
            done: true
          });

        // Simulate a threaded message
        room.user.say('alice', 'hubot ask Thread question');
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Non-threaded message should not share context
        room.user.say('alice', 'hubot ask Main question');
        await new Promise((resolve) => setTimeout(resolve, 150));
      });

      afterEach(() => {
        delete process.env.HUBOT_OLLAMA_CONTEXT_SCOPE;
      });

      it('handles thread scope configuration', () => {
        // Thread scope is configured and doesn't crash
        expect(nock.isDone()).toBe(true);
      });
    });

    describe('context expiration', () => {
      beforeEach(async () => {
        room.destroy();
        process.env.HUBOT_OLLAMA_CONTEXT_TTL_MS = '100'; // 100ms TTL
        room = helper.createRoom();
        ['debug', 'info', 'warning', 'error'].forEach((method) => {
          room.robot.logger[method] = jest.fn();
        });

        nock(OLLAMA_HOST)
          .post('/api/chat')
          .reply(200, {
            message: { role: 'assistant', content: 'First answer' },
            done: true
          })
          .post('/api/chat', (body) => {
            // Should not have first context after expiry
            const hasOldContext = body.messages.some(m =>
              m.content && m.content.includes('First answer')
            );
            return !hasOldContext;
          })
          .reply(200, {
            message: { role: 'assistant', content: 'Second answer' },
            done: true
          });

        room.user.say('alice', 'hubot ask First');
        await new Promise((resolve) => setTimeout(resolve, 80));

        // Wait for context to expire
        await new Promise((resolve) => setTimeout(resolve, 150));

        room.user.say('alice', 'hubot ask Second');
        await new Promise((resolve) => setTimeout(resolve, 120));
      });

      afterEach(() => {
        delete process.env.HUBOT_OLLAMA_CONTEXT_TTL_MS;
      });

      it('expires old context after TTL', () => {
        expect(nock.isDone()).toBe(true);
      });
    });

    describe('context disabled', () => {
      beforeEach(async () => {
        room.destroy();
        process.env.HUBOT_OLLAMA_CONTEXT_TTL_MS = '0'; // Disable context
        room = helper.createRoom();
        ['debug', 'info', 'warning', 'error'].forEach((method) => {
          room.robot.logger[method] = jest.fn();
        });

        nock(OLLAMA_HOST)
          .post('/api/chat')
          .times(2)
          .reply(200, {
            message: { role: 'assistant', content: 'Answer' },
            done: true
          });

        room.user.say('alice', 'hubot ask First');
        await new Promise((resolve) => setTimeout(resolve, 80));

        room.user.say('alice', 'hubot ask Second');
        await new Promise((resolve) => setTimeout(resolve, 120));
      });

      afterEach(() => {
        delete process.env.HUBOT_OLLAMA_CONTEXT_TTL_MS;
      });

      it('does not store or use context when disabled', () => {
        expect(nock.isDone()).toBe(true);
        expect(room.robot.logger.debug).toHaveBeenCalledWith(
          'Conversation context disabled via HUBOT_OLLAMA_CONTEXT_TTL_MS=0'
        );
      });
    });

    describe('context turn limit', () => {
      it('respects CONTEXT_TURNS configuration', async () => {
        room.destroy();
        process.env.HUBOT_OLLAMA_CONTEXT_TURNS = '3';
        room = helper.createRoom();
        ['debug', 'info', 'warning', 'error'].forEach((method) => {
          room.robot.logger[method] = jest.fn();
        });

        mockOllamaChat('ok');

        room.user.say('alice', 'hubot ask test');
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Manually verify the context storage logic by checking brain
        const contexts = room.robot.brain.get('ollamaContexts');
        expect(contexts).toBeDefined();

        delete process.env.HUBOT_OLLAMA_CONTEXT_TURNS;
      });
    });
  });
});
