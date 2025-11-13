const Helper = require('hubot-test-helper');
const nock = require('nock');

const helper = new Helper([
  './../test/adapters/slack.js',
  './../src/hubot-script.js',
]);

describe('hubot-script slack', () => {
  let room = null;

  beforeEach(() => {
    room = helper.createRoom();
    nock.disableNetConnect();

    // Mock robot.logger methods
    ['debug', 'info', 'warning', 'error'].forEach((method) => {
      room.robot.logger[method] = jest.fn();
    });
  });

  afterEach(() => {
    room.destroy();
    nock.cleanAll();
  });

  // Example: Return a Slack formatted message when using adapter
  describe('ask hubot to return a Slack message', () => {
    beforeEach((done) => {
      room.user.say('alice', 'hubot slack test');
      setTimeout(done, 100);
    });

    it('hubot responds with message', () => expect(room.messages).toEqual([
      ['alice', 'hubot slack test'],
      ['hubot', {
        attachments: [
          {
            title: 'Slack Test',
            text: 'This message is formatted for Slack.',
            color: '#36a64f',
          },
        ],
      }],
    ]));
  });
});
