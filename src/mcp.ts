/**
 * MCP server for the Steve Momentum agent (OOBE Synapse SDK).
 *
 * Exposes the OOBE SynapseAgentKit (Token / DeFi / Misc plugins — 85 tools)
 * as a spec-compliant MCP server over stdio (default) or SSE (--port).
 * The agent's own paper-trading tools live in the CLI (backtest/live) and
 * are described in README.md; this server is the OOBE tool surface the
 * agent itself is built on: any MCP client can discover and call the same
 * Solana tools the agent uses for market data and protocol reads.
 *
 * No private keys, no signing. Tools that would move funds are never
 * executed by this agent — it only reads.
 */
import { SynapseAgentKit, TokenPlugin, DeFiPlugin, MiscPlugin } from '@oobe-protocol-labs/synapse-client-sdk/ai/plugins';
import { SynapseMcpServer } from '@oobe-protocol-labs/synapse-client-sdk/ai/mcp';

export function buildKit(): SynapseAgentKit {
  return new SynapseAgentKit({ rpcUrl: process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com' })
    .use(TokenPlugin)
    .use(DeFiPlugin)
    .use(MiscPlugin);
}

export async function runMcpServer(_port: number): Promise<void> {
  const kit = buildKit();
  const summary = kit.summary() as { totalTools?: number };
  console.error(`[mcp] SynapseAgentKit ready: ${summary.totalTools ?? '?'} tools (Token/DeFi/Misc)`);
  const server = new SynapseMcpServer(kit, {
    name: 'steve-momentum-agent',
    version: '1.0.0',
  });
  // stdio transport only: `startSse` is private in SDK 2.0.6, so SSE is
  // not available from outside the class. stdio works with Claude
  // Desktop, Cursor, VS Code and any MCP client.
  console.error('[mcp] starting stdio transport');
  await server.start();
}
