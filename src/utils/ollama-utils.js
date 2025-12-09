// Utility functions for hubot-ollama

function sanitizeText(text) {
  // Remove control characters except tab, newline, carriage return
  return (text || '').replace(/[^\x09\x0A\x0D\u0020-\u007E]/g, '');
}

function truncate(s, max) {
  return (s.length > max ? `${s.slice(0, max)}...` : s);
}

function getAdapterType(robot) {
  // Centralized adapter detection - returns adapter type for format handling
  // Extensible to support multiple custom response formats in the future
  const adapterName = robot?.adapterName ?? robot?.adapter?.name;

  if (/slack/i.test(adapterName)) {
    return 'slack';
  }

  return 'default';
}

module.exports = {
  sanitizeText,
  truncate,
  getAdapterType,
};
