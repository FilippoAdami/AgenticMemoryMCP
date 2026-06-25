import { webScraperAgent } from './src/services/scraper.js';
import { writerAgent } from './src/services/writer.js';
import { vaultIndexer } from './src/services/indexer.js';

async function testStandard() {
  console.log("=== STARTING STANDARD SEARCH TEST ===");
  const query = "latest worlds cup game of portugal and ask who scored and at which minutes";
  const results = await webScraperAgent.standardSearch(query);
  console.log("Standard Search Results Length:", results.length);
  console.log("RAW STANDARD SEARCH DATA EXTRACTED:\n", results.substring(0, 1000) + "...\n");
  await writerAgent.processNewInformation(query, results, "DuckDuckGo Standard Search");
  console.log("=== STANDARD TEST COMPLETE ===\n");
}

async function testDeep() {
  console.log("=== STARTING DEEP SEARCH TEST ===");
  const query = "electrolytes professional report about what they are, what they do";
  const results = await webScraperAgent.deepSearch(query);
  console.log("Deep Search Results Length:", results.length);
  await writerAgent.processNewInformation(query, results, "Puppeteer Deep Search");
  console.log("=== DEEP TEST COMPLETE ===\n");
}

async function run() {
  try {
    await vaultIndexer.init();
    await testStandard();
    console.log("ALL TESTS COMPLETED SUCCESSFULLY.");
    process.exit(0);
  } catch (e) {
    console.error("Test failed:", e);
    process.exit(1);
  }
}

run();
