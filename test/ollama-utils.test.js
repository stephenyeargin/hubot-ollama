const utils = require('../src/ollama-utils');

describe('ollama-utils', () => {
  describe('sanitizeText', () => {
    test('removes control characters except tab/newline/carriage-return', () => {
      const input = 'Hello\x01World\nTab\tEnd';
      const output = utils.sanitizeText(input);
      expect(output).toBe('HelloWorld\nTab\tEnd');
    });
  });

  describe('truncate', () => {
    test('truncates long strings and appends ...', () => {
      const input = 'abcdefg';
      expect(utils.truncate(input, 4)).toBe('abcd...');
    });
    test('returns string unchanged if under max', () => {
      expect(utils.truncate('abc', 10)).toBe('abc');
    });
  });
});
