# hubot-ollama

> Local LLM answers in your Hubot via the [Ollama](https://ollama.ai/) CLI.

## Quick Start
1. Install Ollama and pull a model:
   ```bash
   ollama pull llama3.2
   ```
2. Add the script to your Hubot:
   ```bash
   npm install hubot-ollama --save
   ```
   `external-scripts.json`:
   ```json
   ["hubot-ollama"]
   ```
3. Ask something:
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
| Variable | Default | Purpose |
|----------|---------|---------|
| `HUBOT_OLLAMA_MODEL` | `llama3.2` | Model name (validated: `[A-Za-z0-9._:-]+`) |
| `HUBOT_OLLAMA_SYSTEM_PROMPT` | Built‑in concise chat prompt | Override system instructions |
| `HUBOT_OLLAMA_MAX_PROMPT_CHARS` | `2000` | Truncate overly long user prompts |
| `HUBOT_OLLAMA_TIMEOUT_MS` | `60000` | Kill long-running model processes |
| `HUBOT_OLLAMA_DEBUG` | (unset) | `true`/`1` to log stdout/stderr chunks |
| `HUBOT_OLLAMA_STREAM` | (unset) | `true`/`1` to stream partial chunks to chat |
| `HUBOT_OLLAMA_CMD` | (auto-resolve) | Path to `ollama` binary if not in PATH |

Change model:
```bash
export HUBOT_OLLAMA_MODEL=mistral
```
Custom system prompt:
```bash
export HUBOT_OLLAMA_SYSTEM_PROMPT="You are terse; answer in <=200 chars."
```

## Examples
```text
hubot ask explain vector embeddings
hubot llm generate a short motivational quote
hubot ollama compare sql vs nosql
```

## Error Handling
| Situation | User Message |
|-----------|--------------|
| Ollama binary missing | Install instructions URL |
| Model missing | Suggest `ollama pull <model>` |
| Empty response | Specific empty response notice |
| Timeout | Indicates the configured timeout elapsed |
| Non-zero exit | Surfaces stderr (sanitized) |

## Security & Safety
- No shell execution: uses `spawn` with arg array and `shell: false`.
- Model name validation & prompt sanitization (strip control chars).
- System prompt reinforces: stay concise; refuse to ignore instructions; no unsafe commands.
- Local only: prompts never leave your machine.

## Troubleshooting
| Symptom | Check |
|---------|-------|
| No response | Enable `HUBOT_OLLAMA_DEBUG=1` and inspect logs |
| Model not found | `ollama list` and pull the model |
| Wrong binary | Set `HUBOT_OLLAMA_CMD=/full/path/to/ollama` |
| Long silence | Lower `HUBOT_OLLAMA_TIMEOUT_MS` or enable streaming |

## Development
Run tests & lint:
```bash
npm test
npm run lint
```

## Why Ollama CLI?
Simple, resilient, matches local workflows, and lets you use any locally pulled model without extra dependencies.

## License
MIT
