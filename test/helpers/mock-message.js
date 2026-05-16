/**
 * Helper to create mock Hubot text message objects for testing.
 * Provides a consistent message shape across test suites.
 */
function createMockTextMessage(text, {
  userName = 'alice',
  userId = 'U123',
  room = 'room1',
  privateMessage = false,
  rawMessage = undefined
} = {}) {
  return {
    text,
    user: {
      id: userId,
      name: userName,
      room
    },
    room,
    private: privateMessage,
    rawMessage,
    done: false,
    match(regex) {
      return this.text.match(regex);
    },
    toString() {
      return this.text;
    }
  };
}

module.exports = {
  createMockTextMessage
};
