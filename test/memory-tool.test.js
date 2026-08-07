const memoryTool = require('../src/tools/memory-tool');

describe('memory-tool', () => {
  const logger = { debug: vi.fn(), error: vi.fn(), warn: vi.fn() };

  const makeRobot = () => {
    const store = {};
    return {
      brain: {
        get: vi.fn((key) => store[key]),
        set: vi.fn((key, value) => { store[key] = value; })
      }
    };
  };

  const makeConfig = (overrides = {}) => ({
    getContextKey: () => 'room1:user1',
    ...overrides
  });

  const msg = { message: { room: 'room1', user: { id: 'user1' } } };

  test('tool definition includes required properties', () => {
    const tool = memoryTool(null, makeConfig(), logger);

    expect(tool.name).toBe('hubot_ollama_memory');
    expect(tool.description).toBeTruthy();
    expect(typeof tool.handler).toBe('function');
    expect(tool.parameters.action).toBeTruthy();
  });

  test('save then recall round-trip', async () => {
    const robot = makeRobot();
    const tool = memoryTool(null, makeConfig(), logger);

    const saveResult = await tool.handler(
      { action: 'save', key: 'fav-color', summary: 'Favorite color', content: 'Teal' },
      robot, msg
    );
    expect(saveResult).toEqual({ saved: true, key: 'fav-color', summaryChars: 14, contentChars: 4, truncated: false });

    const recallResult = await tool.handler({ action: 'recall', key: 'fav-color' }, robot, msg);
    expect(recallResult).toMatchObject({ key: 'fav-color', summary: 'Favorite color', content: 'Teal' });
  });

  test('save defaults summary to content when omitted', async () => {
    const robot = makeRobot();
    const tool = memoryTool(null, makeConfig(), logger);

    await tool.handler({ action: 'save', key: 'note', content: 'Some note content' }, robot, msg);
    const recallResult = await tool.handler({ action: 'recall', key: 'note' }, robot, msg);

    expect(recallResult.summary).toBe('Some note content');
  });

  test('save requires key', async () => {
    const robot = makeRobot();
    const tool = memoryTool(null, makeConfig(), logger);

    const result = await tool.handler({ action: 'save', content: 'content' }, robot, msg);
    expect(result).toHaveProperty('error');
  });

  test('save requires content', async () => {
    const robot = makeRobot();
    const tool = memoryTool(null, makeConfig(), logger);

    const result = await tool.handler({ action: 'save', key: 'k' }, robot, msg);
    expect(result.error).toContain('Content is required');
  });

  test('recall on missing key returns error', async () => {
    const robot = makeRobot();
    const tool = memoryTool(null, makeConfig(), logger);

    const result = await tool.handler({ action: 'recall', key: 'nope' }, robot, msg);
    expect(result.error).toContain('No memory found');
  });

  test('delete on missing key returns error', async () => {
    const robot = makeRobot();
    const tool = memoryTool(null, makeConfig(), logger);

    const result = await tool.handler({ action: 'delete', key: 'nope' }, robot, msg);
    expect(result.error).toContain('No memory found');
  });

  test('delete removes an existing key', async () => {
    const robot = makeRobot();
    const tool = memoryTool(null, makeConfig(), logger);

    await tool.handler({ action: 'save', key: 'k', content: 'v' }, robot, msg);
    const deleteResult = await tool.handler({ action: 'delete', key: 'k' }, robot, msg);
    expect(deleteResult).toEqual({ deleted: true, key: 'k' });

    const recallResult = await tool.handler({ action: 'recall', key: 'k' }, robot, msg);
    expect(recallResult).toHaveProperty('error');
  });

  test('list returns summaries only, sorted by updatedAt desc, no content', async () => {
    const robot = makeRobot();
    const tool = memoryTool(null, makeConfig(), logger);

    await tool.handler({ action: 'save', key: 'first', summary: 'First', content: 'a' }, robot, msg);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await tool.handler({ action: 'save', key: 'second', summary: 'Second', content: 'b' }, robot, msg);

    const listResult = await tool.handler({ action: 'list' }, robot, msg);
    expect(listResult.entries).toHaveLength(2);
    expect(listResult.entries[0].key).toBe('second');
    expect(listResult.entries[0]).not.toHaveProperty('content');
  });

  test('truncates content longer than MAX_CONTENT_CHARS', async () => {
    const robot = makeRobot();
    const tool = memoryTool(null, makeConfig({ MAX_CONTENT_CHARS: 10 }), logger);

    const result = await tool.handler({ action: 'save', key: 'k', content: 'a'.repeat(20) }, robot, msg);
    expect(result.truncated).toBe(true);
    expect(result.contentChars).toBe(10);

    const recallResult = await tool.handler({ action: 'recall', key: 'k' }, robot, msg);
    expect(recallResult.content).toBe('a'.repeat(10));
  });

  test('invalid action returns error', async () => {
    const robot = makeRobot();
    const tool = memoryTool(null, makeConfig(), logger);

    const result = await tool.handler({ action: 'destroy' }, robot, msg);
    expect(result.error).toContain('Invalid action');
  });

  test('rejects content that looks like a secret', async () => {
    const robot = makeRobot();
    const tool = memoryTool(null, makeConfig(), logger);

    const result = await tool.handler(
      { action: 'save', key: 'k', content: 'password: hunter2' },
      robot, msg
    );
    expect(result.error).toContain('secret or credential');

    const listResult = await tool.handler({ action: 'list' }, robot, msg);
    expect(listResult.entries).toHaveLength(0);
  });

  test('rejects an API-key-shaped token', async () => {
    const robot = makeRobot();
    const tool = memoryTool(null, makeConfig(), logger);

    const result = await tool.handler(
      { action: 'save', key: 'k', content: `Use token sk-${'a'.repeat(30)}` },
      robot, msg
    );
    expect(result.error).toContain('secret or credential');
  });

  test('does not false-positive on ordinary prose mentioning "password"', async () => {
    const robot = makeRobot();
    const tool = memoryTool(null, makeConfig(), logger);

    const result = await tool.handler(
      { action: 'save', key: 'k', content: 'The user forgot their password and needs a reset link.' },
      robot, msg
    );
    expect(result).toHaveProperty('saved', true);
  });

  test('scope isolation: entries in one context are not visible in another', async () => {
    const robot = makeRobot();
    let currentScope = 'room1:user1';
    const tool = memoryTool(null, makeConfig({ getContextKey: () => currentScope }), logger);

    await tool.handler({ action: 'save', key: 'k', content: 'scope1 value' }, robot, msg);

    currentScope = 'room2:user2';
    const listResult = await tool.handler({ action: 'list' }, robot, msg);
    expect(listResult.entries).toHaveLength(0);

    const recallResult = await tool.handler({ action: 'recall', key: 'k' }, robot, msg);
    expect(recallResult).toHaveProperty('error');
  });

  test('evicts least-recently-accessed entry when scope is at capacity', async () => {
    const robot = makeRobot();
    const tool = memoryTool(null, makeConfig({ MAX_ENTRIES: 2 }), logger);

    await tool.handler({ action: 'save', key: 'a', content: 'A' }, robot, msg);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await tool.handler({ action: 'save', key: 'b', content: 'B' }, robot, msg);

    // Refresh "a"'s lastAccessedAt so "b" becomes the least-recently-accessed entry
    await new Promise((resolve) => setTimeout(resolve, 2));
    await tool.handler({ action: 'recall', key: 'a' }, robot, msg);

    // Saving a new entry should evict "b", not "a"
    await new Promise((resolve) => setTimeout(resolve, 2));
    await tool.handler({ action: 'save', key: 'c', content: 'C' }, robot, msg);

    const listResult = await tool.handler({ action: 'list' }, robot, msg);
    const keys = listResult.entries.map((e) => e.key).sort();
    expect(keys).toEqual(['a', 'c']);
  });

  describe('unresolvable context refusal', () => {
    test('refuses when msg has no room', async () => {
      const robot = makeRobot();
      const tool = memoryTool(null, makeConfig(), logger);
      const badMsg = { message: { user: { id: 'user1' } } };

      const result = await tool.handler({ action: 'save', key: 'k', content: 'v' }, robot, badMsg);
      expect(result.error).toContain('Unable to resolve');
      expect(robot.brain.set).not.toHaveBeenCalled();
    });

    test('refuses when msg has no user', async () => {
      const robot = makeRobot();
      const tool = memoryTool(null, makeConfig(), logger);
      const badMsg = { message: { room: 'room1' } };

      const result = await tool.handler({ action: 'list' }, robot, badMsg);
      expect(result.error).toContain('Unable to resolve');
    });

    test('refuses when msg is missing entirely', async () => {
      const robot = makeRobot();
      const tool = memoryTool(null, makeConfig(), logger);

      const result = await tool.handler({ action: 'list' }, robot, {});
      expect(result.error).toContain('Unable to resolve');
    });
  });

  describe('broadened secret guardrail', () => {
    test('rejects a snake_case labeled token (e.g. AUTH_TOKEN=...)', async () => {
      const robot = makeRobot();
      const tool = memoryTool(null, makeConfig(), logger);

      const result = await tool.handler(
        { action: 'save', key: 'k', content: 'AUTH_TOKEN=abc123xyz' },
        robot, msg
      );
      expect(result.error).toContain('secret or credential');
    });

    test('rejects a *_KEY labeled field (e.g. SECRET_KEY=...)', async () => {
      const robot = makeRobot();
      const tool = memoryTool(null, makeConfig(), logger);

      const result = await tool.handler(
        { action: 'save', key: 'k', content: 'SECRET_KEY=abc123xyz' },
        robot, msg
      );
      expect(result.error).toContain('secret or credential');
    });

    test('rejects a JSON-quoted credential field', async () => {
      const robot = makeRobot();
      const tool = memoryTool(null, makeConfig(), logger);

      const result = await tool.handler(
        { action: 'save', key: 'k', content: '{"apiToken":"xyz123abc456"}' },
        robot, msg
      );
      expect(result.error).toContain('secret or credential');
    });
  });
});
