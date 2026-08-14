const nock = require('nock');

const Helper = require('./helpers/hubot-helper');

const helper = new Helper('./../src/hubot-ollama.js');

describe('Context Summarization', () => {
  let room = null;
  const OLLAMA_HOST = 'http://127.0.0.1:11434';

  beforeEach(async () => {
    process.env.HUBOT_OLLAMA_MODEL = 'llama3.2';
    process.env.HUBOT_OLLAMA_CONTEXT_TTL_MS = '600000';
    process.env.HUBOT_OLLAMA_CONTEXT_TURNS = '5';
    room = await helper.createRoom();
    ['debug', 'info', 'warn', 'warning', 'error'].forEach((method) => {
      room.robot.logger[method] = vi.fn();
    });
    nock.cleanAll();
  });

  afterEach(() => {
    room.destroy();
    nock.cleanAll();
    delete process.env.HUBOT_OLLAMA_MODEL;
    delete process.env.HUBOT_OLLAMA_CONTEXT_TTL_MS;
    delete process.env.HUBOT_OLLAMA_CONTEXT_TURNS;
    delete process.env.HUBOT_OLLAMA_TIMEOUT_MS;
  });

  // Regular (non-summarization) chat replies use the default system prompt;
  // summarization calls use a distinct one, so this tells them apart without
  // relying on call ordering.
  const mockAsk = (reply) => nock(OLLAMA_HOST)
    .post('/api/chat', (body) => !/summarizing a chat conversation/.test(body.messages[0]?.content || ''))
    .reply(200, { message: { role: 'assistant', content: reply }, done: true });

  const mockSummarization = (options = {}) => {
    const interceptor = nock(OLLAMA_HOST)
      .post('/api/chat', (body) => /summarizing a chat conversation/.test(body.messages[0]?.content || ''));
    if (options.delayMs) interceptor.delayConnection(options.delayMs);
    if (options.error) {
      return interceptor.replyWithError(options.error);
    }
    return interceptor.reply(200, { message: { role: 'assistant', content: options.content ?? 'Summary of the conversation.' }, done: true });
  };

  const getContext = () => {
    const contexts = room.robot.brain.get('ollamaContexts');
    return Object.values(contexts || {})[0];
  };

  // Drives 4 sequential asks from the same user, which is enough turns
  // (CONTEXT_TURNS default 5, KEEP_RAW_TURNS hardcoded at 2) to make the 4th
  // turn's storeConversationTurn() schedule a real summarizeContext() call.
  const drive4Turns = async () => {
    for (let i = 1; i <= 4; i++) {
      mockAsk(`Reply ${i}`);
      room.user.say('alice', `hubot ask question ${i}`);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  };

  it('summarizes older turns and keeps only the most recent 2 raw', async () => {
    mockSummarization({ content: 'Alice discussed questions 1-2.' });

    await drive4Turns();
    // Summarization is triggered via setImmediate + a real HTTP call; give it
    // room to complete beyond the per-turn wait already done in drive4Turns.
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(nock.isDone()).toBe(true);
    const context = getContext();
    expect(context.summary).toBe('Alice discussed questions 1-2.');
    expect(context.history).toHaveLength(2);
    expect(context.history[0].user).toBe('question 3');
    expect(context.history[1].user).toBe('question 4');
    expect(context.summarizedUntil).toBeGreaterThan(0);
  });

  it('includes the previous summary in the prompt on a rolling update', async () => {
    mockSummarization({ content: 'First summary.' });
    await drive4Turns();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(getContext().summary).toBe('First summary.');

    // Two more turns bring history back to 4 (2 kept raw + 2 new), enough to
    // trigger a second, rolling summarization pass.
    let rollingRequestBody = null;
    const rollingScope = nock(OLLAMA_HOST)
      .post('/api/chat', (body) => {
        const isSummarization = /summarizing a chat conversation/.test(body.messages[0]?.content || '');
        if (isSummarization) rollingRequestBody = body;
        return isSummarization;
      })
      .reply(200, { message: { role: 'assistant', content: 'Updated summary.' }, done: true });

    for (let i = 5; i <= 6; i++) {
      mockAsk(`Reply ${i}`);
      room.user.say('alice', `hubot ask question ${i}`);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(rollingScope.isDone()).toBe(true);
    expect(rollingRequestBody.messages[1].content).toContain('Previous summary:');
    expect(rollingRequestBody.messages[1].content).toContain('First summary.');
    expect(getContext().summary).toBe('Updated summary.');
  });

  it('leaves history untouched when the summarization call times out', async () => {
    room.destroy();
    process.env.HUBOT_OLLAMA_TIMEOUT_MS = '50';
    room = await helper.createRoom();
    ['debug', 'info', 'warn', 'warning', 'error'].forEach((method) => {
      room.robot.logger[method] = vi.fn();
    });

    // Regular ask replies resolve immediately so the short timeout never
    // affects them — only the summarization call is deliberately slow.
    mockSummarization({ content: 'Should not be used.', delayMs: 200 });

    await drive4Turns();
    await new Promise((resolve) => setTimeout(resolve, 200));

    const context = getContext();
    expect(context.summary).toBeNull();
    expect(context.history).toHaveLength(4);
    expect(room.robot.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Summarization timed out'));
  });

  it('leaves history untouched when the summarization response is empty', async () => {
    mockSummarization({ content: '' });

    await drive4Turns();
    await new Promise((resolve) => setTimeout(resolve, 150));

    const context = getContext();
    expect(context.summary).toBeNull();
    expect(context.history).toHaveLength(4);
    expect(room.robot.logger.warn).toHaveBeenCalledWith(expect.stringContaining('empty content'));
  });

  it('caps an overly long summary at 600 characters', async () => {
    mockSummarization({ content: 'a'.repeat(1000) });

    await drive4Turns();
    await new Promise((resolve) => setTimeout(resolve, 150));

    const context = getContext();
    expect(context.summary).toHaveLength(603);
    expect(context.summary.endsWith('...')).toBe(true);
  });

  it('does not clobber a concurrent write to a different context made during summarization', async () => {
    mockSummarization({ content: 'Alice summary.', delayMs: 100 });

    // Get alice to 4 turns (triggers a slow summarization call) without
    // waiting for it to finish, then have a different user (different
    // room-user context key) write a turn while it's still in flight.
    for (let i = 1; i <= 4; i++) {
      mockAsk(`Reply ${i}`);
      room.user.say('alice', `hubot ask question ${i}`);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    mockAsk('Bob reply');
    room.user.say('bob', 'hubot ask bob question');
    await new Promise((resolve) => setTimeout(resolve, 250));

    const contexts = room.robot.brain.get('ollamaContexts');
    const aliceContext = Object.values(contexts).find((c) => c.summary);
    const bobContext = Object.values(contexts).find((c) => !c.summary);

    expect(aliceContext.summary).toBe('Alice summary.');
    expect(bobContext).toBeDefined();
    expect(bobContext.history.some((t) => t.user === 'bob question')).toBe(true);
  });

  it('does not run a second summarization while one is already in progress for the same context', async () => {
    const scope = mockSummarization({ content: 'Only once.', delayMs: 150 });

    for (let i = 1; i <= 3; i++) {
      mockAsk(`Reply ${i}`);
      room.user.say('alice', `hubot ask question ${i}`);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    // Fire the 4th and 5th turns back-to-back (both replies resolve fast, with
    // no delay), so the 5th turn's storeConversationTurn() runs its lock check
    // while the 4th turn's summarizeContext() is still awaiting its
    // deliberately slow (150ms) summarization response.
    mockAsk('Reply 4');
    room.user.say('alice', 'hubot ask question 4');
    await new Promise((resolve) => setTimeout(resolve, 40));

    mockAsk('Reply 5');
    room.user.say('alice', 'hubot ask question 5');
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Exactly one summarization HTTP call was made — the 5th turn's
    // storeConversationTurn() saw the lock already held (by the 4th turn's
    // in-flight summarizeContext()) and skipped scheduling its own call
    // entirely, rather than the two racing.
    expect(scope.isDone()).toBe(true);
    const context = getContext();
    expect(context.summary).toBe('Only once.');
  });
});
