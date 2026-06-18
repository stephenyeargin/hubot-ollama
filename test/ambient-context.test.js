const nock = require('nock');

const Helper = require('./helpers/hubot-helper');

const helper = new Helper('./../src/hubot-ollama.js');

describe('Ambient Context', () => {
  let room;
  const OLLAMA_HOST = 'http://127.0.0.1:11434';

  beforeEach(async () => {
    process.env.HUBOT_OLLAMA_MODEL = 'llama3.2';
    process.env.HUBOT_OLLAMA_AMBIENT_CONTEXT = 'true';
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
    delete process.env.HUBOT_OLLAMA_AMBIENT_CONTEXT;
    delete process.env.HUBOT_OLLAMA_AMBIENT_CONTEXT_SIZE;
  });

  const mockOllamaChat = (response, captureBody = null) =>
    nock(OLLAMA_HOST)
      .post('/api/chat', (body) => { if (captureBody) captureBody.value = body; return true; })
      .reply(200, { message: { role: 'assistant', content: response }, done: true });

  it('is disabled by default', async () => {
    room.destroy();
    delete process.env.HUBOT_OLLAMA_AMBIENT_CONTEXT;
    room = await helper.createRoom();
    ['debug', 'info', 'warn', 'warning', 'error'].forEach((method) => {
      room.robot.logger[method] = vi.fn();
    });

    const body = {};
    mockOllamaChat('response', body);

    await room.user.say('alice', 'The conference is in Tampa next week.');
    await room.user.say('bob', 'hubot ask what should I pack?');
    await new Promise((resolve) => setTimeout(resolve, 150));

    const ambientMsg = body.value?.messages?.find(
      (m) => m.role === 'system' && m.content?.startsWith('Recent room conversation')
    );
    expect(ambientMsg).toBeUndefined();
  });

  it('captures undirected room messages and injects them as context', async () => {
    const body = {};
    mockOllamaChat('Pack light clothes.', body);

    await room.user.say('alice', 'The conference is in Tampa next week.');
    await room.user.say('alice', 'Hopefully we get some good leads.');
    await room.user.say('bob', 'hubot ask what should I pack?');
    await new Promise((resolve) => setTimeout(resolve, 150));

    const ambientMsg = body.value?.messages?.find(
      (m) => m.role === 'system' && m.content?.startsWith('Recent room conversation')
    );
    expect(ambientMsg).toBeDefined();
    expect(ambientMsg.content).toContain('The conference is in Tampa next week.');
    expect(ambientMsg.content).toContain('Hopefully we get some good leads.');
  });

  it('does not capture bot-addressed messages', async () => {
    const body = {};
    mockOllamaChat('response', body);

    // Only bot-directed message — nothing undirected
    await room.user.say('bob', 'hubot ask what should I pack?');
    await new Promise((resolve) => setTimeout(resolve, 150));

    const ambientMsg = body.value?.messages?.find(
      (m) => m.role === 'system' && m.content?.startsWith('Recent room conversation')
    );
    expect(ambientMsg).toBeUndefined();
  });

  it('does not inject ambient context when buffer is empty', async () => {
    const body = {};
    mockOllamaChat('response', body);

    await room.user.say('bob', 'hubot ask what time is it?');
    await new Promise((resolve) => setTimeout(resolve, 150));

    const ambientMsg = body.value?.messages?.find(
      (m) => m.role === 'system' && m.content?.startsWith('Recent room conversation')
    );
    expect(ambientMsg).toBeUndefined();
  });

  it('respects AMBIENT_CONTEXT_SIZE as a ring buffer', async () => {
    room.destroy();
    process.env.HUBOT_OLLAMA_AMBIENT_CONTEXT_SIZE = '2';
    room = await helper.createRoom();
    ['debug', 'info', 'warn', 'warning', 'error'].forEach((method) => {
      room.robot.logger[method] = vi.fn();
    });

    const body = {};
    mockOllamaChat('response', body);

    await room.user.say('alice', 'message one');
    await room.user.say('alice', 'message two');
    await room.user.say('alice', 'message three');
    await room.user.say('bob', 'hubot ask what did alice say last?');
    await new Promise((resolve) => setTimeout(resolve, 150));

    const ambientMsg = body.value?.messages?.find(
      (m) => m.role === 'system' && m.content?.startsWith('Recent room conversation')
    );
    expect(ambientMsg).toBeDefined();
    expect(ambientMsg.content).not.toContain('message one');
    expect(ambientMsg.content).toContain('message two');
    expect(ambientMsg.content).toContain('message three');
  });

  it('includes the sender name in ambient context', async () => {
    const body = {};
    mockOllamaChat('response', body);

    await room.user.say('alice', 'We ship on Friday.');
    await room.user.say('bob', 'hubot ask when do we ship?');
    await new Promise((resolve) => setTimeout(resolve, 150));

    const ambientMsg = body.value?.messages?.find(
      (m) => m.role === 'system' && m.content?.startsWith('Recent room conversation')
    );
    expect(ambientMsg).toBeDefined();
    expect(ambientMsg.content).toContain('alice: We ship on Friday.');
  });

  describe('with RESPOND_TO_ADDRESSED_FALLBACK enabled', () => {
    let fallbackRoom;

    beforeEach(async () => {
      process.env.HUBOT_OLLAMA_RESPOND_TO_ADDRESSED_FALLBACK = 'true';
      fallbackRoom = await helper.createRoom();
      ['debug', 'info', 'warn', 'warning', 'error'].forEach((method) => {
        fallbackRoom.robot.logger[method] = vi.fn();
      });
    });

    afterEach(() => {
      fallbackRoom.destroy();
      delete process.env.HUBOT_OLLAMA_RESPOND_TO_ADDRESSED_FALLBACK;
    });

    it('does not capture fallback-addressed messages in the ambient buffer', async () => {
      const body = {};
      mockOllamaChat('Sure, here is a joke.', body);

      // This is bot-addressed (fallback) — should NOT enter the ambient buffer
      await fallbackRoom.user.say('alice', 'hubot tell me a joke');
      await new Promise((resolve) => setTimeout(resolve, 150));

      const ambientMsg = body.value?.messages?.find(
        (m) => m.role === 'system' && m.content?.startsWith('Recent room conversation')
      );
      expect(ambientMsg).toBeUndefined();
    });

    it('includes undirected messages in context when fallback mode answers', async () => {
      const body = {};
      // Two undirected messages first, then a fallback-addressed question
      await fallbackRoom.user.say('alice', 'The conference is in Tampa next week.');
      await fallbackRoom.user.say('bob', 'Hopefully we get some good leads.');

      mockOllamaChat('Pack light — Tampa is warm.', body);
      await fallbackRoom.user.say('bob', 'hubot what should I pack?');
      await new Promise((resolve) => setTimeout(resolve, 150));

      const ambientMsg = body.value?.messages?.find(
        (m) => m.role === 'system' && m.content?.startsWith('Recent room conversation')
      );
      expect(ambientMsg).toBeDefined();
      expect(ambientMsg.content).toContain('The conference is in Tampa next week.');
      expect(ambientMsg.content).toContain('Hopefully we get some good leads.');
      // The fallback-addressed message itself must not appear in ambient context
      expect(ambientMsg.content).not.toContain('what should I pack');
    });

    it('fallback still responds correctly when ambient context is enabled', async () => {
      mockOllamaChat('Fallback works fine.');
      await fallbackRoom.user.say('alice', 'hubot explain memoization');
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(fallbackRoom.messages).toEqual([
        ['alice', 'hubot explain memoization'],
        ['hubot', 'Fallback works fine.'],
      ]);
    });
  });

  it('does not capture direct messages', async () => {
    const body = {};
    mockOllamaChat('response', body);

    const { createMockTextMessage } = require('./helpers/mock-message');
    const dmMessage = createMockTextMessage('secret plans', {
      userName: 'alice',
      privateMessage: true
    });
    await room.receive('alice', dmMessage);

    await room.user.say('bob', 'hubot ask what are the plans?');
    await new Promise((resolve) => setTimeout(resolve, 150));

    const ambientMsg = body.value?.messages?.find(
      (m) => m.role === 'system' && m.content?.startsWith('Recent room conversation')
    );
    expect(ambientMsg).toBeUndefined();
  });
});
