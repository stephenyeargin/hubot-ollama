const path = require('path');

const Helper = require('hubot-test-helper');
// Mock Ollama to simulate nameless tool calls with configurable scripted responses
jest.mock('ollama', () => {
  let scriptedResponses = null;
  let showResponse = { capabilities: ['tools', 'completion'] };

  class MockOllama {
    constructor() {
      this._callCount = 0;
    }
    async show() {
      return showResponse;
    }
    async chat() {
      this._callCount += 1;
      if (Array.isArray(scriptedResponses) && scriptedResponses[this._callCount - 1]) {
        return scriptedResponses[this._callCount - 1];
      }

      // Default behavior used by the first test: nameless call with hint, then nameless again
      if (this._callCount === 1) {
        return {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_1',
                function: { index: 0, name: '', arguments: { parameters: {}, type: 'hubot_ollama_get_current_time' } }
              }
            ]
          }
        };
      }
      if (this._callCount === 2) {
        return {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_2',
                function: { index: 0, name: '', arguments: {} }
              }
            ]
          }
        };
      }
      // Should bail before reaching here; return empty to catch regressions
      return { message: { role: 'assistant', content: '' } };
    }
  }

  MockOllama.__setChatResponses = (responses) => {
    scriptedResponses = responses;
  };

  MockOllama.__setShowResponse = (resp) => {
    showResponse = resp;
  };

  return { Ollama: MockOllama };
});

const helper = new Helper(path.join(__dirname, '..', 'src', 'hubot-ollama.js'));

describe('hubot-ollama nameless tool call bail-out', () => {
  let room;

  beforeEach(() => {
    process.env.HUBOT_OLLAMA_TOOLS_ENABLED = 'true';
    room = helper.createRoom();
    // Mock logger to avoid console spam during tests
    ['debug', 'info', 'warn', 'warning', 'error'].forEach((method) => {
      room.robot.logger[method] = jest.fn();
    });
  });

  afterEach(() => {
    room.destroy();
    delete process.env.HUBOT_OLLAMA_TOOLS_ENABLED;
    const MockOllama = require('ollama').Ollama;
    if (MockOllama.__setChatResponses) {
      MockOllama.__setChatResponses(null);
    }
  });

  it('breaks out after repeated nameless tool calls', async () => {
    await room.user.say('alice', 'hubot ask What tools do you have available?');
    await new Promise((resolve) => setTimeout(resolve, 250));

    const last = room.messages[room.messages.length - 1][1];
    expect(last).toMatch(/recovered|answer|proceed|tool name|valid/i);
  });

  it('ignores nameless tool call with no hint and continues', async () => {
    // Mock sequence: first response has nameless tool call with no arguments/hint; second responds normally
    const responses = [
      {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              function: { index: 0, name: '', arguments: {} }
            }
          ]
        }
      },
      {
        message: {
          role: 'assistant',
          content: 'No tools were used; here is a direct answer.'
        }
      }
    ];

    const MockOllama = require('ollama').Ollama;
    MockOllama.__setChatResponses(responses);

    await room.user.say('alice', 'hubot ask What tools do you have available?');
    await new Promise((resolve) => setTimeout(resolve, 250));

    const last = room.messages[room.messages.length - 1][1];
    expect(last).toMatch(/No tools were used/i);
  });
});
