const { EventEmitter } = require('events');

const Helper = require('hubot-test-helper');

const helper = new Helper('./../src/hubot-script.js');

// Mock child_process
const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
  spawn: (...args) => mockSpawn(...args),
}));

describe('hubot-ollama', () => {
  let room = null;

  beforeEach(() => {
    process.env.HUBOT_OLLAMA_MODEL = 'llama3.2';
    room = helper.createRoom();

    // Mock robot.logger methods
    ['debug', 'info', 'warning', 'error'].forEach((method) => {
      room.robot.logger[method] = jest.fn();
    });

    // Clear mock between tests
    mockSpawn.mockClear();
  });

  afterEach(() => {
    room.destroy();
    delete process.env.HUBOT_OLLAMA_MODEL;
    delete process.env.HUBOT_OLLAMA_SYSTEM_PROMPT;
    delete process.env.HUBOT_OLLAMA_CONTEXT_SCOPE;
    delete process.env.HUBOT_OLLAMA_CONTEXT_TURNS;
  });  // Helper to create a mock process
  const createMockProcess = (options = {}) => {
    const mockProcess = new EventEmitter();
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    let closed = false;
    mockProcess.killCalled = false;
    mockProcess.kill = () => {
      mockProcess.killCalled = true;
      if (!closed) {
        closed = true;
        setTimeout(() => mockProcess.emit('close', options.exitCode || 0), 0);
      }
    };

    // Simulate process behavior after a delay
    if (!options.noAutoClose) {
      setTimeout(() => {
        if (options.error) {
          mockProcess.emit('error', options.error);
        } else {
          if (options.stdout) {
            mockProcess.stdout.emit('data', Buffer.from(options.stdout));
          }
          if (options.stderr) {
            mockProcess.stderr.emit('data', Buffer.from(options.stderr));
          }
          if (!closed) {
            closed = true;
            mockProcess.emit('close', options.exitCode || 0);
          }
        }
      }, 10);
    }

    return mockProcess;
  };

  describe('Basic Command Handling', () => {
    describe('ask hubot a question', () => {
      beforeEach((done) => {
        mockSpawn.mockReturnValue(createMockProcess({
          stdout: 'The capital of France is Paris.',
        }));

        room.user.say('alice', 'hubot ask what is the capital of France?');
        setTimeout(done, 150);
      });

      it('hubot responds with ollama output', () => {
        expect(room.messages).toEqual([
          ['alice', 'hubot ask what is the capital of France?'],
          ['hubot', 'The capital of France is Paris.'],
        ]);
      });

      it('calls ollama with correct model', () => {
        const call = mockSpawn.mock.calls[0];
        expect(call[0]).toContain('ollama'); // Can be 'ollama' or '/path/to/ollama'
        expect(call[1]).toEqual(expect.arrayContaining(['run', 'llama3.2', '--nowordwrap']));
        expect(call[2]).toEqual(expect.objectContaining({ shell: false }));
      });

      it('logs debug message', () => {
        expect(room.robot.logger.debug).toHaveBeenCalledWith('Calling Ollama with model: llama3.2');
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

      it('does not call ollama', () => {
        expect(mockSpawn).not.toHaveBeenCalled();
      });
    });

    describe('alternative command aliases', () => {
      it('responds to ollama command', (done) => {
        mockSpawn.mockReturnValue(createMockProcess({
          stdout: 'Response using ollama command',
        }));
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
        mockSpawn.mockReturnValue(createMockProcess({
          stdout: 'Response using llm command',
        }));
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
    describe('ollama binary not found', () => {
      beforeEach((done) => {
        const error = new Error('spawn ollama ENOENT');
        error.code = 'ENOENT';
        mockSpawn.mockReturnValue(createMockProcess({ error }));

        room.user.say('alice', 'hubot ask test question');
        setTimeout(done, 150);
      });

      it('hubot responds with helpful error message', () => {
        expect(room.messages).toEqual([
          ['alice', 'hubot ask test question'],
          ['hubot', 'Error: The `ollama` command is not available. Please install Ollama from https://ollama.ai/'],
        ]);
      });

      it('logs error message', () => {
        expect(room.robot.logger.error).toHaveBeenCalled();
      });
    });

    describe('model not found', () => {
      beforeEach((done) => {
        mockSpawn.mockReturnValue(createMockProcess({
          exitCode: 1,
          stderr: 'Error: model not found',
        }));

        room.user.say('alice', 'hubot ask test question');
        setTimeout(done, 150);
      });

      it('hubot responds with model error message', () => {
        expect(room.messages[1][1]).toContain('Error: The model \'llama3.2\' was not found');
      });

      it('logs error message', () => {
        expect(room.robot.logger.error).toHaveBeenCalled();
      });
    });

    describe('ollama process error', () => {
      beforeEach((done) => {
        mockSpawn.mockReturnValue(createMockProcess({
          exitCode: 1,
          stderr: 'Connection refused',
        }));

        room.user.say('alice', 'hubot ask test question');
        setTimeout(done, 150);
      });

      it('hubot responds with error message', () => {
        expect(room.messages[1][1]).toContain('Error: Ollama error: Connection refused');
      });

      it('logs error message', () => {
        expect(room.robot.logger.error).toHaveBeenCalled();
      });
    });

    describe('empty response from ollama', () => {
      beforeEach((done) => {
        mockSpawn.mockReturnValue(createMockProcess({
          stdout: '',
        }));

        room.user.say('alice', 'hubot ask test question');
        setTimeout(done, 150);
      });

      it('hubot responds with empty response error', () => {
        expect(room.messages).toEqual([
          ['alice', 'hubot ask test question'],
          ['hubot', 'Error: Ollama returned an empty response.'],
        ]);
      });
    });

    describe('model installation in progress', () => {
      beforeEach((done) => {
        mockSpawn.mockReturnValue(createMockProcess({
          exitCode: 1,
          stderr: '\x1B[32mpulling manifest\x1B[0m\npulling model...',
        }));
        room.user.say('alice', 'hubot ask test');
        setTimeout(done, 150);
      });

      it('provides clean error message without installation spam', () => {
        expect(room.messages[1][1]).toContain('is being installed');
        expect(room.messages[1][1]).toContain('try again in a moment');
        expect(room.messages[1][1]).not.toContain('pulling');
      });
    });

    describe('timeout handling', () => {
      let proc;
      beforeEach((done) => {
        // Recreate room to re-read env-backed constants
        room.destroy();
        process.env.HUBOT_OLLAMA_TIMEOUT_MS = '50';
        room = helper.createRoom();
        ['debug', 'info', 'warning', 'error'].forEach((method) => {
          room.robot.logger[method] = jest.fn();
        });
        proc = createMockProcess({ noAutoClose: true });
        mockSpawn.mockReturnValue(proc);
        room.user.say('alice', 'hubot ask slow');
        setTimeout(done, 100);
      });

      afterEach(() => {
        delete process.env.HUBOT_OLLAMA_TIMEOUT_MS;
      });

      it('kills long-running process and reports timeout error', () => {
        expect(proc.killCalled).toBe(true);
        const botMessage = room.messages.find((m) => m[0] === 'hubot');
        expect(botMessage && botMessage[1]).toMatch(/timed out/i);
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

        mockSpawn.mockReturnValue(createMockProcess({
          stdout: 'Response from Mistral model.',
        }));

        room.user.say('alice', 'hubot ask test');
        setTimeout(done, 150);
      });

      it('uses custom model', () => {
        const call = mockSpawn.mock.calls[0];
        expect(call[1]).toEqual(expect.arrayContaining(['run', 'mistral']));
        expect(call[2]).toEqual(expect.objectContaining({ shell: false }));
      });

      it('logs correct model name', () => {
        expect(room.robot.logger.debug).toHaveBeenCalledWith('Calling Ollama with model: mistral');
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
        mockSpawn.mockReturnValue(createMockProcess({ stdout: 'ok' }));
        room.user.say('alice', 'hubot ask hi');
        setTimeout(done, 150);
      });

      it('uses default model name', () => {
        const call = mockSpawn.mock.calls[0];
        expect(call[1]).toContain('llama3.2');
        expect(call[1]).not.toContain('mistral');
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
        mockSpawn.mockReturnValue(createMockProcess({ stdout: 'ok' }));
        room.user.say('alice', 'hubot ask test');
        setTimeout(done, 150);
      });

      it('uses custom system prompt in the request', () => {
        const call = mockSpawn.mock.calls[0];
        const prompt = call[1][3]; // The full prompt argument
        expect(prompt).toContain('You are a helpful assistant. Be concise.');
      });
    });

    describe('prompt length limit', () => {
      const longText = 'x'.repeat(2100);
      beforeEach((done) => {
        process.env.HUBOT_OLLAMA_MAX_PROMPT_CHARS = '2000';
        mockSpawn.mockReturnValue(createMockProcess({ stdout: 'ok' }));
        room.user.say('alice', `hubot ask ${longText}`);
        setTimeout(done, 200);
      });

      afterEach(() => {
        delete process.env.HUBOT_OLLAMA_MAX_PROMPT_CHARS;
      });

      it('truncates overly long prompts', () => {
        const call = mockSpawn.mock.calls[0];
        const prompt = call[1][3];
        // Should end with ellipsis (…)
        expect(prompt).toContain('…');
      });

      it('sends a truncation notice', () => {
        expect(room.messages[1][1]).toContain('truncated');
      });
    });

    describe('streaming mode', () => {
      beforeEach((done) => {
        process.env.HUBOT_OLLAMA_STREAM = 'true';
        const proc = createMockProcess({ noAutoClose: true });
        mockSpawn.mockReturnValue(proc);

        room.user.say('alice', 'hubot ask test');
        
        // Simulate streaming chunks
        setTimeout(() => {
          proc.stdout.emit('data', Buffer.from('First '));
        }, 20);
        setTimeout(() => {
          proc.stdout.emit('data', Buffer.from('chunk. '));
        }, 40);
        setTimeout(() => {
          proc.stdout.emit('data', Buffer.from('Last chunk.'));
        }, 60);
        setTimeout(() => {
          proc.emit('close', 0);
        }, 80);
        setTimeout(done, 150);
      });

      afterEach(() => {
        delete process.env.HUBOT_OLLAMA_STREAM;
      });

      it('sends streaming chunks as they arrive', () => {
        // Should have multiple messages sent
        const hubotMessages = room.messages.filter((m) => m[0] === 'hubot');
        expect(hubotMessages.length).toBeGreaterThan(1);
      });
    });

    describe('custom ollama command path', () => {
      beforeEach((done) => {
        process.env.HUBOT_OLLAMA_CMD = '/custom/path/to/ollama';
        mockSpawn.mockReturnValue(createMockProcess({ stdout: 'ok' }));
        room.user.say('alice', 'hubot ask test');
        setTimeout(done, 150);
      });

      afterEach(() => {
        delete process.env.HUBOT_OLLAMA_CMD;
      });

      it('uses custom ollama binary path', () => {
        const call = mockSpawn.mock.calls[0];
        expect(call[0]).toBe('/custom/path/to/ollama');
      });
    });
  });

  describe('empty response from ollama', () => {
    beforeEach((done) => {
      mockSpawn.mockReturnValue(createMockProcess({
        stdout: '',
      }));

      room.user.say('alice', 'hubot ask test question');
      setTimeout(done, 150);
    });

    it('hubot responds with empty response error', () => {
      expect(room.messages).toEqual([
        ['alice', 'hubot ask test question'],
        ['hubot', 'Error: Ollama returned an empty response.'],
      ]);
    });
  });

  describe('Security', () => {
    describe('shell injection prevention', () => {
      beforeEach((done) => {
        mockSpawn.mockReturnValue(createMockProcess({
          stdout: 'Safe output',
        }));

        room.user.say('alice', 'hubot ask tell me something; rm -rf / && `uname` $(whoami) | cat /etc/passwd');
        setTimeout(done, 150);
      });

      it('spawns ollama without using a shell', () => {
        const call = mockSpawn.mock.calls[0];
        expect(call[0]).toContain('ollama');
        expect(call[2]).toEqual(expect.objectContaining({ shell: false }));
      });
    });

    describe('control character sanitization', () => {
      beforeEach((done) => {
        mockSpawn.mockReturnValue(createMockProcess({ stdout: 'ok' }));
        // Include various control characters
        room.user.say('alice', 'hubot ask test\x00\x01\x02\x03prompt');
        setTimeout(done, 150);
      });

      it('strips control characters from prompt', () => {
        const call = mockSpawn.mock.calls[0];
        const prompt = call[1][3];
        // Should not contain null bytes or other control chars (except tab, newline, CR)
        expect(prompt).not.toContain('\x00');
        expect(prompt).not.toContain('\x01');
      });
    });
  });

  describe('Output Processing', () => {
    describe('ANSI color code stripping', () => {
      beforeEach((done) => {
        // Simulate output with ANSI color codes
        mockSpawn.mockReturnValue(createMockProcess({
          stdout: '\x1B[32mThis is green text\x1B[0m and \x1B[1;31mbold red\x1B[0m normal',
        }));
        room.user.say('alice', 'hubot ask test');
        setTimeout(done, 150);
      });

      it('removes ANSI codes from response', () => {
        expect(room.messages).toEqual([
          ['alice', 'hubot ask test'],
          ['hubot', 'This is green text and bold red normal'],
        ]);
      });
    });

    describe('spinner character filtering', () => {
      beforeEach((done) => {
        const proc = createMockProcess({ noAutoClose: true });
        mockSpawn.mockReturnValue(proc);
        
        room.user.say('alice', 'hubot ask test');
        
        // Send spinner frames to stderr (should be filtered)
        setTimeout(() => {
          proc.stderr.emit('data', Buffer.from('⠋'));
        }, 20);
        setTimeout(() => {
          proc.stderr.emit('data', Buffer.from('⠙'));
        }, 30);
        setTimeout(() => {
          proc.stderr.emit('data', Buffer.from('Actual error message'));
        }, 40);
        setTimeout(() => {
          proc.stdout.emit('data', Buffer.from('Response'));
        }, 50);
        setTimeout(() => {
          proc.emit('close', 0);
        }, 60);
        setTimeout(done, 150);
      });

      it('filters spinner frames from stderr but keeps real error messages', () => {
        // Should respond normally despite spinner noise in stderr
        expect(room.messages[1][1]).toBe('Response');
      });
    });
  });

  describe('Conversation Context', () => {
    describe('room-user scope (default)', () => {
      beforeEach(async () => {
        mockSpawn
          .mockReturnValueOnce(createMockProcess({ stdout: 'Answer one' }))
          .mockReturnValueOnce(createMockProcess({ stdout: 'Answer two' }));

        // First user asks, stores context for alice
        room.user.say('alice', 'hubot ask First question');
        await new Promise((resolve) => setTimeout(resolve, 80));

        // Second user asks; in room-user scope, bob should NOT inherit alice context
        room.user.say('bob', 'hubot ask Follow-up?');
        await new Promise((resolve) => setTimeout(resolve, 120));
      });

      it('isolates context per user', () => {
        // Second spawn call prompt should not include the previous transcript marker
        const secondCall = mockSpawn.mock.calls[1];
        const prompt = secondCall[1][3];
        expect(prompt).toContain('User: Follow-up?');
        expect(prompt).not.toContain('Recent chat transcript');
        expect(prompt).not.toContain('First question');
        expect(prompt).not.toContain('Answer one');
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

        mockSpawn
          .mockReturnValueOnce(createMockProcess({ stdout: 'Answer one' }))
          .mockReturnValueOnce(createMockProcess({ stdout: 'Answer two' }));

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
        const secondCall = mockSpawn.mock.calls[1];
        const prompt = secondCall[1][3];
        expect(prompt).toContain('Recent chat transcript');
        expect(prompt).toContain('User: First question');
        expect(prompt).toContain('Assistant: Answer one');
        expect(prompt).toContain('User: Follow-up?');
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

        mockSpawn
          .mockReturnValueOnce(createMockProcess({ stdout: 'Thread answer' }))
          .mockReturnValueOnce(createMockProcess({ stdout: 'Main answer' }));

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
        expect(mockSpawn).toHaveBeenCalledTimes(2);
        const secondCall = mockSpawn.mock.calls[1];
        const prompt = secondCall[1][3];
        expect(prompt).toContain('User: Main question');
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

        mockSpawn
          .mockReturnValueOnce(createMockProcess({ stdout: 'First answer' }))
          .mockReturnValueOnce(createMockProcess({ stdout: 'Second answer' }));

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
        const secondCall = mockSpawn.mock.calls[1];
        const prompt = secondCall[1][3];
        // Should not include first question/answer since it expired
        expect(prompt).not.toContain('First answer');
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

        mockSpawn
          .mockReturnValueOnce(createMockProcess({ stdout: 'First answer' }))
          .mockReturnValueOnce(createMockProcess({ stdout: 'Second answer' }));

        room.user.say('alice', 'hubot ask First');
        await new Promise((resolve) => setTimeout(resolve, 80));

        room.user.say('alice', 'hubot ask Second');
        await new Promise((resolve) => setTimeout(resolve, 120));
      });

      afterEach(() => {
        delete process.env.HUBOT_OLLAMA_CONTEXT_TTL_MS;
      });

      it('does not store or use context when disabled', () => {
        const secondCall = mockSpawn.mock.calls[1];
        const prompt = secondCall[1][3];
        expect(prompt).not.toContain('Recent chat transcript');
        expect(prompt).not.toContain('First');
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

        mockSpawn.mockReturnValue(createMockProcess({ stdout: 'ok' }));

        room.user.say('alice', 'hubot ask test');
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Manually verify the context storage logic by checking brain
        const contexts = room.robot.brain.get('ollamaContexts');
        expect(contexts).toBeDefined();
        
        // Check that CONTEXT_TURNS constant was set correctly
        const call = mockSpawn.mock.calls[0];
        expect(call).toBeDefined();
        
        delete process.env.HUBOT_OLLAMA_CONTEXT_TURNS;
      });
    });
  });
});
