import { webScraperAgent } from './src/services/scraper.js';
import { writerAgent } from './src/services/writer.js';

async function main() {
  console.log("=== Testing Deep Search Map-Reduce Architecture ===");
  const query = "Analyze the recent advancements in solid-state battery technology specifically targeting lithium dendrite suppression, referencing breakthroughs from 2024 to 2026.";
  
  // 1. Generate Plan
  console.log("1. Generating Deep Search Plan...");
  const plan = await webScraperAgent.generateDeepSearchPlan(query, []);
  console.log("PLAN GENERATED:\n", JSON.stringify(plan, null, 2));

  // 2. Map Phase (Scrape, Chunk, Embed, Filter)
  console.log("\n2. Executing Map Phase (Scraping, Chunking, Embedding Filtering)...");
  const chunks = await webScraperAgent.executeDeepSearchMapReduce(plan);
  console.log(`\nMap Phase Complete! Retained ${chunks.length} highly relevant, non-duplicate chunks.`);
  if(chunks.length > 0) {
    console.log("\nSample Top Chunk Retained:");
    console.log(`URL: ${chunks[0].url}\nScore: ${chunks[0].score}\nText: ${chunks[0].text.substring(0, 150)}...`);
  }

  // 3. Reduce Phase (Markdown Synthesis with Citations)
  console.log("\n3. Executing Reduce Phase (LLM Synthesis & Inline Citations)...");
  const markdown = await writerAgent.deepSearchReducePhase(query, chunks);
  console.log("\n========== FINAL ZETTELKASTEN MARKDOWN ==========\n");
  console.log(markdown);
  console.log("\n=================================================");
  
  process.exit(0);
}

main().catch(console.error);
