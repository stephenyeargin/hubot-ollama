// Utility functions for hubot-ollama

function sanitizeText(text) {
  // Remove control characters except tab, newline, carriage return
  return (text || '').replace(/[^	\n\r\u0020-\u007E]/g, '');
}

function truncate(s, max) {
  return (s.length > max ? `${s.slice(0, max)}...` : s);
}

module.exports = {
  sanitizeText,
  truncate,
};
