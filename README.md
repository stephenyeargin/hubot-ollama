# hubot-ollama

[![Node CI](https://github.com/stephenyeargin/hubot-ollama/actions/workflows/nodejs.yml/badge.svg)](https://github.com/stephenyeargin/hubot-ollama/actions/workflows/nodejs.yml)

> Hubot script for integrating with [Ollama](https://ollama.ai/) - run local or cloud LLMs in your chat.

## Quick Start
1. Install Ollama and pull a model:
   ```bash
   # Install Ollama from https://ollama.com
   ollama pull llama3.2
   # Ollama server starts automatically after installation
   ```
2. Add this package to your Hubot:
   ```bash
   npm install hubot-ollama --save
   ```
   Then add to `external-scripts.json`:
   ```json
   ["hubot-ollama"]
   ```
3. Start chatting:
   ```text
   hubot ask what is an LLM?
   hubot ollama explain async/await
   hubot llm write a haiku about databases
   ```

## Commands
| Pattern | Example | Notes |
|---------|---------|-------|
| `hubot ask <prompt>` | `hubot ask what is caching?` | Primary documented command |
| `hubot ollama <prompt>` | `hubot ollama summarize HTTP` | Alias |
| `hubot llm <prompt>` | `hubot llm list json benefits` | Alias |

Prompts are sanitized and truncated if they exceed the configured limit.

## Configuration
| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `HUBOT_OLLAMA_MODEL` | Optional | `llama3.2` | Model name (validated: `[A-Za-z0-9._:-]+`) |
| `HUBOT_OLLAMA_HOST` | Optional | `http://127.0.0.1:11434` | Ollama server URL |
| `HUBOT_OLLAMA_API_KEY` | Optional | (unset) | API key for [Ollama cloud](https://ollama.com/settings/keys) access |
| `HUBOT_OLLAMA_SYSTEM_PROMPT` | Optional | Built‑in concise chat prompt | Override system instructions |
| `HUBOT_OLLAMA_MAX_PROMPT_CHARS` | Optional | `2000` | Truncate overly long user prompts |
| `HUBOT_OLLAMA_TIMEOUT_MS` | Optional | `60000` (60 sec) | Abort request after this duration |
| `HUBOT_OLLAMA_STREAM` | Optional | `false` | Stream partial chunks to chat (`true`/`1` to enable) |
| `HUBOT_OLLAMA_CONTEXT_TTL_MS` | Optional | `600000` (10 min) | Time to maintain conversation history; `0` to disable |
| `HUBOT_OLLAMA_CONTEXT_TURNS` | Optional | `5` | Maximum number of conversation turns to remember |
| `HUBOT_OLLAMA_CONTEXT_SCOPE` | Optional | `room-user` | Context isolation: `room-user`, `room`, or `thread` |
| `HUBOT_OLLAMA_WEB_ENABLED` | Optional | `false` | Enable web-assisted workflow that can search/fetch context |
| `HUBOT_OLLAMA_WEB_MAX_RESULTS` | Optional | `5` | Max search results to use (capped at 10) |
| `HUBOT_OLLAMA_WEB_FETCH_CONCURRENCY` | Optional | `3` | Parallel fetch concurrency |
| `HUBOT_OLLAMA_WEB_MAX_BYTES` | Optional | `120000` | Max bytes per fetched page used in context |
| `HUBOT_OLLAMA_WEB_TIMEOUT_MS` | Optional | `45000` | Timeout for the web phase per fetch |

Change model:
```bash
export HUBOT_OLLAMA_MODEL=mistral
```
Connect to remote Ollama server:
```bash
export HUBOT_OLLAMA_HOST=http://my-ollama-server:11434
```
Enable streaming responses (sends chunks as they arrive):
```bash
export HUBOT_OLLAMA_STREAM=true
```
Use Ollama cloud (requires [API key](https://ollama.com/settings/keys)):
```bash
export HUBOT_OLLAMA_HOST=https://ollama.com
export HUBOT_OLLAMA_API_KEY=your_api_key
export HUBOT_OLLAMA_MODEL=gpt-oss:120b  # Use a cloud model
```
Custom system prompt:
```bash
export HUBOT_OLLAMA_SYSTEM_PROMPT="You are terse; answer in <=200 chars."
```
Adjust conversation memory:
```bash
# Keep 10 turns for 30 minutes, shared across the room
export HUBOT_OLLAMA_CONTEXT_TURNS=10
export HUBOT_OLLAMA_CONTEXT_TTL_MS=1800000
export HUBOT_OLLAMA_CONTEXT_SCOPE=room
```

## Examples
```text
hubot ask explain vector embeddings
hubot llm generate a short motivational quote
hubot ollama compare sql vs nosql
```

### Web-Enabled Workflow
When `HUBOT_OLLAMA_WEB_ENABLED=true` and the connected Ollama host supports web tools, the bot will:
- Ask the model if a web search is necessary (recency/specificity check).
- If needed: generate concise search terms, perform `webSearch`, fetch top results in parallel, synthesize a compact context block, and include it before the final analysis.
- Send a status message indicating the search step.
- Save fetched context to conversation history to avoid re-fetching next turn.

Enable:
```bash
export HUBOT_OLLAMA_WEB_ENABLED=true
export HUBOT_OLLAMA_WEB_MAX_RESULTS=5
export HUBOT_OLLAMA_WEB_FETCH_CONCURRENCY=3
export HUBOT_OLLAMA_WEB_MAX_BYTES=120000
export HUBOT_OLLAMA_WEB_TIMEOUT_MS=45000
```

### Conversation Context
Hubot remembers recent exchanges within the configured scope, allowing natural follow-up questions:

```text
alice> hubot ask what are the planets in our solar system?
hubot> Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune.

alice> hubot ask which is the largest?
hubot> Jupiter is the largest planet in our solar system.
```

**Context Scopes:**
- `room-user` (default): Each user has separate conversation history per room
- `room`: All users in a room share the same conversation history
- `thread`: Separate history per thread (for Slack-style threading)

Context automatically expires after the configured TTL (default 10 minutes). Set `HUBOT_OLLAMA_CONTEXT_TTL_MS=0` to disable conversation memory entirely.

## Ollama Cloud

This package supports [Ollama's cloud service](https://ollama.com/cloud), which allows you to run larger models that wouldn't fit on your local machine. Cloud models are accessed via the same API but run on Ollama's infrastructure.

### Setup

1. Create an account at [ollama.com](https://ollama.com/signup)
2. Generate an [API key](https://ollama.com/settings/keys)
3. Run `ollama signin` to register the host with Ollama.com
4. Configure your environment:
   ```bash
   export HUBOT_OLLAMA_HOST=https://ollama.com
   export HUBOT_OLLAMA_API_KEY=your_api_key
   export HUBOT_OLLAMA_MODEL=gpt-oss:120b
   ```

### Available Cloud Models

See the [cloud models list](https://ollama.com/search?c=cloud) for available models. Popular options include:
- `gpt-oss:120b` - Large open-source GPT model
- Other cloud-enabled models tagged with `-cloud`

**Note:** Cloud models require network connectivity and count against your cloud usage. Local models remain free and private.

## Error Handling
| Situation | User Message |
|-----------|------------|
| Ollama server unreachable | Cannot connect to Ollama server message |
| Model missing | Suggest `ollama pull <model>` |
| Empty response | Specific empty response notice |
| Timeout | Indicates the configured timeout elapsed |
| API error | Surfaces error message |

## Security & Safety
- Uses official Ollama JavaScript library with proper API communication.
- Model name validation & prompt sanitization (strip control chars).
- System prompt reinforces: stay concise; refuse to ignore instructions; no unsafe commands.
- Local only by default: prompts never leave your machine unless using remote host.

## Troubleshooting
| Symptom | Check |
|---------|-------|
| No response | Check Hubot logs for errors; verify Ollama server is accessible |
| Connection refused | Ensure Ollama server is running (`ollama serve` or daemon) |
| Model not found | Run `ollama list` to see available models, then `ollama pull <model>` |
| Wrong server | Set `HUBOT_OLLAMA_HOST=http://your-server:11434` |
| Long delays | Lower `HUBOT_OLLAMA_TIMEOUT_MS` or enable streaming with `HUBOT_OLLAMA_STREAM=true` |
| Web tools not running | The connected Ollama host must support `webSearch`/`webFetch`; feature auto-skips when unavailable |
| No search performed | The model decided a web search was unnecessary; disable web workflow or ask explicitly |
| `Error: unauthorized` | If using a cloud model, you must run `ollama signin` to register the host |
| Other cloud auth issues | Verify your `HUBOT_OLLAMA_API_KEY` is valid at [ollama.com/settings/keys](https://ollama.com/settings/keys) |

## Development
Run tests & lint:
```bash
npm test
npm run lint
```

## License
MIT
