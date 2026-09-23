#!/usr/bin/env node
// KMY Terminal araçlarını stdio MCP sunucusu olarak açar (Codex, harici Claude Code, diğer MCP istemcileri).
// Çalışan terminal sunucusu varsa çağrıları ona iletir (arayüz canlı güncellenir); yoksa yerelde çalıştırır.
//   claude mcp add borsa -- node /yol/borsa_terminal/server/mcp-stdio.js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { toolSpecs, INSTRUCTIONS, toolResult, toolError } from './agent-tools.js';
import { appPort, readToken } from './gateway.js';

const BASE = process.env.BORSA_URL || `http://127.0.0.1:${appPort()}`;

async function viaHttp(name, args) {
  const tok = process.env.BORSA_GATEWAY_TOKEN || readToken(); // Gateway anahtarı (data/gateway.json)
  const res = await fetch(`${BASE}/api/tools/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(args || {}), signal: AbortSignal.timeout(120_000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

const server = new McpServer({ name: 'borsa', version: '1.0.0' }, { instructions: INSTRUCTIONS });
for (const spec of toolSpecs()) {
  server.registerTool(spec.name, { description: spec.description, inputSchema: spec.schema, annotations: spec.readOnly ? { readOnlyHint: true } : undefined }, async (args) => {
    try {
      let data;
      try { data = await viaHttp(spec.name, args); } catch (e) {
        if (!/fetch failed|ECONNREFUSED/i.test(String(e.cause || e.message))) throw e;
        data = await spec.handler(args); // sunucu kapalı: yerel çalıştır
      }
      return toolResult(data);
    } catch (e) {
      return toolError(e);
    }
  });
}

await server.connect(new StdioServerTransport());
