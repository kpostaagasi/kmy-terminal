#!/usr/bin/env node
// kmy terminal araçlarını stdio MCP sunucusu olarak açar (Codex, harici Claude Code, diğer MCP istemcileri).
// Çalışan terminal sunucusu varsa çağrıları ona iletir (arayüz canlı güncellenir); yoksa yerelde çalıştırır.
//   claude mcp add borsa -- node /yol/kmy-terminal/server/mcp-stdio.js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { toolSpecs, INSTRUCTIONS, toolResult, toolError, runTool } from './agent-tools.js';
import { appPort, readToken } from './gateway.js';

const BASE = process.env.BORSA_URL || `http://127.0.0.1:${appPort()}`;
// Alt süreçler (Codex/omp/Claude) kapsamlı jetonla gelir; master anahtar hiçbir çocuk sürece geçmez.
// KMY_SCOPED_TOKEN yoksa harici istemci davranışı korunur (BORSA_GATEWAY_TOKEN veya data/gateway.json).
const SCOPED = process.env.KMY_SCOPED_TOKEN || null;
const MODE = process.env.KMY_PERMISSION_MODE || 'default';

async function viaHttp(name, args) {
  const tok = SCOPED || process.env.BORSA_GATEWAY_TOKEN || readToken();
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
        // Sunucu kapalıysa ya da kapsamlı jeton reddedildiyse yerelde çalıştır (izin kipi KMY_PERMISSION_MODE)
        const local = /fetch failed|ECONNREFUSED/i.test(String(e.cause || e.message)) || (SCOPED && /HTTP 40[13]/.test(String(e.message)));
        if (!local) throw e;
        const r = await runTool(spec.name, args, () => {}, SCOPED ? { mode: MODE, via: 'stdio' } : {});
        if (r?.isError) return r; // izin kapısı reddetti
        data = r;
      }
      return toolResult(data);
    } catch (e) {
      return toolError(e);
    }
  });
}

await server.connect(new StdioServerTransport());
