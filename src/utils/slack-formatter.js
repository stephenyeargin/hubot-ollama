// Convert markdown to Slack-compatible mrkdwn format
// This handles common markdown patterns that LLMs generate but Slack doesn't support

const AsciiTable = require('ascii-table');
const { Marked } = require('marked');

// Slack table block limits: https://docs.slack.dev/reference/block-kit/blocks/table-block/
const TABLE_MAX_ROWS = 100;
const TABLE_MAX_COLUMNS = 20;
const TABLE_MAX_CHARS = 10000;
const SECTION_MAX_CHARS = 3000;
const MESSAGE_MAX_BLOCKS = 50;

// Extract plain text from inline tokens (no formatting like bold/italic)
const extractPlainText = (tokens) => tokens.map(token => {
    if (token.type === 'text') {
      return token.text;
    } else if (token.tokens) {
      return extractPlainText(token.tokens);
    }
    return token.raw || '';
  }).join('');

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
      const headerTexts = header.map(cell => extractPlainText(cell.tokens));
      const rowTexts = rows.map(row => row.map(cell => extractPlainText(cell.tokens)));

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

  // Create a new Marked instance with custom renderer
  const markedInstance = new Marked({
    renderer,
    breaks: true,
    gfm: true
  });

  try {
    // Parse and convert the markdown
    let converted = markedInstance.parse(markdown);

    // Clean up excessive newlines
    converted = converted.replace(/\n{3,}/g, '\n\n');

    // Clean up unmatched asterisks from malformed markdown
    // Only process lines outside of code blocks (```...```)
    const lines = converted.split('\n');
    let inCodeBlock = false;
    const processedLines = lines.map((line) => {
      // Track if we're inside a code block
      if (line.includes('```')) {
        inCodeBlock = !inCodeBlock;
        return line;
      }

      // Only clean up asterisks if we're not in a code block
      if (inCodeBlock) {
        return line;
      }

      // Handle cases like "text:** " -> "text: " (mismatched ** after colon)
      let cleanedLine = line.replace(/:\*\*(?=\s|$)/g, ':');

      // Handle patterns like "word:** " at line end (unmatched opening **)
      cleanedLine = cleanedLine.replace(/([a-zA-Z])\*\*(\s*$)/g, '$1$2');

      return cleanedLine;
    });
    converted = processedLines.join('\n');

    // Trim whitespace
    converted = converted.trim();

    return converted;
  } catch (error) {
    // If parsing fails, return original markdown
    console.error('Slack formatter error:', error);
    return markdown;
  }
}

function toTableBlock({ header, rows, align }, maxChars) {
  const textRows = [header, ...rows].map(row => row.map(cell => extractPlainText(cell.tokens)));
  if (textRows.length > TABLE_MAX_ROWS || header.length > TABLE_MAX_COLUMNS) return null;
  const chars = textRows.flat().join('').length;
  if (chars > maxChars) return null;

  const block = {
    type: 'table',
    rows: textRows.map(row => row.map(text => ({ type: 'raw_text', text }))),
  };
  if (align.some(Boolean)) {
    block.column_settings = align.map(a => (a ? { align: a } : null));
  }
  return { block, chars };
}

// Splits text into chunks of at most `max` chars, closing and reopening code fences across chunks
function chunkText(text, max) {
  const chunks = [];
  let rest = text;
  let reopen = '';
  while (reopen.length + rest.length > max) {
    const budget = max - reopen.length - 4;
    let cut = rest.lastIndexOf('\n', budget);
    if (cut <= 0) cut = budget;
    let chunk = reopen + rest.slice(0, cut);
    rest = rest.slice(cut).replace(/^\n/, '');
    const inFence = (chunk.match(/```/g) || []).length % 2 === 1;
    if (inFence) chunk += '\n```';
    reopen = inFence ? '```\n' : '';
    chunks.push(chunk);
  }
  if (rest) chunks.push(reopen + rest);
  return chunks;
}

/**
 * Convert markdown containing tables into Slack Block Kit blocks, rendering each
 * table as a native table block and surrounding content as mrkdwn sections.
 * @param {string} markdown - The markdown text to convert
 * @returns {Array|null} - Blocks, or null when there is no table to render natively
 */
function convertToSlackBlocks(markdown) {
  if (!markdown || typeof markdown !== 'string') {
    return null;
  }

  let tokens;
  try {
    tokens = new Marked({ gfm: true }).lexer(markdown);
  } catch {
    return null;
  }

  const blocks = [];
  let pending = '';
  let tableChars = 0;
  // Sections are converted separately, so each needs the message's reference-link definitions
  const refs = Object.entries(tokens.links || {})
    .map(([label, { href, title }]) => `[${label}]: ${href}${title ? ` "${title}"` : ''}`)
    .join('\n');

  const flush = () => {
    const text = pending.trim() ? convertToSlackFormat(refs ? `${pending}\n\n${refs}` : pending) : '';
    pending = '';
    if (!text) return;
    chunkText(text, SECTION_MAX_CHARS).forEach((chunk) => {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: chunk } });
    });
  };

  // Tables beyond Slack's limits (including the per-message cell character budget) stay ASCII
  for (const token of tokens) {
    if (token.type === 'hr') {
      flush();
      blocks.push({ type: 'divider' });
      continue;
    }
    const table = token.type === 'table' ? toTableBlock(token, TABLE_MAX_CHARS - tableChars) : null;
    if (table) {
      flush();
      blocks.push(table.block);
      tableChars += table.chars;
    } else {
      pending += token.raw;
    }
  }
  flush();

  if (blocks.length > MESSAGE_MAX_BLOCKS) return null;
  return blocks.some(b => b.type === 'table') ? blocks : null;
}

module.exports = { convertToSlackFormat, convertToSlackBlocks };
