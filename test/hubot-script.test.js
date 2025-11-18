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
  });

  // Helper to create a mock process
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

  describe('custom model configuration', () => {
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

  describe('does not allow shell injection via prompt', () => {
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

  describe('truncates overly long prompts and notifies user', () => {
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

    it('sends a truncation notice', () => {
      expect(room.messages[1][1]).toContain('truncated');
    });
  });

  describe('kills long-running ollama process after timeout', () => {
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
      setTimeout(done, 1000);
    });

    afterEach(() => {
      delete process.env.HUBOT_OLLAMA_TIMEOUT_MS;
    });

    it('reports a timeout error', () => {
      expect(proc.killCalled).toBe(true);
      const botMessage = room.messages.find((m) => m[0] === 'hubot');
      expect(botMessage && botMessage[1]).toMatch(/timed out/i);
    });
  });

  describe('alternative command aliases', () => {
    beforeEach((done) => {
      mockSpawn.mockReturnValue(createMockProcess({
        stdout: 'Response using ollama command',
      }));
      room.user.say('alice', 'hubot ollama test prompt');
      setTimeout(done, 150);
    });

    it('responds to ollama command', () => {
      expect(room.messages).toEqual([
        ['alice', 'hubot ollama test prompt'],
        ['hubot', 'Response using ollama command'],
      ]);
    });
  });

  describe('llm command alias', () => {
    beforeEach((done) => {
      mockSpawn.mockReturnValue(createMockProcess({
        stdout: 'Response using llm command',
      }));
      room.user.say('alice', 'hubot llm another test');
      setTimeout(done, 150);
    });

    it('responds to llm command', () => {
      expect(room.messages).toEqual([
        ['alice', 'hubot llm another test'],
        ['hubot', 'Response using llm command'],
      ]);
    });
  });

  describe('strips ANSI color codes from output', () => {
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
});
