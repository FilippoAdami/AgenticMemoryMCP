import { processQuery } from './src/routers/query.js';
import { vaultIndexer } from './src/services/indexer.js';

async function runTests() {
  await vaultIndexer.init();
  
  console.log("\n=== TEST 1: TRIVIAL QUERY (Should NOT escalate, Should NOT save file) ===");
  const res1 = await processQuery("latest worlds cup game of portugal and ask who scored and at which minutes");
  console.log(JSON.stringify(res1, null, 2));

  console.log("\n=== TEST 2: DEEP RESEARCH QUERY (Should escalate to Deep Search and save file) ===");
  const res2 = await processQuery("who was the MVP of the 2026 World Cup final and what specific key passes did they make in the second half");
  console.log(JSON.stringify(res2, null, 2));

  process.exit(0);
}

runTests().catch(console.error);
