// Hubot command tool — lets the LLM invoke another registered Hubot listener
// on the user's behalf and read its response, so it can answer questions like
// "what projects are inflight" by silently running the matching command (e.g.
// `hubot project list`) rather than guessing. Only intended for use after the
// model has confirmed a matching command exists via hubot_ollama_help.
//
// Safety: commands that look state-changing (create/delete/rename/etc.) are
// refused unless the caller passes confirmed: true, which the tool description
// instructs the model to only do when the user explicitly asked for that exact
// action. This is a heuristic, not a guarantee — it narrows, not eliminates, the
// risk of an unintended side effect.
//
// Reentrancy: unlike a real chat adapter, robot.receive() has no built-in guard
// against a message ultimately looping back into this same tool (e.g. command A
// resolves to command B, which resolves back to `ask`, which asks the LLM to run
// command A again). The SELF_INVOCATION_PATTERN check below only catches the
// direct case; activeInvocations tracks in-flight runs per acting user/room so
// any indirect cycle is refused too, regardless of how many commands sit between
// the first call and the one that loops back.
//
// Settling: robot.receive() only awaits the promise a listener's own callback
// returns — many hubot scripts issue a Node-callback-style HTTP request (e.g.
// robot.http(...).get()((err, res, body) => msg.send(...))) without awaiting
// it, so the callback returns, and robot.receive() resolves, before the actual
// response is sent. Some scripts also acknowledge synchronously ("Working on
// it...") and then send the real answer once a slow HTTP call finishes. Since
// there's no way to tell an ack apart from a final answer, every capture —
// the first one or a later one — resets the same SETTLE_GRACE_MS window; we
// only conclude the response is complete once that long a quiet period has
// passed with nothing new arriving. This trades latency (every invocation
// waits out the window once nothing more shows up) for not silently dropping
// slow follow-ups.

const LISTENER_TIMEOUT_MS = 10000; // hard cap in case robot.receive() itself never resolves
const SETTLE_GRACE_MS = 10000; // quiet period required (after receive() resolves, and after each capture) before concluding the response is complete

const MUTATING_VERBS = /\b(create|delete|remove|close|rename|set|update|disable|enable|revoke|add|kick|ban|deploy|restart|kill|purge|drop|clear|archive|invite|grant|assign|unassign|merge|approve|reject|cancel|start|stop|pause|resume|reset|promote|demote|mute|unmute|block|unblock|lock|unlock)\b/i;

const SELF_INVOCATION_PATTERN = /^(?:ask|ollama|llm)\b/i;

const escapeRegex = (value) => String(value).replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');

// Tracks acting user/room keys with an in-flight invocation of this tool, so a
// command chain that loops back into hubot_ollama_run_command is refused instead
// of recursing indefinitely. Module-scoped: shared by every call to the handler
// created below, since the registry holds a single instance of it.
const activeInvocations = new Set();

// hubot ships ESM-only, so it must be loaded via dynamic import() from this
// CJS file. Kick that off once, right here at module-eval time (i.e. as soon
// as this file is require()d — before any test's fake timers are installed),
// and reuse the resolved module on every handler call thereafter. A cold
// import() triggered later, inside a handler call, has been observed to
// resolve unreliably slowly under certain Node/test-timer combinations.
const hubotModulePromise = import('hubot').then((m) => m.default || m);
const getHubotModule = () => hubotModulePromise;

module.exports = (_ollama, _config, logger) => ({
  name: 'hubot_ollama_run_command',
  description: 'Run another Hubot command on the user\'s behalf, as if they had typed it themselves, and ' +
    'return its response. Only call this after using hubot_ollama_help to confirm the exact command exists — ' +
    'never invent a command. Only include the bot\'s own name/alias prefix if the command needs it. ' +
    'For any command that changes, creates, deletes, closes, renames, or otherwise modifies data, you MUST ' +
    'set confirmed: true, and only do so when the user\'s own message explicitly and unambiguously asked for ' +
    'that specific action — never infer or assume intent to modify data. Read-only/informational commands ' +
    '(list, show, get, status, search, etc.) do not require confirmed.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The exact command text to run, as confirmed by hubot_ollama_help (e.g. "project list").'
      },
      confirmed: {
        type: 'boolean',
        description: 'Set to true only when the user explicitly asked for this specific state-changing action. Omit or false for read-only commands.'
      }
    },
    required: ['command']
  },
  handler: async (args, robot, msg) => {
    const { command, confirmed } = args || {};

    if (!command || typeof command !== 'string' || !command.trim()) {
      throw new Error('command parameter is required');
    }
    if (!robot || typeof robot.receive !== 'function') {
      throw new Error('robot.receive is not available');
    }
    if (!robot.adapter) {
      throw new Error('robot.adapter is not available');
    }
    if (!msg || !msg.message || !msg.message.user) {
      throw new Error('Originating user context is not available');
    }

    const trimmed = command.trim();
    if (trimmed.length > 500) {
      throw new Error('command exceeds maximum length of 500 characters');
    }

    const robotName = (robot.alias || robot.name || 'hubot');
    const escapedName = escapeRegex(robotName);
    const isAddressed = new RegExp(`^\\s*@?${escapedName}\\b`, 'i').test(trimmed);
    const commandText = isAddressed ? trimmed : `${robotName} ${trimmed}`;
    const withoutAddressing = commandText.replace(new RegExp(`^\\s*@?${escapedName}[:,]?\\s*`, 'i'), '');

    if (SELF_INVOCATION_PATTERN.test(withoutAddressing)) {
      throw new Error('Refusing to invoke the LLM command from within itself');
    }

    if (MUTATING_VERBS.test(withoutAddressing) && confirmed !== true) {
      logger?.warn(`hubot_ollama_run_command: refusing unconfirmed possibly-mutating command "${commandText}"`);
      return {
        error: 'This command appears to change data and was not run. Only retry with confirmed: true if the ' +
          'user explicitly and unambiguously asked for this exact action.'
      };
    }

    const reentrancyKey = `${msg.message.user.room || 'unknown-room'}:${msg.message.user.id || msg.message.user.name || 'unknown-user'}`;
    if (activeInvocations.has(reentrancyKey)) {
      logger?.warn(`hubot_ollama_run_command: refusing reentrant invocation for key=${reentrancyKey} command="${commandText}"`);
      throw new Error('Refusing to run this command: a hubot_ollama_run_command invocation is already in progress for this user and command chain looped back into this tool.');
    }
    activeInvocations.add(reentrancyKey);

    const Hubot = await getHubotModule();
    const adapter = robot.adapter;
    const targetRoom = msg.message.user.room;
    const captured = [];

    const rawSend = adapter.send;
    const rawReply = adapter.reply;
    const rawEmote = adapter.emote;
    const forwardSend = typeof rawSend === 'function' ? rawSend.bind(adapter) : null;

    let settleResolve;
    let settleTimer;
    const settled = new Promise((resolve) => { settleResolve = resolve; });
    const armSettleTimer = (ms) => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => settleResolve(), ms);
    };

    const capture = (envelope, ...strings) => {
      const room = envelope && envelope.room;
      if (room === targetRoom) {
        captured.push(...strings);
        armSettleTimer(SETTLE_GRACE_MS);
      } else if (forwardSend) {
        forwardSend(envelope, ...strings);
      }
    };

    adapter.send = capture;
    if (typeof rawReply === 'function') adapter.reply = capture;
    if (typeof rawEmote === 'function') adapter.emote = capture;

    logger?.info(`hubot_ollama_run_command: invoking "${commandText}" as user=${msg.message.user.name || msg.message.user.id}`);

    let hardTimeoutId;
    const hardTimeout = new Promise((_resolve, reject) => {
      hardTimeoutId = setTimeout(() => reject(new Error('Command timed out')), LISTENER_TIMEOUT_MS);
    });

    try {
      const syntheticMessage = new Hubot.TextMessage(msg.message.user, commandText);
      await Promise.race([robot.receive(syntheticMessage), hardTimeout]);
      clearTimeout(hardTimeoutId);

      // robot.receive() resolving only means the listener's own synchronous/awaited
      // work is done — give it a chance to settle before deciding there's no response.
      armSettleTimer(SETTLE_GRACE_MS);
      await settled;
    } finally {
      clearTimeout(hardTimeoutId);
      clearTimeout(settleTimer);
      adapter.send = rawSend;
      adapter.reply = rawReply;
      adapter.emote = rawEmote;
      activeInvocations.delete(reentrancyKey);
    }

    if (captured.length === 0) {
      return { command: commandText, response: null, message: 'No listener responded to this command.' };
    }

    return { command: commandText, response: captured.join('\n') };
  }
});
