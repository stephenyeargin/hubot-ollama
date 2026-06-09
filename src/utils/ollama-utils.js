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

/**
 * Neutralize Slack broadcast mention syntax in model output.
 * Slack treats <!here>, <!channel>, and <!everyone> as broadcast triggers.
 * Replace them with display-safe equivalents that won't notify the whole channel.
 * @param {string} text
 * @returns {string}
 */
function sanitizeSlackBroadcasts(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/<!here>/gi, '@here')
    .replace(/<!channel>/gi, '@channel')
    .replace(/<!everyone>/gi, '@everyone');
}

/**
 * Common prompt injection and jailbreak patterns.
 * Matches attempts to override the system prompt or redefine the bot's identity/role.
 * Detection is heuristic; no list is exhaustive.
 */
const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|context|rules?)/i,
  /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|context|rules?)/i,
  /forget\s+(all\s+)?(previous|prior|your)\s+(instructions?|training|context|rules?)/i,
  /you\s+are\s+now\s+(a|an|the)\b/i,
  /act\s+as\s+(if\s+you\s+are\s+)?(a|an|the)\b/i,
  /pretend\s+(you\s+are|to\s+be)\b/i,
  /new\s+(system\s+)?instructions?\s*:/i,
  /\bsystem\s*:\s*/i,
  /override\s+(the\s+)?(system\s+)?prompt/i,
  /do\s+not\s+(follow|obey|adhere\s+to)\s+(your|the)\s+(instructions?|rules?|guidelines?|constraints?)/i,
  /jailbreak/i,
  /DAN\s+(mode|prompt)/i,
];

/**
 * Detect likely prompt injection attempts in user input.
 * Returns true if a suspicious pattern is found, false otherwise.
 * Callers should log a warning; blocking is optional.
 * @param {string} text
 * @returns {boolean}
 */
function detectPromptInjection(text) {
  if (!text || typeof text !== 'string') return false;
  return PROMPT_INJECTION_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Return the thread_ts of an existing thread the message belongs to, or null.
 * Does NOT fall back to the message's own ts — use this when you need to know
 * whether the message is already inside a thread (e.g. context key scoping).
 * @param {object} msg - Hubot response object
 * @returns {string|null}
 */
function getExistingSlackThread(msg) {
  if (!msg || !msg.message) return null;
  const m = msg.message.message || msg.message;
  const raw = m.rawMessage || {};
  const envelopeMsg = (msg.envelope && msg.envelope.message) || {};
  return (
    m.thread_id || m.threadId || m.thread_ts ||
    raw.thread_ts || raw.threadId ||
    (raw.event && (raw.event.thread_ts || raw.event.threadId)) ||
    (raw.body && raw.body.event && (raw.body.event.thread_ts || raw.body.event.threadId)) ||
    envelopeMsg.thread_ts || envelopeMsg.threadId || null
  );
}

/**
 * Resolve the best available thread_ts to use when replying to a Slack message.
 * Returns an existing thread_ts when the message is already in a thread,
 * or falls back to the message's own ts (anchoring a new thread).
 * Handles both normal respond() messages and catchAll-wrapped messages,
 * plus the various Slack adapter rawMessage shapes (bolt events API, classic).
 * @param {object} msg - Hubot response object
 * @returns {string|undefined}
 */
function getSlackThreadTs(msg) {
  const existing = getExistingSlackThread(msg);
  if (existing) return existing;

  if (!msg || !msg.message) return undefined;
  const m = msg.message.message || msg.message;
  const raw = m.rawMessage || {};
  const envelopeMsg = (msg.envelope && msg.envelope.message) || {};
  return raw.ts
    || raw.event_ts
    || (raw.event && (raw.event.ts || raw.event.event_ts))
    || (raw.body && raw.body.event && (raw.body.event.ts || raw.body.event.event_ts))
    || envelopeMsg.ts
    || undefined;
}

module.exports = {
  sanitizeText,
  sanitizeSlackBroadcasts,
  detectPromptInjection,
  truncate,
  getAdapterType,
  getExistingSlackThread,
  getSlackThreadTs,
};
