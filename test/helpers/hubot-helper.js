'use strict';

const fs = require('fs');
const path = require('path');

let hubotModulePromise;

function getHubotModule() {
  if (!hubotModulePromise) {
    hubotModulePromise = import('hubot').then((mod) => mod.default || mod);
  }
  return hubotModulePromise;
}

function loadScriptFile(robot, filePath) {
  // Ensure scripts are re-evaluated on each room creation so env-driven
  // constants behave the same way as prior helper behavior.
  delete require.cache[require.resolve(filePath)];
  const script = require(filePath);
  if (typeof script === 'function') {
    script(robot);
  }
}

process.setMaxListeners(0);

function buildTestClasses(Hubot) {
  class MockResponse extends Hubot.Response {
    sendPrivate(...strings) {
      this.robot.adapter.sendPrivate(this.envelope, ...strings);
    }
  }

  class Room extends Hubot.Adapter {
    constructor(robot) {
      super();
      this.robot = robot;
      this.messages = [];
      this.privateMessages = {};
      this.user = {
        say: (userName, message, userParams) => this.receive(userName, message, userParams),
        enter: (userName, userParams) => this.enter(userName, userParams),
        leave: (userName, userParams) => this.leave(userName, userParams),
      };
    }

    receive(userName, message, userParams = {}) {
      return new Promise((resolve, reject) => {
        let textMessage;
        if (typeof message === 'object' && message) {
          textMessage = message;
        } else {
          userParams.room = this.name;
          const user = new Hubot.User(userName, userParams);
          textMessage = new Hubot.TextMessage(user, message);
        }
        this.messages.push([userName, textMessage.text]);
        this.robot.receive(textMessage).then(() => resolve()).catch(reject);
      });
    }

    reply(envelope, ...strings) {
      strings.forEach((str) => this.messages.push(['hubot', `@${envelope.user.name} ${str}`]));
    }

    send(envelope, ...strings) {
      strings.forEach((str) => this.messages.push(['hubot', str]));
    }

    sendPrivate(envelope, ...strings) {
      if (!(envelope.user.name in this.privateMessages)) {
        this.privateMessages[envelope.user.name] = [];
      }
      strings.forEach((str) => this.privateMessages[envelope.user.name].push(['hubot', str]));
    }

    robotEvent(...args) {
      this.robot.emit(...args);
    }

    enter(userName, userParams = {}) {
      return new Promise((resolve, reject) => {
        userParams.room = this.name;
        const user = new Hubot.User(userName, userParams);
        this.robot.receive(new Hubot.EnterMessage(user)).then(() => resolve()).catch(reject);
      });
    }

    leave(userName, userParams = {}) {
      return new Promise((resolve, reject) => {
        userParams.room = this.name;
        const user = new Hubot.User(userName, userParams);
        this.robot.receive(new Hubot.LeaveMessage(user)).then(() => resolve()).catch(reject);
      });
    }

    destroy() {
      if (this.robot.server) {
        this.robot.server.close();
      }
    }
  }

  class MockRobot extends Hubot.Robot {
    constructor(httpd = true) {
      super(null, httpd, 'hubot', false);
      this.messagesTo = {};
      this.Response = MockResponse;
    }

    messageRoom(roomName, str) {
      if (roomName === this.adapter.name) {
        this.adapter.messages.push(['hubot', str]);
      } else {
        if (!(roomName in this.messagesTo)) {
          this.messagesTo[roomName] = [];
        }
        this.messagesTo[roomName].push(['hubot', str]);
      }
    }

    loadAdapter() {
      this.adapter = new Room(this);
    }
  }

  return { MockResponse, MockRobot };
}

class Helper {
  constructor(scriptsPaths) {
    this.scriptsPaths = Array.isArray(scriptsPaths) ? scriptsPaths : [scriptsPaths];
  }

  async createRoom(options = {}) {
    const callerDir = path.dirname(this._callerFile());
    const Hubot = await getHubotModule();
    const { MockRobot } = buildTestClasses(Hubot);
    const robot = new MockRobot(options.httpd);

    if ('response' in options) {
      robot.Response = options.response;
    }

    // Hubot v14 does not attach an adapter automatically in this test flow.
    robot.loadAdapter();

    for (let script of this.scriptsPaths) {
      script = path.resolve(callerDir, script);
      if (fs.statSync(script).isDirectory()) {
        for (const file of fs.readdirSync(script).sort()) {
          loadScriptFile(robot, path.join(script, file));
        }
      } else {
        loadScriptFile(robot, script);
      }
    }

    robot.brain.emit('loaded');
    robot.adapter.name = options.name || 'room1';
    return robot.adapter;
  }

  // Determine the calling file so script paths resolve relative to the test file,
  // matching the behavior of hubot-test-helper which used module.parent.filename.
  _callerFile() {
    const orig = Error.prepareStackTrace;
    Error.prepareStackTrace = (_, stack) => stack;
    const err = new Error();
    const stack = err.stack;
    Error.prepareStackTrace = orig;

    // Walk up the stack past this file to find the first external caller
    const thisFile = __filename;
    for (const frame of stack) {
      const file = frame.getFileName();
      if (file && file !== thisFile) {
        return file;
      }
    }
    return thisFile;
  }
}

module.exports = Helper;
