# priime-demo subgraph — AI agent SKILL

This SKILL lets a Subgraph-MCP-aware AI agent (Claude Desktop, Cursor, ChatGPT with an MCP client, etc.) query the `PriimeVault` subgraph in natural language.

## What the agent gets

A live GraphQL endpoint indexing the WAVS-attested ERC-7540 vault on Base. Natural language questions the agent can answer against it:

- "What NAV has the vault attested in its latest strike?"
- "Show me every plan-rejection this vault ever had, with the reason bytes."
- "Compare deposits vs redemptions over the last 30 days."
- "Which strikes had `breachFlags != 0`?"
- "How many strikes has this vault attested and what's the median gap between them?"

The schema follows the ERC-4626 / Messari Standardized Vault shape, so the same query patterns work against any tokenized vault indexed under the same conventions.

## Endpoint

Studio (development):

```
https://api.studio.thegraph.com/query/1755125/priime-demo/v0.0.1
```

## MCP client configuration

Add this to your MCP client's config (`~/.config/claude-desktop/config.json` for Claude Desktop, `.cursor/mcp.json` for Cursor, or the equivalent for whatever agent you use):

```json
{
  "mcpServers": {
    "subgraph": {
      "command": "npx",
      "args": ["-y", "@graphprotocol/subgraph-mcp"],
      "env": {
        "SUBGRAPH_ENDPOINT": "https://api.studio.thegraph.com/query/1755125/priime-demo/v0.0.1"
      }
    }
  }
}
```

Restart the client. The agent now has a `subgraph.query` tool it can call with plain-English asks — the MCP server handles the natural-language-to-GraphQL translation and hits the endpoint.

## Verifying the wiring

Ask the agent: "Using the subgraph tool, tell me the vault's latest NAV and update count." The response should quote the numbers pulled straight from the endpoint above, not from memory.

For a manual sanity check without the agent:

```bash
curl -s https://api.studio.thegraph.com/query/1755125/priime-demo/v0.0.1 \
  -H 'content-type: application/json' \
  -d '{"query":"{ vaults { id lastNav updateCount } _meta { block { number } hasIndexingErrors } }"}' | jq
```

## Composition

Two Graph products interacting through one shared schema: (1) a Subgraph deployed to Studio, indexing the vault against a standardized ERC-4626 / Priime schema; (2) the Subgraph MCP layered on top, exposing that subgraph to any MCP-aware AI agent as a first-class tool.
