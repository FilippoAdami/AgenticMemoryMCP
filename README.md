# Monday Vault Service

The **Monday Vault Service** is an autonomous, agentic web-scraping and knowledge orchestration engine. It acts as a "smart librarian" that receives queries, determines their complexity, and uses advanced web scraping and Large Language Models (LLMs) to retrieve, evaluate, and persist high-quality research notes directly into your Obsidian/Zettelkasten vault.

## Architecture & Smart Search Orchestration

The Monday Vault uses a state-of-the-art multi-tier agentic routing loop for handling queries, leveraging iterative problem solving and Map-Reduce architecture:

1. **Iterative Standard Search:** Fast query handling using a private, local SearXNG instance. The service dynamically identifies missing information and generates strategic follow-up queries (up to 5 iterations) to fill knowledge gaps.
2. **Evaluation & Vault Integration:** A local LLM acts as an evaluator to determine if the answer is definitive and whether it's worth saving to the Vault. Trivial transient information is answered instantly and routed back to the user without cluttering the vault.
3. **Interactive Deep Search Planner:** If Standard Search fails, the orchestrator escalates to **Deep Search**. It first generates an execution plan and pauses to ask the user for approval via an intent-aware conversational loop (supporting Approve, Tweak, Abort, or Revert intents).
4. **Map-Reduce Execution:** Once approved, the system executes the Deep Search:
   - **Map Phase:** Crawls multiple URLs, extracts text, chunks it (~250 words), and filters them using strict embedding-based semantic relevance (>0.69 cosine similarity) and de-duplication (<0.80 similarity).
   - **Reduce Phase:** Aggregates the filtered chunks and uses the LLM to synthesize a deeply researched Zettelkasten note in Markdown, fully cited with in-line links and a formatted references section.

## Technologies Used

- **SearXNG:** Self-hosted meta-search engine for private, unrestricted web querying.
- **Puppeteer & Readability:** For stealthy, accurate web scraping and article text extraction.
- **LanceDB:** For local vector storage and semantic chunking map-phase filters.
- **Ollama / Local LLMs:** For query routing, intent classification, and Markdown generation.
- **Hono & TypeScript:** For the robust, stateful REST API.

## API Endpoints

### `POST /api/query`
The primary entry point for all research questions. It supports conversational state via `sessionId` for Deep Search planning.

**Initial Request:**
```json
{
  "query": "Who scored the goals in Portugal vs Uzbekistan 2026?"
}
```

**Planner Response (Stateful):**
```json
{
  "status": "WAITING_FOR_USER_PLAN_APPROVAL",
  "plan": [
    { "query": "Portugal vs Uzbekistan 2026 timeline of events", "goal": "Find exact goal scorers" }
  ],
  "sessionId": "session_12345"
}
```

## Setup & Running

1. **Start Services via Docker:**
   Ensure Docker is running, then spin up the service:
   ```bash
   docker compose up -d
   ```
   This will start both `vault-service` (port 8081) and its local `searxng` instance (port 8080) in a shared network. The service automatically mounts your local Obsidian vault from `/home/monday/Documents/MondayVault` into the container.

2. **Configure Environment Variables:**
   You can copy the variables and override defaults (like `VAULT_PATH` or `GATEWAY_URL`) in a local `.env` file.

## Testing

You can verify the search orchestrators locally:

1. **Test Standard Iterative Search & Intent Routing API:**
   ```bash
   node test.mjs
   ```
2. **Test Deep Search Map-Reduce Pipeline:**
   ```bash
   npx tsx test_deep.ts
   ```

## License

This project is licensed under the **MIT License**.
