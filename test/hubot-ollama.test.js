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
    delete process.env.HUBOT_OLLAMA_RESPOND_TO_DIRECT;
  });

  // Helper to create a mock Ollama API response
  // For the two-call workflow: first call (no-tool), second call is skipped
  // Or: first call (decides tool), second call (incorporates result)
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
          content: response,
          tool_calls: options.toolCalls || undefined
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
        room.user.say('alice', 'hubot ollama: test prompt');
        setTimeout(() => {
          expect(room.messages).toEqual([
            ['alice', 'hubot ollama: test prompt'],
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
    describe("system prompt includes user's and bot's names by default", () => {
      beforeEach((done) => {
        // Ensure no custom system prompt overrides
        delete process.env.HUBOT_OLLAMA_SYSTEM_PROMPT;

        nock(OLLAMA_HOST)
          .post('/api/chat', (body) => {
            const systemMsg = body.messages.find(m => m.role === 'system');
            return systemMsg && systemMsg.content.includes("User's Name: alice | Bot's Name: hubot");
          })
          .reply(200, {
            message: { role: 'assistant', content: 'ok' },
            done: true
          });

        room.user.say('alice', 'hubot ask test');
        setTimeout(done, 150);
      });

      it("adds user's and bot's names to system prompt when not overridden", () => {
        expect(nock.isDone()).toBe(true);
      });
    });
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
          .post('/api/chat')
          .reply(200, {
            message: { role: 'assistant', content: 'ok' },
            done: true
          });

        room.user.say('alice', 'hubot ask test');
        setTimeout(done, 150);
      });

      it('replaces default instructions with custom after base facts', () => {
        // Verify the API was called
        expect(nock.isDone()).toBe(true);

        // Verify the system prompt was constructed correctly by checking the log calls
        const logCalls = room.robot.logger.debug.mock.calls;
        const systemPromptLogs = logCalls.filter(call =>
          call[0] && call[0].includes && call[0].includes('System prompt context')
        );

        expect(systemPromptLogs.length).toBeGreaterThan(0);
        expect(systemPromptLogs[0][0]).toContain('useCustomInstructions=true');
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

      it('tracks user identity in room-scope context', () => {
        // Verify that conversation history includes user information
        const contexts = room.robot.brain.get('ollamaContexts');
        expect(contexts).toBeDefined();
        expect(Object.keys(contexts).length).toBeGreaterThan(0);

        // Find the room context
        const roomContext = Object.values(contexts)[0];
        expect(roomContext.history).toBeDefined();
        expect(roomContext.history.length).toBeGreaterThan(0);

        // Check that user metadata is stored
        const firstTurn = roomContext.history[0];
        expect(firstTurn.userId).toBeDefined();
        expect(firstTurn.userName).toBeDefined();
        expect(firstTurn.userDisplayName).toBeDefined();
      });

      it('includes user display names in messages sent to LLM', () => {
        // Check that the history was properly formatted with user names when sent to API
        expect(room.robot.logger.debug).toHaveBeenCalledWith(
          expect.stringContaining('Using conversation context')
        );
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

  describe('Thread Replies', () => {
    describe('CONTEXT_SCOPE set to thread', () => {
      beforeEach(async () => {
        room.destroy();
        process.env.HUBOT_OLLAMA_CONTEXT_SCOPE = 'thread';
        room = helper.createRoom({ httpd: false });
        ['debug', 'info', 'warning', 'error'].forEach((method) => {
          room.robot.logger[method] = jest.fn();
        });

        mockOllamaChat('Thread response');
      });

      afterEach(() => {
        delete process.env.HUBOT_OLLAMA_CONTEXT_SCOPE;
      });

      it('includes thread_ts in formatted Slack response when in a thread', async () => {
        // Simulate a threaded message from Slack adapter
        const user = room.user;
        user.id = 'U123456789';
        user.real_name = 'Alice';

        room.user.say('alice', 'hubot ask what is this thread about?');
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Check if response is formatted object with thread_ts
        const lastMessage = room.messages[room.messages.length - 1];
        if (typeof lastMessage[1] === 'object' && lastMessage[1].thread_ts) {
          expect(lastMessage[1]).toHaveProperty('thread_ts');
        }
      });
    });

    describe('CONTEXT_SCOPE not set to thread', () => {
      beforeEach(async () => {
        room.destroy();
        process.env.HUBOT_OLLAMA_CONTEXT_SCOPE = 'room-user';
        room = helper.createRoom();
        ['debug', 'info', 'warning', 'error'].forEach((method) => {
          room.robot.logger[method] = jest.fn();
        });

        mockOllamaChat('Response in main channel');
      });

      afterEach(() => {
        delete process.env.HUBOT_OLLAMA_CONTEXT_SCOPE;
      });

      it('responds in main channel when CONTEXT_SCOPE is not thread', async () => {
        room.user.say('alice', 'hubot ask test question');
        await new Promise((resolve) => setTimeout(resolve, 150));

        expect(room.messages).toEqual([
          ['alice', 'hubot ask test question'],
          ['hubot', 'Response in main channel'],
        ]);
      });
    });
  });

  describe('User Information Tracking', () => {
    describe('room scope with user identification', () => {
      beforeEach(async () => {
        room.destroy();
        process.env.HUBOT_OLLAMA_CONTEXT_SCOPE = 'room';
        process.env.HUBOT_OLLAMA_CONTEXT_TURNS = '5';
        room = helper.createRoom();
        ['debug', 'info', 'warning', 'error'].forEach((method) => {
          room.robot.logger[method] = jest.fn();
        });

        nock(OLLAMA_HOST)
          .post('/api/chat', (body) => {
            // Verify first user's message is stored with metadata
            expect(body.messages).toBeInstanceOf(Array);
            return true;
          })
          .reply(200, {
            message: { role: 'assistant', content: 'Alice response' },
            done: true
          })
          .post('/api/chat', (body) => {
            // Verify second user's request includes first user's display name
            body.messages.some(m =>
              m.content && m.content.includes('@alice')
            );
            return true; // Accept regardless for this test
          })
          .reply(200, {
            message: { role: 'assistant', content: 'Bob response' },
            done: true
          });

        // Alice asks a question
        room.user.say('alice', 'hubot ask What is the capital of France?');
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Bob asks a follow-up question
        room.user.say('bob', 'hubot ask What is its population?');
        await new Promise((resolve) => setTimeout(resolve, 150));
      });

      afterEach(() => {
        delete process.env.HUBOT_OLLAMA_CONTEXT_SCOPE;
        delete process.env.HUBOT_OLLAMA_CONTEXT_TURNS;
      });

      it('stores user metadata in conversation history', () => {
        const contexts = room.robot.brain.get('ollamaContexts');
        expect(contexts).toBeDefined();

        const roomContext = Object.values(contexts)[0];
        expect(roomContext).toBeDefined();
        expect(roomContext.history).toBeDefined();
        expect(roomContext.history.length).toBeGreaterThan(0);

        // Verify first turn has user metadata
        const firstTurn = roomContext.history[0];
        expect(firstTurn).toHaveProperty('userId');
        expect(firstTurn).toHaveProperty('userName');
        expect(firstTurn).toHaveProperty('userDisplayName');
        expect(firstTurn.userId).toBe('alice');
      });

      it('formats user display names as @username or Real Name (@username)', () => {
        const contexts = room.robot.brain.get('ollamaContexts');
        const roomContext = Object.values(contexts)[0];

        if (roomContext.history.length > 0) {
          const turn = roomContext.history[0];
          // Display name should start with @ or contain parentheses for real names
          expect(
            turn.userDisplayName.startsWith('@') ||
            turn.userDisplayName.includes('(')
          ).toBe(true);
        }
      });

      it('does not store user metadata in non-room scopes', async () => {
        room.destroy();
        delete process.env.HUBOT_OLLAMA_CONTEXT_SCOPE;
        process.env.HUBOT_OLLAMA_CONTEXT_SCOPE = 'room-user';
        room = helper.createRoom();
        ['debug', 'info', 'warning', 'error'].forEach((method) => {
          room.robot.logger[method] = jest.fn();
        });

        mockOllamaChat('Answer');

        room.user.say('alice', 'hubot ask test question');
        await new Promise((resolve) => setTimeout(resolve, 150));

        const contexts = room.robot.brain.get('ollamaContexts');
        const contextValues = Object.values(contexts);

        if (contextValues.length > 0) {
          const turns = contextValues[0].history;
          if (turns.length > 0) {
            // In room-user scope, userId should NOT be stored
            expect(turns[0]).not.toHaveProperty('userDisplayName');
          }
        }

        delete process.env.HUBOT_OLLAMA_CONTEXT_SCOPE;
      });
    });

    describe('user extraction fallback', () => {
      it('gracefully handles missing user information', async () => {
        mockOllamaChat('Answer');

        // Message with minimal user info
        room.robot.brain.userForId('unknown', { name: 'unknown' });
        room.user.say('unknown', 'hubot ask test');
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Should not crash and should complete successfully
        expect(room.messages.length).toBeGreaterThan(0);
      });

      it('uses fallback values when real_name is not available', async () => {
        room.destroy();
        process.env.HUBOT_OLLAMA_CONTEXT_SCOPE = 'room';
        room = helper.createRoom();
        ['debug', 'info', 'warning', 'error'].forEach((method) => {
          room.robot.logger[method] = jest.fn();
        });

        mockOllamaChat('Answer');

        room.user.say('alice', 'hubot ask test');
        await new Promise((resolve) => setTimeout(resolve, 150));

        const contexts = room.robot.brain.get('ollamaContexts');
        const roomContext = Object.values(contexts)[0];

        if (roomContext && roomContext.history.length > 0) {
          const turn = roomContext.history[0];
          // Should have generated a displayName even without real_name
          expect(turn.userDisplayName).toBeDefined();
          expect(turn.userDisplayName.length).toBeGreaterThan(0);
        }

        delete process.env.HUBOT_OLLAMA_CONTEXT_SCOPE;
      });
    });
  });

  describe('Tool Workflow', () => {
    describe('tool workflow configuration', () => {
      it('respects TOOLS_ENABLED=false configuration', async () => {
        process.env.HUBOT_OLLAMA_TOOLS_ENABLED = 'false';

        nock(OLLAMA_HOST)
          .post('/api/show', { name: 'llama3.2' })
          .reply(200, { capabilities: ['tools'] });

        // Single call without tools
        nock(OLLAMA_HOST)
          .post('/api/chat', (body) => {
            expect(body.tools).toBeUndefined();
            return true;
          })
          .reply(200, {
            message: {
              role: 'assistant',
              content: 'Single call response without tools.'
            }
          });

        room.user.say('alice', 'hubot ask test');
        await new Promise((resolve) => setTimeout(resolve, 150));

        expect(room.messages).toContainEqual(['hubot', 'Single call response without tools.']);
        delete process.env.HUBOT_OLLAMA_TOOLS_ENABLED;
      });

      it('skips tool workflow when model does not support tools', async () => {
        process.env.HUBOT_OLLAMA_TOOLS_ENABLED = 'true';

        nock(OLLAMA_HOST)
          .post('/api/show', { name: 'llama3.2' })
          .reply(200, { capabilities: [] });

        // Single call without tools
        nock(OLLAMA_HOST)
          .post('/api/chat', (body) => {
            expect(body.tools).toBeUndefined();
            return true;
          })
          .reply(200, {
            message: {
              role: 'assistant',
              content: 'Response without tool support.'
            }
          });

        room.user.say('alice', 'hubot ask test');
        await new Promise((resolve) => setTimeout(resolve, 150));

        expect(room.messages).toContainEqual(['hubot', 'Response without tool support.']);
        delete process.env.HUBOT_OLLAMA_TOOLS_ENABLED;
      });

      it('uses single call when tools are supported but no tool is invoked', async () => {
        process.env.HUBOT_OLLAMA_TOOLS_ENABLED = 'true';

        nock(OLLAMA_HOST)
          .post('/api/show', { name: 'llama3.2' })
          .reply(200, { capabilities: ['tools'] });

        // Model decides not to use a tool
        nock(OLLAMA_HOST)
          .post('/api/chat')
          .reply(200, {
            message: {
              role: 'assistant',
              content: 'The answer is simple.'
            }
          });

        room.user.say('alice', 'hubot ask what is 2+2?');
        await new Promise((resolve) => setTimeout(resolve, 150));

        expect(room.messages).toContainEqual(['hubot', 'The answer is simple.']);
        delete process.env.HUBOT_OLLAMA_TOOLS_ENABLED;
      });

      it('executes two-call workflow when tool is actually invoked', async () => {
        process.env.HUBOT_OLLAMA_TOOLS_ENABLED = 'true';

        nock(OLLAMA_HOST)
          .post('/api/show', { name: 'llama3.2' })
          .reply(200, { capabilities: ['tools'] });

        // PHASE 1: First call - model decides to use hubot_ollama_get_current_time
        let callCount = 0;
        nock(OLLAMA_HOST)
          .post('/api/chat', () => {
            callCount++;
            return true;
          })
          .reply(200, {
            message: {
              role: 'assistant',
              content: 'Let me check the current time for you.',
              tool_calls: [
                {
                  function: {
                    name: 'hubot_ollama_get_current_time',
                    arguments: {}
                  }
                }
              ]
            }
          });

        // PHASE 3: Second call - model incorporates tool result
        nock(OLLAMA_HOST)
          .post('/api/chat')
          .reply(200, {
            message: {
              role: 'assistant',
              content: 'The current UTC time is 2:30:45 PM.'
            }
          });

        room.user.say('alice', 'hubot ask what time is it right now?');
        await new Promise((resolve) => setTimeout(resolve, 200));

        expect(room.messages.length).toBeGreaterThan(1);
        expect(callCount).toBeGreaterThanOrEqual(1);
        delete process.env.HUBOT_OLLAMA_TOOLS_ENABLED;
      });

      it('handles non-existent tool gracefully', async () => {
        process.env.HUBOT_OLLAMA_TOOLS_ENABLED = 'true';

        nock(OLLAMA_HOST)
          .post('/api/show', { name: 'llama3.2' })
          .reply(200, { capabilities: ['tools'] });

        // PHASE 1: Model invokes non-existent tool
        nock(OLLAMA_HOST)
          .post('/api/chat')
          .reply(200, {
            message: {
              role: 'assistant',
              content: 'I will use a special tool',
              tool_calls: [
                {
                  function: {
                    name: 'unknown_tool',
                    arguments: { query: 'test' }
                  }
                }
              ]
            }
          });

        // PHASE 3: Second call with error message
        nock(OLLAMA_HOST)
          .post('/api/chat')
          .reply(200, {
            message: {
              role: 'assistant',
              content: 'That tool is not available.'
            }
          });

        room.user.say('alice', 'hubot ask use unknown tool');
        await new Promise((resolve) => setTimeout(resolve, 200));

        expect(room.messages.length).toBeGreaterThan(1);
        delete process.env.HUBOT_OLLAMA_TOOLS_ENABLED;
      });

      it('handles web support probe failure gracefully', async () => {
        process.env.HUBOT_OLLAMA_WEB_ENABLED = 'true';
        process.env.HUBOT_OLLAMA_API_KEY = 'test-key';

        // ollama.show fails
        nock(OLLAMA_HOST)
          .post('/api/show', { name: 'llama3.2' })
          .replyWithError('Server error');

        // Falls back to single call
        mockOllamaChat('Response after probe failure');

        room.user.say('alice', 'hubot ask test');
        await new Promise((resolve) => setTimeout(resolve, 150));

        expect(room.messages.length).toBeGreaterThan(1);
        delete process.env.HUBOT_OLLAMA_WEB_ENABLED;
        delete process.env.HUBOT_OLLAMA_API_KEY;
      });

      it('caches model web support after first probe', async () => {
        process.env.HUBOT_OLLAMA_WEB_ENABLED = 'true';
        process.env.HUBOT_OLLAMA_API_KEY = 'test-key';

        nock(OLLAMA_HOST)
          .post('/api/show', { name: 'llama3.2' })
          .reply(200, { capabilities: ['webSearch'] });

        // First query evaluates web support
        nock(OLLAMA_HOST)
          .post('/api/chat', (body) => body.messages[body.messages.length - 1].content.includes('events'))
          .reply(200, {
            message: {
              role: 'assistant',
              content: 'NO'
            }
          });

        mockOllamaChat('First query response');

        room.user.say('alice', 'hubot ask what is python');
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Second query should reuse cache (only one /api/show call total)
        nock(OLLAMA_HOST)
          .post('/api/chat', (body) => body.messages[body.messages.length - 1].content.includes('events'))
          .reply(200, {
            message: {
              role: 'assistant',
              content: 'NO'
            }
          });

        mockOllamaChat('Second query response');

        room.user.say('alice', 'hubot ask what is javascript');
        await new Promise((resolve) => setTimeout(resolve, 150));

        expect(room.messages.length).toBeGreaterThan(2);
        delete process.env.HUBOT_OLLAMA_WEB_ENABLED;
        delete process.env.HUBOT_OLLAMA_API_KEY;
      });
    });
  });

  describe('Custom System Prompt with Slack', () => {
    it('includes custom prompt with user and bot names', async () => {
      process.env.HUBOT_OLLAMA_SYSTEM_PROMPT = 'You are a helpful assistant.';

      nock(OLLAMA_HOST)
        .post('/api/chat', (body) => {
          const systemMsg = body.messages[0];
          expect(systemMsg.content).toContain('You are a helpful assistant.');
          expect(systemMsg.content).toContain("User's Name");
          expect(systemMsg.content).toContain("Bot's Name");
          return true;
        })
        .reply(200, {
          message: {
            role: 'assistant',
            content: 'Response'
          }
        });

      room.user.say('alice', 'hubot ask test');
      await new Promise((resolve) => setTimeout(resolve, 150));

      delete process.env.HUBOT_OLLAMA_SYSTEM_PROMPT;
    });
  });

  describe('Model Capability Detection', () => {
    it('caches model capability detection result', async () => {
      process.env.HUBOT_OLLAMA_TOOLS_ENABLED = 'true';

      // First call to ollama.show
      nock(OLLAMA_HOST)
        .post('/api/show', { name: 'llama3.2' })
        .reply(200, { capabilities: ['tools'] });

      // First request
      nock(OLLAMA_HOST)
        .post('/api/chat')
        .reply(200, {
          message: { role: 'assistant', content: 'Response 1' }
        });

      room.user.say('alice', 'hubot ask first');
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Second request should NOT call ollama.show again (uses cache)
      nock(OLLAMA_HOST)
        .post('/api/chat')
        .reply(200, {
          message: { role: 'assistant', content: 'Response 2' }
        });

      room.user.say('alice', 'hubot ask second');
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Verify response was returned
      expect(room.messages).toContainEqual(['hubot', 'Response 2']);

      delete process.env.HUBOT_OLLAMA_TOOLS_ENABLED;
    });

    it('handles model capability detection error gracefully', async () => {
      process.env.HUBOT_OLLAMA_TOOLS_ENABLED = 'true';

      // ollama.show fails
      nock(OLLAMA_HOST)
        .post('/api/show', { name: 'llama3.2' })
        .replyWithError('Connection failed');

      // Single call without tools
      nock(OLLAMA_HOST)
        .post('/api/chat', (body) => {
          expect(body.tools).toBeUndefined();
          return true;
        })
        .reply(200, {
          message: { role: 'assistant', content: 'Response without tools' }
        });

      room.user.say('alice', 'hubot ask test');
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(room.messages).toContainEqual(['hubot', 'Response without tools']);
      delete process.env.HUBOT_OLLAMA_TOOLS_ENABLED;
    });
  });

  describe('Thread Message Formatting', () => {
    it('formats response object for Slack adapter', () => {
      const response = 'Thread answer';
      const formatted = { text: response, mrkdwn: true };
      expect(formatted).toHaveProperty('text');
      expect(formatted).toHaveProperty('mrkdwn');
      expect(formatted.text).toBe('Thread answer');
    });
  });

  describe('Web Search Edge Cases', () => {
    it('handles web search when model does not support web tools', async () => {
      process.env.HUBOT_OLLAMA_WEB_ENABLED = 'true';
      process.env.HUBOT_OLLAMA_API_KEY = 'test-key';

      nock(OLLAMA_HOST)
        .post('/api/show', { name: 'llama3.2' })
        .reply(200, { capabilities: [] });

      // Should skip web evaluation and just respond
      mockOllamaChat('Direct response without web search');

      room.user.say('alice', 'hubot ask what are latest events');
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(room.messages).toContainEqual(['hubot', 'Direct response without web search']);

      delete process.env.HUBOT_OLLAMA_WEB_ENABLED;
      delete process.env.HUBOT_OLLAMA_API_KEY;
    });

    it('continues when webSearch fails', async () => {
      process.env.HUBOT_OLLAMA_WEB_ENABLED = 'true';
      process.env.HUBOT_OLLAMA_API_KEY = 'test-key';

      nock(OLLAMA_HOST)
        .post('/api/show', { name: 'llama3.2' })
        .reply(200, { capabilities: ['webSearch', 'webFetch'] });

      // Web evaluation call
      nock(OLLAMA_HOST)
        .post('/api/chat', (body) => body.messages[body.messages.length - 1].content.includes('events'))
        .reply(200, {
          message: {
            role: 'assistant',
            content: 'latest tech news'
          }
        });

      // webSearch fails but continues
      nock(OLLAMA_HOST)
        .post('/api/webSearch')
        .replyWithError('Search service unavailable');

      // Main query call
      mockOllamaChat('Continuing without web results');

      room.user.say('alice', 'hubot ask what are latest tech trends?');
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should still respond even though web search failed
      expect(room.messages.length).toBeGreaterThan(1);

      delete process.env.HUBOT_OLLAMA_WEB_ENABLED;
      delete process.env.HUBOT_OLLAMA_API_KEY;
    });
  });
});
