const createHubotCommandTool = require('../src/tools/hubot-command-tool');

describe('hubot-command-tool', () => {
  let tool;
  let mockLogger;
  let mockRobot;
  let mockMsg;
  let receiveImpl;

  const makeUser = (overrides = {}) => ({
    id: 'U1',
    name: 'alice',
    room: 'general',
    ...overrides
  });

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    tool = createHubotCommandTool(null, {}, mockLogger);

    receiveImpl = vi.fn().mockResolvedValue(undefined);
    mockRobot = {
      name: 'hubot',
      alias: null,
      adapter: {
        send: vi.fn(),
        reply: vi.fn(),
        emote: vi.fn()
      },
      receive: (...args) => receiveImpl(...args)
    };
    mockMsg = { message: { user: makeUser() } };
  });

  describe('tool definition', () => {
    it('should have the correct name', () => {
      expect(tool.name).toBe('hubot_ollama_run_command');
    });

    it('should mention confirmation for state-changing commands', () => {
      expect(tool.description.toLowerCase()).toMatch(/confirmed/);
    });

    it('should require command and make confirmed optional', () => {
      expect(tool.parameters.required).toEqual(['command']);
      expect(tool.parameters.properties).toHaveProperty('command');
      expect(tool.parameters.properties).toHaveProperty('confirmed');
    });
  });

  describe('handler — validation errors', () => {
    it('should throw when command is missing', async () => {
      await expect(tool.handler({}, mockRobot, mockMsg)).rejects.toThrow('command parameter is required');
    });

    it('should throw when command is blank', async () => {
      await expect(tool.handler({ command: '   ' }, mockRobot, mockMsg)).rejects.toThrow('command parameter is required');
    });

    it('should throw when robot.receive is unavailable', async () => {
      await expect(tool.handler({ command: 'ping' }, {}, mockMsg)).rejects.toThrow('robot.receive is not available');
    });

    it('should throw when robot.adapter is unavailable', async () => {
      const robotNoAdapter = { receive: receiveImpl };
      await expect(tool.handler({ command: 'ping' }, robotNoAdapter, mockMsg)).rejects.toThrow('robot.adapter is not available');
    });

    it('should throw when originating user context is missing', async () => {
      await expect(tool.handler({ command: 'ping' }, mockRobot, {})).rejects.toThrow('Originating user context is not available');
    });

    it('should throw when command exceeds max length', async () => {
      const longCommand = 'a'.repeat(501);
      await expect(tool.handler({ command: longCommand }, mockRobot, mockMsg)).rejects.toThrow('command exceeds maximum length');
    });
  });

  describe('handler — self-invocation guard', () => {
    it('should refuse to invoke the ask command', async () => {
      await expect(tool.handler({ command: 'hubot ask something' }, mockRobot, mockMsg))
        .rejects.toThrow('Refusing to invoke the LLM command from within itself');
      expect(receiveImpl).not.toHaveBeenCalled();
    });

    it('should refuse ollama/llm aliases too', async () => {
      await expect(tool.handler({ command: 'llm summarize' }, mockRobot, mockMsg))
        .rejects.toThrow('Refusing to invoke the LLM command from within itself');
    });
  });

  describe('handler — mutating command guard', () => {
    it('should refuse an unconfirmed mutating command', async () => {
      const result = await tool.handler({ command: 'project delete foo' }, mockRobot, mockMsg);
      expect(result.error).toMatch(/confirmed: true/);
      expect(receiveImpl).not.toHaveBeenCalled();
    });

    it('should proceed when confirmed is true', async () => {
      receiveImpl.mockImplementation(async () => {
        mockRobot.adapter.send({ room: 'general' }, 'deleted!');
      });
      const result = await tool.handler({ command: 'project delete foo', confirmed: true }, mockRobot, mockMsg);
      expect(receiveImpl).toHaveBeenCalledTimes(1);
      expect(result.response).toBe('deleted!');
    });

    it('should not require confirmation for read-only commands', async () => {
      receiveImpl.mockImplementation(async () => {
        mockRobot.adapter.send({ room: 'general' }, 'here is the list');
      });
      const result = await tool.handler({ command: 'project list' }, mockRobot, mockMsg);
      expect(result.response).toBe('here is the list');
    });
  });

  describe('handler — addressing', () => {
    it('should prefix the command with the bot name when not already addressed', async () => {
      let seenText = null;
      receiveImpl.mockImplementation(async (message) => { seenText = message.text; });
      const result = await tool.handler({ command: 'project list' }, mockRobot, mockMsg);
      expect(seenText).toBe('hubot project list');
      expect(result.command).toBe('hubot project list');
    });

    it('should not double-prefix an already-addressed command', async () => {
      let seenText = null;
      receiveImpl.mockImplementation(async (message) => { seenText = message.text; });
      await tool.handler({ command: 'hubot project list' }, mockRobot, mockMsg);
      expect(seenText).toBe('hubot project list');
    });

    it('should use robot.alias over robot.name when set', async () => {
      mockRobot.alias = '!';
      let seenText = null;
      receiveImpl.mockImplementation(async (message) => { seenText = message.text; });
      await tool.handler({ command: 'project list' }, mockRobot, mockMsg);
      expect(seenText).toBe('! project list');
    });
  });

  describe('handler — response capture', () => {
    it('should capture adapter.send output for the matching room and return it', async () => {
      receiveImpl.mockImplementation(async () => {
        mockRobot.adapter.send({ room: 'general' }, 'line one');
        mockRobot.adapter.send({ room: 'general' }, 'line two');
      });
      const result = await tool.handler({ command: 'project list' }, mockRobot, mockMsg);
      expect(result.response).toBe('line one\nline two');
    });

    it('should restore the original adapter.send after execution', async () => {
      const originalSend = mockRobot.adapter.send;
      receiveImpl.mockImplementation(async () => {
        mockRobot.adapter.send({ room: 'general' }, 'hi');
      });
      await tool.handler({ command: 'project list' }, mockRobot, mockMsg);
      expect(mockRobot.adapter.send).toBe(originalSend);
    });

    it('should pass through sends to unrelated rooms instead of capturing them', async () => {
      receiveImpl.mockImplementation(async () => {
        mockRobot.adapter.send({ room: 'other-room' }, 'not for us');
      });
      const result = await tool.handler({ command: 'project list' }, mockRobot, mockMsg);
      expect(result.response).toBeNull();
      expect(result.message).toMatch(/no listener responded/i);
      expect(mockRobot.adapter.send).toHaveBeenCalledWith({ room: 'other-room' }, 'not for us');
    });

    it('should report when no listener responded', async () => {
      const result = await tool.handler({ command: 'project list' }, mockRobot, mockMsg);
      expect(result.response).toBeNull();
      expect(result.message).toMatch(/no listener responded/i);
    });

    it('should restore adapter.send even if robot.receive throws', async () => {
      const originalSend = mockRobot.adapter.send;
      receiveImpl.mockRejectedValue(new Error('boom'));
      await expect(tool.handler({ command: 'project list' }, mockRobot, mockMsg)).rejects.toThrow('boom');
      expect(mockRobot.adapter.send).toBe(originalSend);
    });
  });

  describe('handler — reentrancy guard', () => {
    it('should refuse a nested invocation for the same user/room while one is in flight', async () => {
      let nestedResult;
      receiveImpl.mockImplementation(async () => {
        nestedResult = await tool.handler({ command: 'project list' }, mockRobot, mockMsg).catch((e) => e);
      });

      await tool.handler({ command: 'project list' }, mockRobot, mockMsg);

      expect(nestedResult).toBeInstanceOf(Error);
      expect(nestedResult.message).toMatch(/looped back into this tool/);
    });

    it('should release the lock after completion, allowing a later sequential call', async () => {
      receiveImpl.mockResolvedValue(undefined);
      await tool.handler({ command: 'project list' }, mockRobot, mockMsg);
      await expect(tool.handler({ command: 'project list' }, mockRobot, mockMsg)).resolves.toBeDefined();
    });

    it('should release the lock even when robot.receive throws', async () => {
      receiveImpl.mockRejectedValueOnce(new Error('boom'));
      await expect(tool.handler({ command: 'project list' }, mockRobot, mockMsg)).rejects.toThrow('boom');

      receiveImpl.mockResolvedValue(undefined);
      await expect(tool.handler({ command: 'project list' }, mockRobot, mockMsg)).resolves.toBeDefined();
    });

    it('should not block a concurrent invocation for a different user/room', async () => {
      const otherMsg = { message: { user: makeUser({ id: 'U2', name: 'bob', room: 'other-room' }) } };
      let concurrentResult;
      receiveImpl.mockImplementation(async () => {
        concurrentResult = await tool.handler({ command: 'project list' }, mockRobot, otherMsg).catch((e) => e);
      });

      await tool.handler({ command: 'project list' }, mockRobot, mockMsg);

      expect(concurrentResult).not.toBeInstanceOf(Error);
    });
  });

  describe('handler — timeout', () => {
    it('should reject if robot.receive never resolves in time', async () => {
      vi.useFakeTimers();
      receiveImpl.mockImplementation(() => new Promise(() => {}));

      const promise = tool.handler({ command: 'project list' }, mockRobot, mockMsg);
      const assertion = expect(promise).rejects.toThrow('Command timed out');
      await vi.advanceTimersByTimeAsync(15001);
      await assertion;

      vi.useRealTimers();
    });
  });
});
