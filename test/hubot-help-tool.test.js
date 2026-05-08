const createHubotHelpTool = require('../src/tools/hubot-help-tool');

describe('hubot-help-tool', () => {
  let tool;
  let mockRobot;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn()
    };
    tool = createHubotHelpTool(null, {}, mockLogger);

    mockRobot = {
      name: 'hubot',
      alias: null,
      helpCommands: vi.fn().mockReturnValue([
        'hubot ping - Replies with pong',
        'hubot echo <text> - Echoes back the supplied text',
        'hubot help - Displays all of the help commands that this bot knows about',
        'hubot help <query> - Displays all help commands that match <query>',
        'hubot image me <query> - Search for a random image'
      ])
    };
  });

  describe('tool definition', () => {
    it('should have the correct name', () => {
      expect(tool.name).toBe('hubot_ollama_help');
    });

    it('should have a descriptive description mentioning mistyped commands', () => {
      expect(tool.description).toBeTruthy();
      expect(tool.description.toLowerCase()).toMatch(/command/);
    });

    it('should have a handler function', () => {
      expect(typeof tool.handler).toBe('function');
    });

    it('should have a parameters object with optional query property', () => {
      expect(tool.parameters).toBeTruthy();
      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.properties).toHaveProperty('query');
      expect(tool.parameters.required).toEqual([]);
    });
  });

  describe('handler — no query', () => {
    it('should return all commands sorted when no query is given', async () => {
      const result = await tool.handler({}, mockRobot);

      expect(result).toHaveProperty('commands');
      expect(Array.isArray(result.commands)).toBe(true);
      expect(result.commands.length).toBe(5);

      // Should be sorted
      const sorted = [...result.commands].sort();
      expect(result.commands).toEqual(sorted);
    });

    it('should return all commands when query is undefined', async () => {
      const result = await tool.handler({ query: undefined }, mockRobot);
      expect(result.commands.length).toBe(5);
    });

    it('should return all commands when query is an empty string', async () => {
      const result = await tool.handler({ query: '' }, mockRobot);
      expect(result.commands.length).toBe(5);
    });

    it('should return all commands when args is empty object', async () => {
      const result = await tool.handler({}, mockRobot);
      expect(result.commands.length).toBe(5);
    });
  });

  describe('handler — with query', () => {
    it('should filter commands by query substring (case-insensitive)', async () => {
      const result = await tool.handler({ query: 'ping' }, mockRobot);

      expect(result).toHaveProperty('commands');
      expect(result.commands.length).toBe(1);
      expect(result.commands[0]).toMatch(/ping/i);
    });

    it('should match query case-insensitively', async () => {
      const resultLower = await tool.handler({ query: 'echo' }, mockRobot);
      const resultUpper = await tool.handler({ query: 'ECHO' }, mockRobot);

      expect(resultLower.commands.length).toBeGreaterThan(0);
      expect(resultUpper.commands).toEqual(resultLower.commands);
    });

    it('should return multiple matches when query is broad', async () => {
      const result = await tool.handler({ query: 'help' }, mockRobot);

      expect(result.commands.length).toBe(2);
      result.commands.forEach((cmd) => expect(cmd.toLowerCase()).toContain('help'));
    });

    it('should return empty commands and a message when no match found', async () => {
      const result = await tool.handler({ query: 'xyznotacommand' }, mockRobot);

      expect(result.commands).toEqual([]);
      expect(result.message).toMatch(/xyznotacommand/);
    });

    it('should trim whitespace from query before matching', async () => {
      const result = await tool.handler({ query: '  ping  ' }, mockRobot);
      expect(result.commands.length).toBe(1);
    });
  });

  describe('handler — robot name substitution', () => {
    it('should replace "hubot" prefix with the robot name', async () => {
      mockRobot.name = 'mybot';
      const result = await tool.handler({}, mockRobot);

      result.commands.forEach((cmd) => {
        expect(cmd.startsWith('mybot')).toBe(true);
      });
    });

    it('should prefer robot alias over robot name when alias is set', async () => {
      mockRobot.alias = '!';
      const result = await tool.handler({}, mockRobot);

      // Single-char alias replaces "hubot " (with trailing space)
      result.commands.forEach((cmd) => {
        expect(cmd.startsWith('!')).toBe(true);
      });
    });

    it('should use robot.name when alias is null', async () => {
      mockRobot.alias = null;
      mockRobot.name = 'hal';
      const result = await tool.handler({}, mockRobot);

      result.commands.forEach((cmd) => {
        expect(cmd.startsWith('hal')).toBe(true);
      });
    });
  });

  describe('handler — logging', () => {
    it('should call logger.debug when returning all commands (no query)', async () => {
      await tool.handler({}, mockRobot);
      expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringMatching(/returning all \d+ commands/));
    });

    it('should call logger.debug and logger.info when filtering by query', async () => {
      await tool.handler({ query: 'ping' }, mockRobot);
      expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringMatching(/filtering \d+ commands by query/));
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/\d+ command\(s\) matched query/));
    });

    it('should not throw when logger is null', async () => {
      const toolNoLogger = createHubotHelpTool(null, {}, null);
      await expect(toolNoLogger.handler({ query: 'ping' }, mockRobot)).resolves.toHaveProperty('commands');
    });
  });

  describe('handler — error cases', () => {
    it('should throw when robot is undefined', async () => {
      await expect(tool.handler({}, undefined)).rejects.toThrow('robot.helpCommands is not available');
    });

    it('should throw when robot has no helpCommands function', async () => {
      await expect(tool.handler({}, { name: 'hubot' })).rejects.toThrow('robot.helpCommands is not available');
    });

    it('should handle an empty helpCommands result gracefully', async () => {
      mockRobot.helpCommands.mockReturnValue([]);
      const result = await tool.handler({}, mockRobot);
      expect(result.commands).toEqual([]);
    });
  });
});
