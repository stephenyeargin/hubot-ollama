const { convertToSlackFormat } = require('../src/utils/slack-formatter');

describe('slack-formatter', () => {
  describe('convertToSlackFormat', () => {
    it('should handle null/undefined input', () => {
      expect(convertToSlackFormat(null)).toBeNull();
      expect(convertToSlackFormat(undefined)).toBeUndefined();
      expect(convertToSlackFormat('')).toBe('');
    });

    it('should preserve plain text', () => {
      const input = 'This is plain text without any formatting.';
      const result = convertToSlackFormat(input);
      expect(result).toBe(input);
    });

    it('should convert headers to bold', () => {
      const input = '# Header 1\n## Header 2\n### Header 3';
      const result = convertToSlackFormat(input);
      expect(result).toContain('*Header 1*');
      expect(result).toContain('*Header 2*');
      expect(result).toContain('*Header 3*');
    });

    it('should preserve bold and italic formatting', () => {
      const input = 'This is **bold** and this is *italic* and this is ***both***.';
      const result = convertToSlackFormat(input);
      expect(result).toContain('*bold*');
      expect(result).toContain('_italic_');
    });

    it('should preserve inline code', () => {
      const input = 'Use `console.log()` for debugging.';
      const result = convertToSlackFormat(input);
      expect(result).toContain('`console.log()`');
    });

    it('should preserve code blocks', () => {
      const input = '```javascript\nconst x = 42;\nconsole.log(x);\n```';
      const result = convertToSlackFormat(input);
      expect(result).toContain('```javascript');
      expect(result).toContain('const x = 42;');
      expect(result).toContain('console.log(x);');
      expect(result).toContain('```');
    });

    it('should convert markdown links to Slack format', () => {
      const input = 'Check out [GitHub](https://github.com) for more info.';
      const result = convertToSlackFormat(input);
      expect(result).toContain('<https://github.com|GitHub>');
    });

    it('should handle plain URLs', () => {
      const input = '[https://example.com](https://example.com)';
      const result = convertToSlackFormat(input);
      expect(result).toContain('<https://example.com>');
    });

    it('should convert tables to plain text', () => {
      const input = `| Column 1 | Column 2 |
|----------|----------|
| Data 1   | Data 2   |
| Data 3   | Data 4   |`;
      const result = convertToSlackFormat(input);
      // Should not contain table markup
      expect(result).not.toContain('|----------|');
      // Should contain the data
      expect(result).toContain('Column 1');
      expect(result).toContain('Column 2');
      expect(result).toContain('Data 1');
      expect(result).toContain('Data 2');
    });

    it('should convert lists with bullets', () => {
      const input = `- Item 1\n- Item 2\n- Item 3`;
      const result = convertToSlackFormat(input);
      expect(result).toContain('• Item 1');
      expect(result).toContain('• Item 2');
      expect(result).toContain('• Item 3');
    });

    it('should handle blockquotes', () => {
      const input = '> This is a quote\n> On multiple lines';
      const result = convertToSlackFormat(input);
      expect(result).toContain('> This is a quote');
      expect(result).toContain('> On multiple lines');
    });

    it('should convert strikethrough', () => {
      const input = 'This is ~~deleted~~ text.';
      const result = convertToSlackFormat(input);
      expect(result).toContain('~deleted~');
    });

    it('should handle horizontal rules', () => {
      const input = 'Text before\n\n---\n\nText after';
      const result = convertToSlackFormat(input);
      expect(result).toContain('---');
    });

    it('should handle complex mixed formatting', () => {
      const input = `# Title

This is **bold** and *italic* text with a [link](https://example.com).

Here's some code: \`const x = 42;\`

And a code block:
\`\`\`javascript
function hello() {
  console.log("world");
}
\`\`\`

- List item 1
- List item 2

> A quote

| Table | Header |
|-------|--------|
| Cell  | Data   |
`;
      const result = convertToSlackFormat(input);

      // Should have all the conversions
      expect(result).toContain('*Title*');
      expect(result).toContain('*bold*');
      expect(result).toContain('_italic_');
      expect(result).toContain('<https://example.com|link>');
      expect(result).toContain('`const x = 42;`');
      expect(result).toContain('```javascript');
      expect(result).toContain('function hello()');
      expect(result).toContain('• List item 1');
      expect(result).toContain('> A quote');
      expect(result).toContain('Table');
      expect(result).toContain('Header');
    });

    it('should not modify content inside code blocks', () => {
      const input = '```\n**This should not be bold**\n[This should not be a link](url)\n```';
      const result = convertToSlackFormat(input);
      expect(result).toContain('**This should not be bold**');
      expect(result).toContain('[This should not be a link](url)');
    });

    it('should clean up excessive newlines', () => {
      const input = 'Line 1\n\n\n\n\nLine 2';
      const result = convertToSlackFormat(input);
      // Should reduce to maximum 2 newlines
      expect(result).not.toContain('\n\n\n');
    });
  });
});
