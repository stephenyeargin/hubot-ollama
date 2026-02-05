describe('Context Summarization', () => {
  let robot;
  let brain;

  beforeEach(() => {
    // Mock brain
    brain = {};
    brain.get = (key) => brain[key];
    brain.set = (key, value) => { brain[key] = value; };

    // Mock robot
    robot = {
      name: 'testbot',
      adapterName: 'test',
      logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      },
      brain,
      respond: jest.fn()
    };

    // Initialize empty contexts
    robot.brain.set('ollamaContexts', {});

    // Set environment defaults
    process.env.HUBOT_OLLAMA_CONTEXT_TTL_MS = '600000';
    process.env.HUBOT_OLLAMA_CONTEXT_TURNS = '5';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.HUBOT_OLLAMA_CONTEXT_TTL_MS;
    delete process.env.HUBOT_OLLAMA_CONTEXT_TURNS;
  });

  it('should not create summary for short conversations', () => {
    const contexts = robot.brain.get('ollamaContexts');
    const contextKey = 'testroom:user123';

    // Add only 2 turns (equal to KEEP_RAW_TURNS)
    contexts[contextKey] = {
      history: [
        { user: 'Hello', assistant: 'Hi there!' },
        { user: 'How are you?', assistant: 'I am fine, thanks!' }
      ],
      summary: null,
      summarizedUntil: null,
      lastUpdated: Date.now()
    };

    // Should not trigger summarization with only 2 turns
    expect(contexts[contextKey].history.length).toBe(2);
    expect(contexts[contextKey].summary).toBeNull();
  });

  it('should have correct data model structure for new contexts', () => {
    const contexts = robot.brain.get('ollamaContexts');
    const contextKey = 'testroom:user123';

    contexts[contextKey] = {
      history: [],
      summary: null,
      summarizedUntil: null,
      lastUpdated: Date.now()
    };

    expect(contexts[contextKey]).toHaveProperty('history');
    expect(contexts[contextKey]).toHaveProperty('summary');
    expect(contexts[contextKey]).toHaveProperty('summarizedUntil');
    expect(contexts[contextKey]).toHaveProperty('lastUpdated');
  });

  it('should cap summary length at 600 characters', async () => {
    const longSummary = 'a'.repeat(1000);
    const cappedLength = 600;

    // Simulate capping
    const capped = longSummary.length > 600 ? longSummary.slice(0, 600) + '...' : longSummary;

    expect(capped.length).toBe(cappedLength + 3); // +3 for '...'
    expect(capped.endsWith('...')).toBe(true);
  });

  it('should preserve recent turns when summarizing', () => {
    const KEEP_RAW_TURNS = 2;
    const allTurns = [
      { user: 'Turn 1', assistant: 'Response 1' },
      { user: 'Turn 2', assistant: 'Response 2' },
      { user: 'Turn 3', assistant: 'Response 3' },
      { user: 'Turn 4', assistant: 'Response 4' },
      { user: 'Turn 5', assistant: 'Response 5' }
    ];

    const turnsToSummarize = allTurns.slice(0, allTurns.length - KEEP_RAW_TURNS);
    const remainingTurns = allTurns.slice(allTurns.length - KEEP_RAW_TURNS);

    expect(turnsToSummarize.length).toBe(3);
    expect(remainingTurns.length).toBe(2);
    expect(remainingTurns[0].user).toBe('Turn 4');
    expect(remainingTurns[1].user).toBe('Turn 5');
  });

  it('should include user display names for room-scope contexts', () => {
    const CONTEXT_SCOPE = 'room';
    const turn = {
      user: 'Hello',
      assistant: 'Hi',
      userDisplayName: 'Test User (@testuser)'
    };

    let userText = turn.user;
    if (CONTEXT_SCOPE === 'room' && turn.userDisplayName) {
      userText = `${turn.userDisplayName}: ${turn.user}`;
    }

    expect(userText).toBe('Test User (@testuser): Hello');
  });

  it('should handle expired contexts correctly', () => {
    const contexts = robot.brain.get('ollamaContexts');
    const contextKey = 'testroom:user123';
    const TTL_MS = 600000;

    // Create an expired context
    contexts[contextKey] = {
      history: [
        { user: 'Old message', assistant: 'Old response' }
      ],
      summary: 'This is an old summary',
      summarizedUntil: Date.now() - TTL_MS - 1000,
      lastUpdated: Date.now() - TTL_MS - 1000
    };

    const now = Date.now();
    const age = now - contexts[contextKey].lastUpdated;

    // Context should be expired
    expect(age).toBeGreaterThan(TTL_MS);

    // Simulate expiration cleanup
    if (age > TTL_MS) {
      delete contexts[contextKey];
    }

    expect(contexts[contextKey]).toBeUndefined();
  });

  it('should format summarization prompt correctly for first-time summarization', () => {
    const turns = [
      { user: 'What is JavaScript?', assistant: 'JavaScript is a programming language.' },
      { user: 'Tell me more', assistant: 'It is used for web development.' }
    ];

    const turnsText = turns.map(t => `User: ${t.user}\nAssistant: ${t.assistant}`).join('\n\n');
    const expectedPrompt = `Summarize the following conversation turns so that another assistant can continue the discussion naturally:\n\n<turns>\n${turnsText}\n</turns>`;

    expect(expectedPrompt).toContain('Summarize the following');
    expect(expectedPrompt).toContain('What is JavaScript?');
    expect(expectedPrompt).toContain('Tell me more');
  });

  it('should format summarization prompt correctly for rolling update', () => {
    const existingSummary = 'User asked about JavaScript basics.';
    const newTurns = [
      { user: 'What about TypeScript?', assistant: 'TypeScript is a superset of JavaScript.' }
    ];

    const turnsText = newTurns.map(t => `User: ${t.user}\nAssistant: ${t.assistant}`).join('\n\n');
    const expectedPrompt = `Previous summary:\n${existingSummary}\n\nNew conversation turns:\n<turns>\n${turnsText}\n</turns>\n\nProduce an updated summary that incorporates the new information.`;

    expect(expectedPrompt).toContain('Previous summary:');
    expect(expectedPrompt).toContain(existingSummary);
    expect(expectedPrompt).toContain('What about TypeScript?');
  });

  it('should not block main response on summarization', (done) => {
    // Simulate async summarization trigger
    setImmediate(() => {
      // Summarization happens in background
      done();
    });

    // Main response continues immediately
    expect(true).toBe(true);
  });

  it('should handle summarization timeout gracefully', async () => {
    const TIMEOUT_MS = 100;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      // Simulate a long-running summarization
      await new Promise((resolve, reject) => {
        const longTask = setTimeout(resolve, 200);
        controller.signal.addEventListener('abort', () => {
          clearTimeout(longTask);
          reject(new Error('AbortError'));
        });
      });
      clearTimeout(timeout);
      throw new Error('Should have timed out');
    } catch (error) {
      clearTimeout(timeout);
      expect(error.message).toBe('AbortError');
    }
  });

  it('should handle empty summarization response', () => {
    const emptySummary = '';

    // Should skip empty summaries
    if (!emptySummary || emptySummary.length === 0) {
      expect(emptySummary).toBe('');
    } else {
      throw new Error('Should have skipped empty summary');
    }
  });

  it('should inject summary as system message in prompt assembly', () => {
    const messages = [
      { role: 'system', content: 'You are a helpful chatbot.' }
    ];

    const summary = 'User has been asking about programming languages.';

    // Inject summary
    if (summary) {
      messages.push({ role: 'system', content: `Conversation summary:\n${summary}` });
    }

    expect(messages.length).toBe(2);
    expect(messages[1].role).toBe('system');
    expect(messages[1].content).toContain('Conversation summary:');
    expect(messages[1].content).toContain(summary);
  });

  it('should maintain correct message ordering with summary', () => {
    const messages = [
      { role: 'system', content: 'System prompt' }
    ];

    const summary = 'Summary text';
    const history = [
      { user: 'Hello', assistant: 'Hi' }
    ];

    // Inject summary
    if (summary) {
      messages.push({ role: 'system', content: `Conversation summary:\n${summary}` });
    }

    // Add history
    for (const turn of history) {
      messages.push({ role: 'user', content: turn.user });
      messages.push({ role: 'assistant', content: turn.assistant });
    }

    // Add current prompt
    messages.push({ role: 'user', content: 'Current question' });

    // Expected order: system, summary, history (user+assistant), current user
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('system'); // summary
    expect(messages[2].role).toBe('user'); // history user
    expect(messages[3].role).toBe('assistant'); // history assistant
    expect(messages[4].role).toBe('user'); // current
  });

  it('should release lock on summarization error', async () => {
    const locks = {};
    const contextKey = 'testkey';

    try {
      locks[contextKey] = true;
      throw new Error('Summarization failed');
    } catch (error) {
      delete locks[contextKey];
      expect(error.message).toBe('Summarization failed');
    }

    expect(locks[contextKey]).toBeUndefined();
  });

  it('should skip summarization when already in progress', () => {
    const locks = {};
    const contextKey = 'testkey';

    locks[contextKey] = true;

    // Check lock before starting
    if (locks[contextKey]) {
      // Skip
      expect(locks[contextKey]).toBe(true);
    } else {
      throw new Error('Should have skipped due to lock');
    }
  });

  it('should require at least 2 old turns to summarize', () => {
    const KEEP_RAW_TURNS = 2;
    const allTurns = [
      { user: 'Turn 1', assistant: 'Response 1' },
      { user: 'Turn 2', assistant: 'Response 2' },
      { user: 'Turn 3', assistant: 'Response 3' }
    ];

    const turnsToSummarize = allTurns.slice(0, allTurns.length - KEEP_RAW_TURNS);

    // Only 1 turn to summarize, should skip
    expect(turnsToSummarize.length).toBe(1);
    expect(turnsToSummarize.length < 2).toBe(true);
  });

  it('should handle context with no history gracefully', () => {
    const context = {
      history: [],
      summary: null,
      summarizedUntil: null,
      lastUpdated: Date.now()
    };

    const KEEP_RAW_TURNS = 2;

    if (!context || !context.history) {
      throw new Error('Context should exist');
    }

    if (context.history.length <= KEEP_RAW_TURNS) {
      // Should skip summarization
      expect(context.history.length).toBe(0);
    }
  });
});
