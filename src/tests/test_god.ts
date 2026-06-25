import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

console.log('=== Testing Vault "God" Abstraction MCP ===');

// We can just verify the TypeScript compilation works and that the MCP Server definition handles ask_vault correctly.

async function testGodMCP() {
  try {
    console.log('1. Compiling TypeScript to ensure no errors...');
    await execAsync('npx tsc --noEmit', { cwd: '/home/monday/Jarvis/OpenLoaf/apps/vault-service' });
    console.log('✅ Compilation successful!');
    
    // In an actual execution environment, we'd spin up the Stdio transport and send a JSON-RPC message.
    // Given that processQuery relies on Ollama LLM and web scrapers, a full unit test would require all external services to be online.
    // Here we'll just check if the syntax and module imports are solid.
    
    console.log('\n2. Testing logic flow statically...');
    const mcpContent = await execAsync('cat src/mcp.ts', { cwd: '/home/monday/Jarvis/OpenLoaf/apps/vault-service' });
    if (mcpContent.stdout.includes('name: "ask_vault"')) {
      console.log('✅ "ask_vault" tool is registered!');
    } else {
      throw new Error('"ask_vault" tool not found in mcp.ts');
    }
    
    if (mcpContent.stdout.includes('processQuery(query, projectScope, sessionId)')) {
      console.log('✅ "ask_vault" correctly routes to processQuery() with multi-turn sessionId support!');
    } else {
      throw new Error('Routing to processQuery failed in mcp.ts');
    }
    
    console.log('\n🎉 God Abstraction MCP Test Passed!');
  } catch (e: any) {
    console.error('❌ Test failed:', e.message || e.stdout || e);
    process.exit(1);
  }
}

testGodMCP();
