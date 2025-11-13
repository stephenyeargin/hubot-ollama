const Helper = require('hubot-test-helper');
const nock = require('nock');

const helper = new Helper('./../src/hubot-script.js');

describe('hubot-script', () => {
  let room = null;

  beforeEach(() => {
    process.env.HUBOT_EXAMPLE_API_KEY = 'abcdef';
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
    delete process.env.HUBOT_EXAMPLE_API_KEY;
  });

  // Example: Returning data through an API
  describe('ask hubot to get a message', () => {
    beforeEach((done) => {
      nock('https://api.example.com')
        .matchHeader('x-api-key', 'abcdef')
        .get('/v1/status.json')
        .replyWithFile(200, './test/fixtures/sample_api_response.json');
      room.user.say('alice', 'hubot hello:get');
      setTimeout(done, 100);
    });

    it('hubot responds with message', () => expect(room.messages).toEqual([
      ['alice', 'hubot hello:get'],
      ['hubot', 'GET: Hello world!'],
    ]));

    it('logs debug message', () => {
      expect(room.robot.logger.debug).toHaveBeenCalledWith('Calling hello:get');
    });
  });

  // Example: Sending data through an API
  describe('ask hubot to post a message', () => {
    beforeEach((done) => {
      nock('https://api.example.com')
        .matchHeader('x-api-key', 'abcdef')
        .post('/v1/status', { payload: 'Hello world!' })
        .reply(200, { status: 'Status updated!' });
      room.user.say('alice', 'hubot hello:post Hello world!');
      setTimeout(done, 100);
    });

    it('hubot responds with message', () => expect(room.messages).toEqual([
      ['alice', 'hubot hello:post Hello world!'],
      ['hubot', 'POST: Status updated!'],
    ]));

    it('logs debug message', () => {
      expect(room.robot.logger.debug).toHaveBeenCalledWith('Calling hello:post');
    });
  });

  // Example: Handle an error
  describe('ask hubot to post a message, get an error', () => {
    beforeEach((done) => {
      nock('https://api.example.com')
        .matchHeader('x-api-key', 'abcdef')
        .post('/v1/status', { payload: 'Hello world!' })
        .replyWithError('An unexpected error has occurred!');
      room.user.say('alice', 'hubot hello:post Hello world!');
      setTimeout(done, 100);
    });

    it('hubot responds with message', () => expect(room.messages).toEqual([
      ['alice', 'hubot hello:post Hello world!'],
      ['hubot', 'Error: An unexpected error has occurred!'],
    ]));

    it('logs error message', () => {
      expect(room.robot.logger.error).toHaveBeenCalled();
    });
  });

  // Return a plaintext message when not using Slack adapter
  describe('ask hubot to return a plain text message', () => {
    beforeEach((done) => {
      room.user.say('alice', 'hubot slack test');
      setTimeout(done, 100);
    });

    it(
      'hubot responds with plain text message',
      () => expect(room.messages).toEqual([
        ['alice', 'hubot slack test'],
        ['hubot', 'This message is not formatted for Slack.'],
      ]),
    );
  });
});
