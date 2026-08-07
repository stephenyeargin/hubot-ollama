// Persistent memory tool for Ollama integration
// Lets the model save/recall/list/delete short facts in robot.brain, scoped by
// the same context key used for conversation history (see getContextKey in
// hubot-ollama.js), so memory privacy follows HUBOT_OLLAMA_CONTEXT_SCOPE.

const { looksLikeSecret } = require('../utils/ollama-utils');

const BRAIN_KEY = 'ollamaMemory';
const VALID_ACTIONS = new Set(['save', 'recall', 'list', 'delete']);
const MAX_KEY_CHARS = 100;

module.exports = (ollama, config, logger) => ({
  name: 'hubot_ollama_memory',
  description:
    'Cache information across conversations so you avoid re-deriving, re-fetching, or ' +
    're-asking for it next time — e.g. a fact the user already gave you, a slow or expensive ' +
    "result from another tool, or a detail you'd otherwise have to look up again. " +
    "Actions: 'save' (store it under a short key with a summary and full content), " +
    "'recall' (get full content for a key), 'list' (browse keys and summaries only, no " +
    "content — cheap to check before saving or recalling), 'delete' (remove a stale or " +
    'incorrect key). Guidelines: only save information you are confident is accurate — ' +
    'something the user explicitly stated or a tool result you already verified — never a ' +
    "guess or inference. Before saving, consider calling 'list' first — if an existing key " +
    'already covers this, reuse that key (save overwrites) instead of creating a ' +
    'near-duplicate entry. Never save secrets: passwords, API keys, tokens, or credentials ' +
    '— these will be rejected.',
  parameters: {
    action: {
      type: 'string',
      description: 'One of: save, recall, list, delete'
    },
    key: {
      type: 'string',
      description: 'Short identifier for this memory (required for save/recall/delete)'
    },
    summary: {
      type: 'string',
      description: 'Short description of the memory (required for save)'
    },
    content: {
      type: 'string',
      description: 'Full content to store (required for save)'
    }
  },
  handler: async (args, robot, msg) => {
    const { action, key: rawKey, summary: rawSummary, content: rawContent } = args || {};

    try {
      if (!VALID_ACTIONS.has(action)) {
        return { error: `Invalid action "${action}". Must be one of: save, recall, list, delete` };
      }

      // Refuse to operate on a message we can't attribute to a specific room/user.
      // Without this, a malformed msg (missing message.room or message.user) collapses
      // to getContextKey's shared fallback bucket, letting unrelated callers read/write
      // the same persistent memory — a much bigger deal here than for TTL'd conversation
      // context, since these entries don't expire on their own.
      const messageInfo = msg && msg.message;
      const hasResolvableRoom = Boolean(messageInfo && messageInfo.room);
      const hasResolvableUser = Boolean(messageInfo && messageInfo.user && (messageInfo.user.id || messageInfo.user.name));
      if (!hasResolvableRoom || !hasResolvableUser) {
        logger?.warn('Memory tool refusing to operate: message has no resolvable room/user, would collide with the shared fallback context key');
        return { error: 'Unable to resolve a specific conversation context for this message; memory actions are unavailable here.' };
      }

      const getContextKey = config && config.getContextKey;
      if (typeof getContextKey !== 'function') {
        logger?.error('Memory tool misconfigured: no getContextKey provided');
        return { error: 'Memory tool is not properly configured' };
      }
      const scopeKey = getContextKey(msg);

      if (!robot.brain.get(BRAIN_KEY)) {
        robot.brain.set(BRAIN_KEY, {});
      }
      const memory = robot.brain.get(BRAIN_KEY);
      if (!memory[scopeKey]) {
        memory[scopeKey] = {};
      }
      const scope = memory[scopeKey];

      const maxEntries = (config && config.MAX_ENTRIES) || 200;
      const maxContentChars = (config && config.MAX_CONTENT_CHARS) || 4000;
      const maxSummaryChars = (config && config.MAX_SUMMARY_CHARS) || 200;

      if (action === 'list') {
        const entries = Object.entries(scope)
          .map(([key, entry]) => ({ key, summary: entry.summary, updatedAt: entry.updatedAt }))
          .sort((a, b) => b.updatedAt - a.updatedAt);
        return { entries };
      }

      const key = typeof rawKey === 'string' ? rawKey.trim().slice(0, MAX_KEY_CHARS) : '';
      if (!key) {
        return { error: 'A "key" is required for this action' };
      }

      if (action === 'recall') {
        const entry = scope[key];
        if (!entry) {
          return { error: `No memory found for key "${key}"` };
        }
        entry.lastAccessedAt = Date.now();
        robot.brain.set(BRAIN_KEY, memory);
        return { key, summary: entry.summary, content: entry.content, updatedAt: entry.updatedAt };
      }

      if (action === 'delete') {
        if (!scope[key]) {
          return { error: `No memory found for key "${key}"` };
        }
        delete scope[key];
        robot.brain.set(BRAIN_KEY, memory);
        return { deleted: true, key };
      }

      // action === 'save'
      const content = typeof rawContent === 'string' ? rawContent.trim() : '';
      if (!content) {
        return { error: 'Content is required to save a memory' };
      }

      if (looksLikeSecret(content) || looksLikeSecret(rawSummary)) {
        logger?.warn('Memory tool rejected save: content looks like a secret or credential');
        return { error: 'Refusing to store content that looks like a secret or credential' };
      }

      const truncated = content.length > maxContentChars;
      const cappedContent = truncated ? content.slice(0, maxContentChars) : content;

      const rawSummaryTrimmed = typeof rawSummary === 'string' ? rawSummary.trim() : '';
      const summarySource = rawSummaryTrimmed || cappedContent;
      const summary = summarySource.length > maxSummaryChars
        ? `${summarySource.slice(0, maxSummaryChars)}...`
        : summarySource;

      const now = Date.now();
      const existing = scope[key];

      if (!existing && Object.keys(scope).length >= maxEntries) {
        const [lruKey] = Object.entries(scope)
          .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt)[0];
        logger?.debug(`Memory tool evicting least-recently-accessed key "${lruKey}" (scope at capacity)`);
        delete scope[lruKey];
      }

      scope[key] = {
        summary,
        content: cappedContent,
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now,
        lastAccessedAt: now
      };
      robot.brain.set(BRAIN_KEY, memory);

      return {
        saved: true,
        key,
        summaryChars: summary.length,
        contentChars: cappedContent.length,
        truncated
      };
    } catch (error) {
      logger?.error(`Memory tool error: ${error.message}`);
      return { error: error.message };
    }
  }
});
