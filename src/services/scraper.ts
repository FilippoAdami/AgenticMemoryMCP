import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { vaultIndexer } from './indexer.js';

puppeteer.use(StealthPlugin());

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:11434/v1';

async function callLLM(systemPrompt: string, userPrompt: string, jsonMode = false) {
  const response = await fetch(`${GATEWAY_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemma4-12b-q4km-8k',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      options: { num_ctx: 32000 },
      temperature: 0.7,
      response_format: jsonMode ? { type: 'json_object' } : undefined
    })
  });

  if (!response.ok) throw new Error(`LLM Error: ${response.statusText}`);
  const data = await response.json();
  return data.choices[0].message.content;
}

export class WebScraperAgent {
  
  private async generateSubQueries(originalQuery: string, count: number): Promise<string[]> {
    const prompt = `You are an expert web researcher. Generate exactly ${count} highly diverse search engine queries to comprehensively investigate the following topic.
    Respond ONLY with a JSON object containing an array of strings under the key "queries".
    Example: {"queries": ["query 1", "query 2"]}`;
    
    try {
      const res = await callLLM(prompt, originalQuery, true);
      const parsed = JSON.parse(res);
      return parsed.queries.slice(0, count);
    } catch (e) {
      console.error('[SCRAPER] Failed to generate subqueries. Using original.', e);
      return [originalQuery];
    }
  }

  private async performSearch(query: string): Promise<{title: string, url: string, snippet: string}[]> {
    try {
      const searxngUrl = process.env.SEARXNG_URL || 'http://localhost:8080';
      const response = await fetch(`${searxngUrl}/search?q=${encodeURIComponent(query)}&format=json`);
      if (!response.ok) throw new Error(`SearXNG Error: ${response.status}`);
      const data = await response.json();
      return (data.results || []).map((r: any) => ({
        title: r.title || '',
        url: r.url || '',
        snippet: r.content || ''
      })).slice(0, 10);
    } catch (e) {
      console.error('[SCRAPER] SearXNG search failed:', e);
      return [];
    }
  }

  async standardSearch(query: string): Promise<string> {
    console.log(`[SCRAPER] Executing Standard Search for: ${query}`);
    const subQueries = await this.generateSubQueries(query, 3);
    console.log(`[SCRAPER] Subqueries generated:`, subQueries);

    let allResults: any[] = [];
    for (const q of subQueries) {
      const results = await this.performSearch(q);
      allResults = allResults.concat(results.slice(0, 5));
    }

    const uniqueResults = Array.from(new Map(allResults.map(item => [item.url, item])).values());
    
    let topPageContent = '';
    if (uniqueResults.length > 0) {
      const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
      let fetchedCount = 0;
      for (let i = 0; i < uniqueResults.length && fetchedCount < 2; i++) {
        console.log(`[SCRAPER] Standard Search: Fetching article content from ${uniqueResults[i].url}`);
        try {
          const page = await browser.newPage();
          await page.goto(uniqueResults[i].url, { waitUntil: 'domcontentloaded', timeout: 8000 });
          const html = await page.content();
          const dom = new JSDOM(html, { url: uniqueResults[i].url });
          const reader = new Readability(dom.window.document);
          const article = reader.parse();
          if (article && article.textContent && article.textContent.trim().length > 100) {
             topPageContent += `\n\n=== ARTICLE FULL TEXT (${uniqueResults[i].url}) ===\n${article.textContent.substring(0, 4000)}`;
             fetchedCount++;
          }
          await page.close();
        } catch(e) {
          console.warn(`[SCRAPER] Failed to fetch article:`, (e as Error).message);
        }
      }
      await browser.close();
    }

    return uniqueResults.map(r => `SOURCE: ${r.title}\nURL: ${r.url}\nSUMMARY: ${r.snippet}`).join('\n\n---\n\n') + topPageContent;
  }

  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
    }
    return dotProduct;
  }

  async generateDeepSearchPlan(query: string, history: string[] = []): Promise<any> {
    const prompt = `You are a Deep Research Planner. The user wants to research: "${query}".
    Conversation History: ${history.join(' | ')}
    Generate a JSON plan with an array of "queries". Each query should have a specific "goal".
    Determine the optimal number of queries (1 to 5).
    Format ONLY as JSON: {"plan": [{"query": "exact search query", "goal": "what to extract"}]}`;
    
    try {
      const res = await callLLM(prompt, query, true);
      const parsed = JSON.parse(res);
      return parsed.plan || [];
    } catch (e) {
      return [{ query, goal: "General overview" }];
    }
  }

  async executeDeepSearchMapReduce(plan: any[]): Promise<any[]> {
    console.log(`[SCRAPER] Executing Deep Search Map Phase for plan:`, plan);
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    
    let allRetainedChunks: {text: string, title: string, url: string, score: number}[] = [];

    for (const step of plan) {
      console.log(`[SCRAPER] Running Map Phase for query: ${step.query}`);
      const results = await this.performSearch(step.query);
      const topUrls = results.slice(0, 5).map(r => r.url);
      
      let queryTokens = 0;
      let sitesScraped = 0;
      const queryEmbedding = await vaultIndexer.getEmbedding(step.query + " " + step.goal);

      for (const url of topUrls) {
        if (sitesScraped >= 5 || queryTokens >= 20000) break;
        
        try {
          const page = await browser.newPage();
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8000 });
          const html = await page.content();
          await page.close();

          const dom = new JSDOM(html, { url });
          const reader = new Readability(dom.window.document);
          const article = reader.parse();

          if (article && article.textContent) {
            sitesScraped++;
            // Split into paragraphs / ~250 words
            const words = article.textContent.replace(/\s+/g, ' ').split(' ');
            const chunks = [];
            for (let i = 0; i < words.length; i += 200) {
              chunks.push(words.slice(i, i + 200).join(' '));
            }

            for (const chunk of chunks) {
              if (chunk.length < 50) continue;
              if (queryTokens >= 20000) break;

              const vec = await vaultIndexer.getEmbedding(chunk);
              const sim = this.cosineSimilarity(queryEmbedding, vec);

              if (sim > 0.69) {
                // De-duplication check
                let isDup = false;
                for (const retained of allRetainedChunks) {
                  const retainedVec = await vaultIndexer.getEmbedding(retained.text);
                  if (this.cosineSimilarity(vec, retainedVec) > 0.80) {
                    isDup = true;
                    break;
                  }
                }
                
                if (!isDup) {
                  allRetainedChunks.push({ text: chunk, title: article.title || '', url, score: sim });
                  queryTokens += Math.ceil(chunk.length / 4); // rough token estimate
                }
              }
            }
          }
        } catch (e) {
          console.warn(`[SCRAPER] Failed to map ${url}:`, (e as Error).message);
        }
      }
    }
    
    await browser.close();
    
    // Sort by relevance across all steps
    allRetainedChunks.sort((a, b) => b.score - a.score);
    return allRetainedChunks;
  }
}

export const webScraperAgent = new WebScraperAgent();
