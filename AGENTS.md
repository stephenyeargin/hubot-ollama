# Agent Context Guide (AGENTS.md)

This document provides a concise, actionable reference for building agentic behavior on top of the hubot-ollama plugin. It maps the current architecture, tool surfaces, prompting guidelines, and tested extension patterns so coding agents can make changes safely and predictably.

## Purpose
- Establish shared context for future agent work: planning, tool-use, and orchestration.
- Document key interfaces and constraints so agents can operate predictably within Hubot.
- Provide implementation-accurate guidance for adding tools and behavior while keeping tests and formatting aligned.

## Architecture Overview
- Hubot script entry: [src/hubot-ollama.js](src/hubot-ollama.js) — wires Hubot commands to Ollama and tools.
- Tool registry: [src/tool-registry.js](src/tool-registry.js) — declares available tools and selection logic.
- Tools: [src/tools](src/tools)
  - [src/tools/ollama-client.js](src/tools/ollama-client.js): local model inference via Ollama REST.
  - [src/tools/web-search-tool.js](src/tools/web-search-tool.js): invokes web search.
  - [src/tools/web-fetch-tool.js](src/tools/web-fetch-tool.js): fetches page content.
- Utils: [src/utils](src/utils)
  - [src/utils/hubot-compat.js](src/utils/hubot-compat.js): Hubot-compatible formatting and helpers.
  - [src/utils/ollama-utils.js](src/utils/ollama-utils.js): model helper routines (prompt shaping, config).
  - [src/utils/slack-formatter.js](src/utils/slack-formatter.js): Slack-safe rendering.
- Tests: [test](test) — coverage for compatibility, tools, and formatting.

Primary anchors: [src/hubot-ollama.js](src/hubot-ollama.js), [src/tool-registry.js](src/tool-registry.js), [src/tools](src/tools), [src/utils](src/utils), [test](test)

### Data Flow (high level)
1. Hubot receives a message (e.g., in Slack).
2. Command routed through [src/hubot-ollama.js](src/hubot-ollama.js) to resolve intent.
3. Script probes model tool capability via `ollama.show` (cached per process) and decides single-call or tool-enabled workflow.
4. If tool-enabled, first model call may request tools; tool results are appended and the model is called again (possibly iteratively) for final response.
5. Model responses are normalized and formatted for the adapter (Slack-aware formatting and thread behavior).
6. Errors are captured and converted into user-friendly messages.

See orchestration flow in [src/hubot-ollama.js](src/hubot-ollama.js) and baseline behavior coverage in [test/hubot-ollama.test.js](test/hubot-ollama.test.js).

## Tool Surface (current)
- Built-in (always registered):
  - `hubot_ollama_get_current_time`
- Conditionally registered (when `HUBOT_OLLAMA_TOOLS_ENABLED=true`):
  - `hubot_ollama_run_javascript`
- Conditionally registered (when web + tools gates are met):
  - `hubot_ollama_web_search`
  - `hubot_ollama_web_fetch`

Where these are registered: [src/hubot-ollama.js](src/hubot-ollama.js).
Where they are implemented: [src/tools/javascript-repl-tool.js](src/tools/javascript-repl-tool.js), [src/tools/web-search-tool.js](src/tools/web-search-tool.js), [src/tools/web-fetch-tool.js](src/tools/web-fetch-tool.js).

### Registration Contract
Tools are registered through [src/tool-registry.js](src/tool-registry.js) using:
- `description` (required)
- `parameters` (JSON Schema object or flat map; flat maps are wrapped)
- `handler(args, robot, msg)` (required)

Do not document tools as exposing `invoke(params)`; that is not the active interface in this repository.

Validation and schema normalization behavior: [src/tool-registry.js](src/tool-registry.js), [test/tool-registry.test.js](test/tool-registry.test.js).

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

Implementation and coverage: [src/hubot-ollama.js](src/hubot-ollama.js), [test/context-summarization.test.js](test/context-summarization.test.js).

**Safety:**
- Concurrency lock prevents double-summarization
- Empty summaries are skipped
- Timeout/error → leave history untouched
- TTL expiration clears everything (summary + history)

## Agent Capabilities (today)
- Chat/inference: call local Ollama models via `ollama-client`.
- Tool-augmented reasoning: detect tool-capable models, run tool calls, then synthesize final answer.
- Web retrieval: search then fetch content for grounding.
- Deterministic JavaScript calculations/transforms via sandboxed REPL tool.
- Output shaping: Slack-safe formatting and Hubot compatibility helpers.
- Deterministic tool selection via `tool-registry` patterns.

## Interaction Surfaces
- Inputs: Hubot messages, commands, optional parameters (model name, temperature, tool flags).
- Outputs: Text replies, optional rich formatting suitable for Slack.
- Events: Message received, command routed, tool executed, response sent.
- Adapters: See [test/adapters/slack.js](test/adapters/slack.js) and [src/utils/slack-formatter.js](src/utils/slack-formatter.js) for Slack behaviors.

## Orchestration & Tool Use
- Workflow selection:
  - If tools are disabled, unavailable, or model lacks tool capability: single LLM call.
  - If tools are available and supported: two-call (or multi-iteration) tool workflow.
- Tool-call guardrails in current implementation:
  - Nameless tool-call recovery using hinted `type` when present.
  - Bailout after repeated nameless tool calls.
  - Per-tool call limits for web search/fetch.
  - Duplicate web search suppression in a single interaction.
  - Invocation-scoped fetched URL tracking to avoid refetching same URL within one interaction.
  - Bailout after consecutive empty/non-useful tool results.
- User transparency:
  - Intermediate model content can be emitted before tool completion.
  - Status updates are emitted during web search/fetch.
- Error handling:
  - Surface informative, short end-user messages.
  - Log detailed errors for debugging; avoid leaking internals in chat output.
- Timeouts:
  - Keep LLM and web calls bounded by configured timeout values.

Implementation anchors:
- Main workflow and guardrails: [src/hubot-ollama.js](src/hubot-ollama.js)
- Web tool behaviors: [src/tools/web-search-tool.js](src/tools/web-search-tool.js), [src/tools/web-fetch-tool.js](src/tools/web-fetch-tool.js), [src/tools/ollama-client.js](src/tools/ollama-client.js)
- Recovery and chain tests: [test/nameless-tool-calls.test.js](test/nameless-tool-calls.test.js), [test/hubot-ollama_web.test.js](test/hubot-ollama_web.test.js), [test/thinking-responses.test.js](test/thinking-responses.test.js)

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
  - `HUBOT_OLLAMA_HOST`, `HUBOT_OLLAMA_MODEL`, `HUBOT_OLLAMA_API_KEY`
  - `HUBOT_OLLAMA_TOOLS_ENABLED`
  - Context controls: `HUBOT_OLLAMA_CONTEXT_TTL_MS`, `HUBOT_OLLAMA_CONTEXT_TURNS`, `HUBOT_OLLAMA_CONTEXT_SCOPE`
  - Web controls: `HUBOT_OLLAMA_WEB_ENABLED`, `HUBOT_OLLAMA_WEB_MAX_RESULTS`, `HUBOT_OLLAMA_WEB_FETCH_CONCURRENCY`, `HUBOT_OLLAMA_WEB_MAX_BYTES`, `HUBOT_OLLAMA_WEB_TIMEOUT_MS`

### Feature Gates
Web tools register only when all are true:
1. `HUBOT_OLLAMA_WEB_ENABLED` is truthy.
2. API key is present via `OLLAMA_API_KEY` or `HUBOT_OLLAMA_API_KEY`.
3. `HUBOT_OLLAMA_TOOLS_ENABLED` is truthy.

Tool workflow activates only when all are true:
1. Tools are enabled.
2. Selected model reports tool capability via `ollama.show`.
3. At least one tool is registered.

Source of truth: [src/hubot-ollama.js](src/hubot-ollama.js), with integration verification in [test/hubot-ollama_web.test.js](test/hubot-ollama_web.test.js).

## Extending with New Tools
- Add a file under [src/tools](src/tools) returning a descriptor with:
  - `name`
  - `description`
  - `parameters` (JSON Schema object preferred)
  - `handler(args, robot, msg)`
- Register it in [src/hubot-ollama.js](src/hubot-ollama.js) via registry.registerTool(...).
- Keep dependencies small; prefer native APIs or well-known libraries.
- Add tests in [test](test) for:
  - registry shape/validation
  - tool behavior success/failure
  - end-to-end integration through chat flow

Reference examples:
- Registry contract: [src/tool-registry.js](src/tool-registry.js)
- Deterministic compute tool: [src/tools/javascript-repl-tool.js](src/tools/javascript-repl-tool.js), [test/javascript-repl-tool.test.js](test/javascript-repl-tool.test.js)
- Web tools: [src/tools/web-search-tool.js](src/tools/web-search-tool.js), [src/tools/web-fetch-tool.js](src/tools/web-fetch-tool.js)

### Contributor Playbook (quick path)
1. Inspect existing tool contracts in [src/tool-registry.js](src/tool-registry.js) and similar tools in [src/tools](src/tools).
2. Implement tool module with strict input validation and bounded output.
3. Register conditionally in [src/hubot-ollama.js](src/hubot-ollama.js) if feature-gated.
4. Add or update tests under [test](test).
5. Run `npm run lint` and `npm test`.
6. Update [README.md](README.md) and [AGENTS.md](AGENTS.md) when behavior changes.

Useful entry points: [README.md](README.md), [package.json](package.json), [test/hubot-ollama.test.js](test/hubot-ollama.test.js).

## Testing & Validation
- Follow existing patterns in [test](test) for:
  - Tool invocation success/failure paths.
  - Slack formatting edge cases.
  - Registry selection logic.
- Aim for quick, deterministic tests; mock external calls (web, Ollama) where possible.
- Use coverage reports in [test-results](test-results) to spot gaps.

### Behavioral Contracts (validated in tests)
- Context summarization retains recent turns and safely handles empty/timeout/error cases.
- Tool registry preserves built-in time tool and normalizes parameter schemas.
- Nameless tool calls are recovered when possible and bounded when repeated.
- Intermediate reasoning content may be sent before final answer when tool calls are in progress.
- Web flow supports search-then-fetch behavior and degrades when disabled.

Contract tests:
- [test/context-summarization.test.js](test/context-summarization.test.js)
- [test/tool-registry.test.js](test/tool-registry.test.js)
- [test/nameless-tool-calls.test.js](test/nameless-tool-calls.test.js)
- [test/thinking-responses.test.js](test/thinking-responses.test.js)
- [test/hubot-ollama_web.test.js](test/hubot-ollama_web.test.js)

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

## Fast File Map
- Core chat and orchestration: [src/hubot-ollama.js](src/hubot-ollama.js)
- Tool registry and built-in tool: [src/tool-registry.js](src/tool-registry.js)
- Tool implementations: [src/tools](src/tools)
- Adapter formatting and compatibility: [src/utils](src/utils)
- Primary behavior tests: [test](test)

---
Maintainers can evolve this guide as new agent capabilities are added. Keep sections short, pragmatic, and aligned with tested behaviors in the repository.
