// Convert markdown to Slack-compatible mrkdwn format
// This handles common markdown patterns that LLMs generate but Slack doesn't support

const AsciiTable = require('ascii-table');
const { marked } = require('marked');

/**
 * Convert markdown text to Slack-compatible formatting
 * @param {string} markdown - The markdown text to convert
 * @returns {string} - Slack-compatible text
 */
function convertToSlackFormat(markdown) {
  if (!markdown || typeof markdown !== 'string') {
    return markdown;
  }

  // Create custom renderer for all elements
  const renderer = {
    // Block-level elements

    heading({ tokens }) {
      return `*${this.parser.parseInline(tokens)}*\n`;
    },

    table({ header, rows }) {
      // Render markdown tables as ASCII inside a code block for Slack
      const headerTexts = header.map(cell => this.parser.parseInline(cell.tokens));
      const rowTexts = rows.map(row => row.map(cell => this.parser.parseInline(cell.tokens)));

      const table = new AsciiTable();
      if (headerTexts.length > 0) {
        table.setHeading(...headerTexts);
      }
      rowTexts.forEach((cells) => table.addRow(...cells));

      // ascii-table already includes borders and padding; wrap in code block
      return `\n\`\`\`\n${table.toString()}\n\`\`\`\n\n`;
    },

    code({ text, lang }) {
      return `\`\`\`${lang || ''}\n${text}\n\`\`\`\n`;
    },

    list({ items, ordered }) {
      let result = '';
      items.forEach((item, index) => {
        const prefix = ordered ? `${index + 1}. ` : '• ';
        // Handle list items with inline formatting
        let text = '';
        if (item.tokens && item.tokens.length > 0 && item.tokens[0].tokens) {
          // List item has a text token with inline tokens (bold, italic, etc.)
          text = this.parser.parseInline(item.tokens[0].tokens);
        } else {
          // Fallback for simple list items
          text = this.parser.parse(item.tokens, false);
        }
        result += prefix + text.trim() + '\n';
      });
      return result + '\n';
    },

    blockquote({ tokens }) {
      const text = this.parser.parse(tokens, false);
      const lines = text.split('\n').filter(line => line.trim());
      return lines.map(line => `> ${line}`).join('\n') + '\n';
    },

    hr() {
      return '---\n';
    },

    paragraph({ tokens }) {
      return this.parser.parseInline(tokens) + '\n';
    },

    // Inline elements

    strong({ tokens }) {
      // Bold: **text** -> *text* (Slack format)
      return `*${this.parser.parseInline(tokens)}*`;
    },

    em({ tokens }) {
      // Italic: *text* or _text_ -> _text_ (Slack format)
      return `_${this.parser.parseInline(tokens)}_`;
    },

    codespan({ text }) {
      // Inline code: preserve as-is (Slack supports this)
      return `\`${text}\``;
    },

    br() {
      return '\n';
    },

    del({ tokens }) {
      // Strikethrough: ~~text~~ -> ~text~ (Slack format)
      return `~${this.parser.parseInline(tokens)}~`;
    },

    link({ href, tokens, text }) {
      // Links: [text](url) -> <url|text> or <url>
      const linkText = tokens ? this.parser.parseInline(tokens) : text;
      if (linkText === href) {
        return `<${href}>`;
      }
      return `<${href}|${linkText}>`;
    },

    image({ href, text }) {
      // Images: ![alt](url) -> [Image: alt] <url>
      return `[Image: ${text}] <${href}>`;
    },

    text({ text }) {
      return text;
    }
  };

  // Configure marked with our custom renderer
  marked.use({
    renderer,
    breaks: true,
    gfm: true
  });

  try {
    // Parse and convert the markdown
    let converted = marked.parse(markdown);

    // Clean up excessive newlines
    converted = converted.replace(/\n{3,}/g, '\n\n');

    // Trim whitespace
    converted = converted.trim();

    return converted;
  } catch (error) {
    // If parsing fails, return original markdown
    console.error('Slack formatter error:', error);
    return markdown;
  }
}

module.exports = { convertToSlackFormat };
