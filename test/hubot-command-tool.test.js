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

  // Runs the handler under fake timers and drains every scheduled timer
  // (settle/grace/idle waits) before returning the (possibly rejected) promise.
  const runHandler = async (args, msg = mockMsg) => {
    const promise = tool.handler(args, mockRobot, msg);
    promise.catch(() => {}); // avoid unhandled-rejection noise while timers drain
    await vi.runAllTimersAsync();
    return promise;
  };

  beforeEach(() => {
    vi.useFakeTimers();
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

  afterEach(() => {
    vi.useRealTimers();
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
      await expect(runHandler({})).rejects.toThrow('command parameter is required');
    });

    it('should throw when command is blank', async () => {
      await expect(runHandler({ command: '   ' })).rejects.toThrow('command parameter is required');
    });

    it('should throw when robot.receive is unavailable', async () => {
      const promise = tool.handler({ command: 'ping' }, {}, mockMsg);
      await expect(promise).rejects.toThrow('robot.receive is not available');
    });

    it('should throw when robot.adapter is unavailable', async () => {
      const robotNoAdapter = { receive: receiveImpl };
      const promise = tool.handler({ command: 'ping' }, robotNoAdapter, mockMsg);
      await expect(promise).rejects.toThrow('robot.adapter is not available');
    });

    it('should throw when originating user context is missing', async () => {
      const promise = tool.handler({ command: 'ping' }, mockRobot, {});
      await expect(promise).rejects.toThrow('Originating user context is not available');
    });

    it('should throw when command exceeds max length', async () => {
      const longCommand = 'a'.repeat(501);
      await expect(runHandler({ command: longCommand })).rejects.toThrow('command exceeds maximum length');
    });
  });

  describe('handler — self-invocation guard', () => {
    it('should refuse to invoke the ask command', async () => {
      await expect(runHandler({ command: 'hubot ask something' }))
        .rejects.toThrow('Refusing to invoke the LLM command from within itself');
      expect(receiveImpl).not.toHaveBeenCalled();
    });

    it('should refuse ollama/llm aliases too', async () => {
      await expect(runHandler({ command: 'llm summarize' }))
        .rejects.toThrow('Refusing to invoke the LLM command from within itself');
    });
  });

  describe('handler — mutating command guard', () => {
    it('should refuse an unconfirmed mutating command', async () => {
      const result = await runHandler({ command: 'project delete foo' });
      expect(result.error).toMatch(/confirmed: true/);
      expect(receiveImpl).not.toHaveBeenCalled();
    });

    it('should proceed when confirmed is true', async () => {
      receiveImpl.mockImplementation(async () => {
        mockRobot.adapter.send({ room: 'general' }, 'deleted!');
      });
      const result = await runHandler({ command: 'project delete foo', confirmed: true });
      expect(receiveImpl).toHaveBeenCalledTimes(1);
      expect(result.response).toBe('deleted!');
    });

    it('should not require confirmation for read-only commands', async () => {
      receiveImpl.mockImplementation(async () => {
        mockRobot.adapter.send({ room: 'general' }, 'here is the list');
      });
      const result = await runHandler({ command: 'project list' });
      expect(result.response).toBe('here is the list');
    });
  });

  describe('handler — addressing', () => {
    it('should prefix the command with the bot name when not already addressed', async () => {
      let seenText = null;
      receiveImpl.mockImplementation(async (message) => { seenText = message.text; });
      const result = await runHandler({ command: 'project list' });
      expect(seenText).toBe('hubot project list');
      expect(result.command).toBe('hubot project list');
    });

    it('should not double-prefix an already-addressed command', async () => {
      let seenText = null;
      receiveImpl.mockImplementation(async (message) => { seenText = message.text; });
      await runHandler({ command: 'hubot project list' });
      expect(seenText).toBe('hubot project list');
    });

    it('should use robot.alias over robot.name when set', async () => {
      mockRobot.alias = '!';
      let seenText = null;
      receiveImpl.mockImplementation(async (message) => { seenText = message.text; });
      await runHandler({ command: 'project list' });
      expect(seenText).toBe('! project list');
    });
  });

  describe('handler — response capture', () => {
    it('should capture adapter.send output for the matching room and return it', async () => {
      receiveImpl.mockImplementation(async () => {
        mockRobot.adapter.send({ room: 'general' }, 'line one');
        mockRobot.adapter.send({ room: 'general' }, 'line two');
      });
      const result = await runHandler({ command: 'project list' });
      expect(result.response).toBe('line one\nline two');
    });

    it('should restore the original adapter.send after execution', async () => {
      const originalSend = mockRobot.adapter.send;
      receiveImpl.mockImplementation(async () => {
        mockRobot.adapter.send({ room: 'general' }, 'hi');
      });
      await runHandler({ command: 'project list' });
      expect(mockRobot.adapter.send).toBe(originalSend);
    });

    it('should pass through sends to unrelated rooms instead of capturing them', async () => {
      receiveImpl.mockImplementation(async () => {
        mockRobot.adapter.send({ room: 'other-room' }, 'not for us');
      });
      const result = await runHandler({ command: 'project list' });
      expect(result.response).toBeNull();
      expect(result.message).toMatch(/no listener responded/i);
      expect(mockRobot.adapter.send).toHaveBeenCalledWith({ room: 'other-room' }, 'not for us');
    });

    it('should report when no listener responded', async () => {
      const result = await runHandler({ command: 'project list' });
      expect(result.response).toBeNull();
      expect(result.message).toMatch(/no listener responded/i);
    });

    it('should restore adapter.send even if robot.receive throws', async () => {
      const originalSend = mockRobot.adapter.send;
      receiveImpl.mockRejectedValue(new Error('boom'));
      await expect(runHandler({ command: 'project list' })).rejects.toThrow('boom');
      expect(mockRobot.adapter.send).toBe(originalSend);
    });
  });

  describe('handler — settling on async (non-awaited) responses', () => {
    // Regression test for the case where a listener's callback issues a
    // Node-callback-style async call (e.g. robot.http(...).get()(cb)) without
    // awaiting it: robot.receive() resolves before the real response is sent.
    it('should still capture a response that arrives after robot.receive() resolves, within the grace window', async () => {
      receiveImpl.mockImplementation(async () => {
        setTimeout(() => {
          mockRobot.adapter.send({ room: 'general' }, 'late async response');
        }, 4000); // resolves before this fires — well within the settle grace window
      });

      const result = await runHandler({ command: 'redmine show 5' });
      expect(result.response).toBe('late async response');
    });

    it('should give up and report no response once the grace window elapses with nothing captured', async () => {
      receiveImpl.mockImplementation(async () => {
        setTimeout(() => {
          mockRobot.adapter.send({ room: 'general' }, 'too late');
        }, 11000); // beyond the settle grace window
      });

      const result = await runHandler({ command: 'redmine show 5' });
      expect(result.response).toBeNull();
      expect(result.message).toMatch(/no listener responded/i);

      // The late send should leak through to the real adapter once capture is
      // torn down — documenting the boundary rather than silently swallowing it.
      expect(mockRobot.adapter.send).toHaveBeenCalledWith({ room: 'general' }, 'too late');
    });

    it('should debounce trailing multi-part sends into a single response', async () => {
      receiveImpl.mockImplementation(async () => {
        mockRobot.adapter.send({ room: 'general' }, 'part one');
        setTimeout(() => {
          mockRobot.adapter.send({ room: 'general' }, 'part two');
        }, 200); // well within the settle grace window
      });

      const result = await runHandler({ command: 'project list' });
      expect(result.response).toBe('part one\npart two');
    });

    it('should not cut off a slow follow-up just because an immediate ack was captured first', async () => {
      // "Acknowledge request, fire off HTTP request that can take as long as it needs"
      receiveImpl.mockImplementation(async () => {
        mockRobot.adapter.send({ room: 'general' }, 'Working on it...');
        setTimeout(() => {
          mockRobot.adapter.send({ room: 'general' }, 'Here is your answer.');
        }, 6000); // long after the old 400ms trailing-idle debounce would have given up
      });

      const result = await runHandler({ command: 'redmine show 5' });
      expect(result.response).toBe('Working on it...\nHere is your answer.');
    });
  });

  describe('handler — reentrancy guard', () => {
    it('should refuse a nested invocation for the same user/room while one is in flight', async () => {
      let nestedResult;
      receiveImpl.mockImplementation(async () => {
        nestedResult = await tool.handler({ command: 'project list' }, mockRobot, mockMsg).catch((e) => e);
      });

      await runHandler({ command: 'project list' });

      expect(nestedResult).toBeInstanceOf(Error);
      expect(nestedResult.message).toMatch(/looped back into this tool/);
    });

    it('should release the lock after completion, allowing a later sequential call', async () => {
      await runHandler({ command: 'project list' });
      await expect(runHandler({ command: 'project list' })).resolves.toBeDefined();
    });

    it('should release the lock even when robot.receive throws', async () => {
      receiveImpl.mockRejectedValueOnce(new Error('boom'));
      await expect(runHandler({ command: 'project list' })).rejects.toThrow('boom');

      receiveImpl.mockResolvedValue(undefined);
      await expect(runHandler({ command: 'project list' })).resolves.toBeDefined();
    });

    it('should not block a truly concurrent invocation for a different user/room', async () => {
      const otherMsg = { message: { user: makeUser({ id: 'U2', name: 'bob', room: 'other-room' }) } };
      receiveImpl.mockImplementation(async (message) => {
        mockRobot.adapter.send({ room: message.user.room }, `response for ${message.user.room}`);
      });

      const promiseA = tool.handler({ command: 'project list' }, mockRobot, mockMsg);
      const promiseB = tool.handler({ command: 'project list' }, mockRobot, otherMsg);
      await vi.runAllTimersAsync();
      const [resultA, resultB] = await Promise.all([promiseA, promiseB]);

      expect(resultA.response).toBe('response for general');
      expect(resultB.response).toBe('response for other-room');
    });
  });

  describe('handler — timeout', () => {
    it('should reject if robot.receive never resolves in time', async () => {
      receiveImpl.mockImplementation(() => new Promise(() => {}));
      await expect(runHandler({ command: 'project list' })).rejects.toThrow('Command timed out');
    });
  });
});
