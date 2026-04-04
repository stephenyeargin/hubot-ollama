const path = require('path');

const Helper = require('hubot-test-helper');

// Mock Ollama with scripted responses to test intermediate thinking content
jest.mock('ollama', () => {
  let scriptedResponses = [];
  let callIndex = 0;

  class MockOllama {
    constructor() {}
    async show() {
      return { capabilities: ['tools', 'completion'] };
    }
    async chat() {
      const response = scriptedResponses[callIndex] || { message: { role: 'assistant', content: '' } };
      callIndex++;
      return response;
    }
  }

  MockOllama.__setResponses = (responses) => {
    scriptedResponses = responses;
    callIndex = 0;
  };

  return { Ollama: MockOllama };
});

const helper = new Helper(path.join(__dirname, '..', 'src', 'hubot-ollama.js'));

describe('hubot-ollama intermediate thinking responses', () => {
  let room;

  beforeEach(() => {
    process.env.HUBOT_OLLAMA_TOOLS_ENABLED = 'true';
    room = helper.createRoom();
    ['debug', 'info', 'warn', 'warning', 'error'].forEach((method) => {
      room.robot.logger[method] = jest.fn();
    });
  });

  afterEach(() => {
    room.destroy();
    delete process.env.HUBOT_OLLAMA_TOOLS_ENABLED;
    const MockOllama = require('ollama').Ollama;
    MockOllama.__setResponses([]);
  });

  it('sends intermediate thinking content before the final answer', async () => {
    const MockOllama = require('ollama').Ollama;
    MockOllama.__setResponses([
      // Phase 1: model emits content alongside a tool call
      {
        message: {
          role: 'assistant',
          content: 'Let me check the current time for you.',
          tool_calls: [{ function: { name: 'hubot_ollama_get_current_time', arguments: {} } }]
        }
      },
      // Phase 3: final answer after tool execution
      {
        message: {
          role: 'assistant',
          content: 'The current time is 12:00 UTC.'
        }
      }
    ]);

    await room.user.say('alice', 'hubot ask what time is it?');
    await new Promise((resolve) => setTimeout(resolve, 250));

    const botMessages = room.messages.filter(m => m[0] === 'hubot').map(m => m[1]);
    expect(botMessages).toEqual([
      'Let me check the current time for you.',
      'The current time is 12:00 UTC.'
    ]);
  });

  it('does not emit a thinking message when model content is empty', async () => {
    const MockOllama = require('ollama').Ollama;
    MockOllama.__setResponses([
      // Phase 1: tool call with no content
      {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'hubot_ollama_get_current_time', arguments: {} } }]
        }
      },
      // Phase 3: final answer
      {
        message: {
          role: 'assistant',
          content: 'The current time is 12:00 UTC.'
        }
      }
    ]);

    await room.user.say('alice', 'hubot ask what time is it?');
    await new Promise((resolve) => setTimeout(resolve, 250));

    const botMessages = room.messages.filter(m => m[0] === 'hubot').map(m => m[1]);
    expect(botMessages).toEqual(['The current time is 12:00 UTC.']);
  });

  it('does not emit a thinking message when model content is whitespace only', async () => {
    const MockOllama = require('ollama').Ollama;
    MockOllama.__setResponses([
      {
        message: {
          role: 'assistant',
          content: '   ',
          tool_calls: [{ function: { name: 'hubot_ollama_get_current_time', arguments: {} } }]
        }
      },
      {
        message: {
          role: 'assistant',
          content: 'The current time is 12:00 UTC.'
        }
      }
    ]);

    await room.user.say('alice', 'hubot ask what time is it?');
    await new Promise((resolve) => setTimeout(resolve, 250));

    const botMessages = room.messages.filter(m => m[0] === 'hubot').map(m => m[1]);
    expect(botMessages).toEqual(['The current time is 12:00 UTC.']);
  });

  it('emits thinking content for chained tool calls', async () => {
    const MockOllama = require('ollama').Ollama;
    MockOllama.__setResponses([
      // Phase 1: first tool call with thinking content
      {
        message: {
          role: 'assistant',
          content: 'I will check the time first.',
          tool_calls: [{ function: { name: 'hubot_ollama_get_current_time', arguments: {} } }]
        }
      },
      // Phase 3, iteration 1: another tool call with thinking content
      {
        message: {
          role: 'assistant',
          content: 'Now checking again.',
          tool_calls: [{ function: { name: 'hubot_ollama_get_current_time', arguments: {} } }]
        }
      },
      // Phase 3, iteration 2: final answer
      {
        message: {
          role: 'assistant',
          content: 'Done! The time has been checked twice.'
        }
      }
    ]);

    await room.user.say('alice', 'hubot ask check time twice');
    await new Promise((resolve) => setTimeout(resolve, 250));

    const botMessages = room.messages.filter(m => m[0] === 'hubot').map(m => m[1]);
    expect(botMessages).toEqual([
      'I will check the time first.',
      'Now checking again.',
      'Done! The time has been checked twice.'
    ]);
  });
});
