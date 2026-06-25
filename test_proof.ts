import { processQuery } from './src/routers/query.js';
import { vaultIndexer } from './src/services/indexer.js';
import * as fs from 'fs';
import * as path from 'path';

async function runTests() {
  await vaultIndexer.init();
  
  console.log("\n=======================================================");
  console.log("=== TEST 1: TRIVIAL QUERY (Should NOT save file)    ===");
  console.log("=======================================================");
  const res1 = await processQuery("latest worlds cup game of portugal and ask who scored and at which minutes");
  console.log("\n[TEST 1 RESULT]:");
  console.log(JSON.stringify(res1, null, 2));

  console.log("\n=======================================================");
  console.log("=== TEST 2: DEEP RESEARCH (Should save a report)    ===");
  console.log("=======================================================");
  const res2 = await processQuery("please provide a professional report about electrolytes, what they are, what they do, etcetera");
  console.log("\n[TEST 2 RESULT]:");
  console.log(JSON.stringify(res2, null, 2));

  if (res2.data && res2.data.file) {
    console.log("\n[TEST 2 GENERATED FILE CONTENT]:");
    const content = fs.readFileSync(res2.data.file, 'utf-8');
    console.log(content.substring(0, 1500) + "\n\n... (truncated for brevity)");
  }

  process.exit(0);
}

runTests().catch(console.error);
