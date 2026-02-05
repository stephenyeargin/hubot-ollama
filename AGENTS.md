# Agent Context Guide (AGENTS.md)

This document provides a concise, actionable reference for building agentic behavior on top of the `hubot-ollama` plugin. It maps the current architecture, tool surfaces, prompting guidelines, and recommended patterns for extending the system with robust, traceable agents.

## Purpose
- Establish shared context for future agent work: planning, tool-use, and orchestration.
- Document key interfaces and constraints so agents can operate predictably within Hubot.
- Provide guidelines for adding new tools and behaviors while keeping tests and formatting aligned.

## Architecture Overview
- Hubot script entry: `src/hubot-ollama.js` — wires Hubot commands to Ollama and tools.
- Tool registry: `src/tool-registry.js` — declares available tools and selection logic.
- Tools: `src/tools/`
  - `ollama-client.js`: local model inference via Ollama REST.
  - `web-search-tool.js`: invokes web search.
  - `web-fetch-tool.js`: fetches page content.
- Utils: `src/utils/`
  - `hubot-compat.js`: Hubot-compatible formatting and helpers.
  - `ollama-utils.js`: model helper routines (prompt shaping, config).
  - `slack-formatter.js`: Slack-safe rendering.
- Tests: `test/` — coverage for compatibility, tools, and formatting.

### Data Flow (high level)
1. Hubot receives a message (e.g., in Slack).
2. Command routed through `hubot-ollama.js` to resolve intent.
3. Tool registry determines if tools should be used (search/fetch) or direct model call.
4. Model responses are normalized and formatted for the adapter (Slack).
5. Errors are captured and converted into user-friendly messages.

### Context Management & Summarization

**Storage:** Conversation contexts are stored in `robot.brain` with TTL-based expiration.

**Data model** (per context key):
```javascript
contexts[contextKey] = {
  history: [...],          // Recent turns (verbatim)
  summary: string | null,  // Summarized older turns
  summarizedUntil: number, // Timestamp marker
  lastUpdated: number      // For TTL expiration
}
```

**Automatic summarization:**
- Keeps last 2 turns verbatim (`KEEP_RAW_TURNS = 2`, not configurable)
- Summarizes older turns when `history.length > 2` and conditions met
- Triggered async via `setImmediate()` in `storeConversationTurn()`
- Never blocks user responses; degrades gracefully on failure

**Summarization flow:**
1. Check concurrency lock (`summarizationInProgress[contextKey]`)
2. Extract turns: `turnsToSummarize = history.slice(0, -KEEP_RAW_TURNS)`
3. Build prompt (first-time or rolling update) with 600-char limit instruction
4. Call Ollama with no tools, no streaming, with timeout
5. Apply safety cap if model exceeds 650 chars (truncate to 600)
6. Replace old turns with summary, keep recent turns
7. Release lock

**Prompt assembly:**
```javascript
messages = [
  { role: 'system', content: systemPrompt },
  { role: 'system', content: `Conversation summary:\n${summary}` }, // if present
  ...recentTurns,  // last 2 turns verbatim
  { role: 'user', content: currentPrompt }
]
```

**Key functions:**
- `summarizeContext(contextKey)`: async, handles summarization with error recovery
- `getConversationHistory(msg)`: returns `{ history, summary }`
- `storeConversationTurn(msg, userPrompt, assistantResponse)`: triggers summarization

**Safety:**
- Concurrency lock prevents double-summarization
- Empty summaries are skipped
- Timeout/error → leave history untouched
- TTL expiration clears everything (summary + history)

## Agent Capabilities (today)
- Chat/inference: call local Ollama models via `ollama-client`.
- Web retrieval: search then fetch content for grounding.
- Output shaping: Slack-safe formatting and Hubot compatibility helpers.
- Deterministic tool selection via `tool-registry` patterns.

## Interaction Surfaces
- Inputs: Hubot messages, commands, optional parameters (model name, temperature, tool flags).
- Outputs: Text replies, optional rich formatting suitable for Slack.
- Events: Message received, command routed, tool executed, response sent.
- Adapters: See `test/adapters/slack.js` and `src/utils/slack-formatter.js` for Slack behaviors.

## Orchestration & Tool Use
- Prefer a simple planner: decide if retrieval (search/fetch) is needed before model call.
- Tool registry:
  - Encapsulates supported tools with stable interfaces.
  - Central location to add new tools with minimal ripple.
- Error handling:
  - Surface informative, short messages to end users.
  - Log detailed errors for debugging; avoid leaking stack traces to chat.
- Timeouts & retries:
  - Keep tool calls bounded; retry at most once with backoff for transient network failures.

## Prompting Guidelines
- System framing: keep the agent concise, safe, and helpful.
- Use short, directive prompts with clear task objectives.
- For tool use, include:
  - What is being retrieved and why.
  - Minimal constraints (timeout, max tokens, relevant sections).
- Safety:
  - Avoid generating copyrighted content or harmful material.
  - Prefer summarization/paraphrasing over verbatim reproduction of large web content.
- Traceability:
  - Note when retrieval was used and source URLs, if applicable.

## Configuration & Environment
- Models: Controlled via Ollama (e.g., `llama3`, `qwen`, etc.).
- Parameters: temperature, max tokens, and other inference settings exposed through `ollama-client`.
- Env vars:
  - Ollama server URL (default `http://localhost:11434`).
  - Optional flags for enabling tools or selecting defaults.
- Rate limits & timeouts:
  - Be mindful of Slack message pacing and tool network calls.

## Extending with New Tools
- Add a file under `src/tools/` implementing a minimal interface:
  - `name`, `invoke(params)`, lightweight validation, and error normalization.
- Register in `src/tool-registry.js` with selection rules.
- Keep dependencies small; prefer native APIs or well-known libraries.
- Add tests in `test/` for tool behavior and integration.

## Testing & Validation
- Follow existing patterns in `test/*.test.js` for:
  - Tool invocation success/failure paths.
  - Slack formatting edge cases.
  - Registry selection logic.
- Aim for quick, deterministic tests; mock external calls (web, Ollama) where possible.
- Use coverage reports in `test-results/` to spot gaps.

## Recommended Agent Patterns (near term)
- Single-agent with retrieval augmentation:
  - Heuristic: detect when queries need external context.
  - Chain: `search → fetch → summarize → answer via model`.
- Lightweight memory:
  - Session-scoped short-term notes (e.g., last URLs, last model used).
  - Avoid long-term storage until requirements are clear.
- Plan-then-act:
  - Generate a brief plan (1–3 steps), then execute.
  - Report tool usage to the user for transparency.

## Future Directions (longer term)
- Multi-agent roles:
  - Retriever, summarizer, responder; optional critic.
- Persistent memory / RAG:
  - Index project docs; ground responses in local content.
- Scheduling & tasks:
  - Queue background jobs for longer actions.
- Observability:
  - Structured logs and traces for tool execution and model calls.
- Policy & safeguards:
  - Centralize content safety checks and source attribution.

## Operational Notes
- Keep responses fast and predictable; prefer bounded pipelines.
- Fail closed on tool errors; respond with a brief explanation.
- Avoid unnecessary verbosity in user-facing messages.
- Align changes with existing style and minimal footprint; update docs when adding non-trivial behavior.

---
Maintainers can evolve this guide as new agent capabilities are added. Keep sections short, pragmatic, and aligned with tested behaviors in the repository.
