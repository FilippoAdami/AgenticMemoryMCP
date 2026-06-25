import * as fs from 'fs';
import * as path from 'path';
import { vaultIndexer } from './indexer.js';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:11434/v1';
const VAULT_PATH = process.env.VAULT_PATH || path.join(process.env.HOME || '', 'Documents', 'MondayVault');

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
      temperature: 0.2,
      response_format: jsonMode ? { type: 'json_object' } : undefined
    })
  });

  if (!response.ok) {
    throw new Error(`LLM Error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

export class WriterAgent {
  /**
   * Evaluates if the retrieved information answers the query, extracts the answer, and decides if it's worth saving.
   */
  async evaluateData(query: string, rawData: string): Promise<{ answered: boolean; answer: string; missing_fields?: string; suggested_query?: string; worthSaving: boolean }> {
    const prompt = `You are Monday. Evaluate the provided web search data against the user's query.
    1. Determine if the data contains a definitive answer to the query. If it's missing crucial details, set "answered" to false.
    2. Extract the exact answer. If "answered" is false, explain what is missing.
    3. If "answered" is false, identify EXACTLY what is missing ("missing_fields") and provide a strategic "suggested_query" to find it. Be smart: if asking for goal scorers of a match, the query should target "timeline of events" or "match highlights".
    4. Evaluate if this query and answer are worth saving to a long-term Zettelkasten knowledge base. 
       - CRITICAL RULE: If the query is primarily asking for sports match results, goals, player statistics, or current weather, you MUST set "worthSaving" to false.
    
    Respond with ONLY valid JSON:
    {
      "answered": true|false,
      "answer": "extracted answer or explanation of missing info",
      "missing_fields": "what is missing (if answered is false)",
      "suggested_query": "smart follow up query to find the missing info",
      "worthSaving": true|false
    }`;
    
    try {
      const res = await callLLM(prompt, `Query: ${query}\nData: ${rawData}`, true);
      return JSON.parse(res);
    } catch (e) {
      console.error('WriterAgent: evaluateData failed.', e);
      return { answered: false, answer: 'Failed to evaluate.', worthSaving: false };
    }
  }

  /**
   * Synthesizes the raw data into a perfectly cited, YAML-frontmatter-compliant Markdown note.
   * Avoids duplication by reviewing existing vault context.
   */
  async draftNote(query: string, rawData: string, sourceUrl: string = "Web Search"): Promise<string | null> {
    // 1. Run RAG to check existing vault context and prevent duplication
    const existingChunks = await vaultIndexer.search(query, undefined, 5) || [];
    const existingContext = Array.isArray(existingChunks) ? existingChunks.map((c: any) => c.text).join('\n---\n') : '';

    // Calculate similarity based on L2 distance squared (LanceDB default)
    // Cosine similarity = 1 - (L2^2 / 2) for normalized vectors
    const similarFiles = Array.isArray(existingChunks) ? existingChunks
      .filter((c: any) => (1 - (c._distance / 2)) > 0.69)
      .map((c: any) => c.fileId.replace('.md', '')) : [];
    
    const uniqueLinks = [...new Set(similarFiles)].map(f => `[[${f}]]`);
    const linksPrompt = uniqueLinks.length > 0 
      ? `\n    6. CRITICAL: You MUST natively integrate the following related WikiLinks into the body of the text where appropriate: ${uniqueLinks.join(', ')}` 
      : `\n    6. Use Obsidian wikilinks [[Like This]] for important concepts.`;

    // 2. Prepare the strict drafting prompt
    const systemPrompt = `You are the Writer Sub-Agent for MondayVault. Your job is to curate new information into atomic Markdown notes.
    
    Rules:
    1. NEVER duplicate information that already exists in the provided EXISTING VAULT CONTEXT.
    2. Write the note using strict Markdown.
    3. You MUST include this exact YAML frontmatter at the top of the file:
    ---
    id: {GENERATE_A_TIMESTAMP_LIKE_20260623-120000}
    title: "{A concise, descriptive title}"
    aliases: []
    tags: ["#ai/generated", "#research"]
    created: {CURRENT_TIMESTAMP_ISO}
    modified: {CURRENT_TIMESTAMP_ISO}
    author: "WriterSubAgent"
    project: "MondayVault"
    confidence: 0.95
    sources:
      - title: "Source Title 1"
        url: "https://source1.com"
      - title: "Source Title 2"
        url: "https://source2.com"
    summary: "{A 2-sentence summary for highly token-efficient LLM context injection}"
    ---
    
    4. CITE ALL CLAIMS using inline Markdown links to the exact URLs provided in the raw data (e.g., [According to Source Title](https://example.com)). DO NOT use ambiguous bracketed numbers like "[Source 1]".
    5. Be concise and deeply factual.
    6. NEVER invent [[WikiLinks]] for topics unless you are absolutely certain they already exist in the EXISTING VAULT CONTEXT. If a topic is new, just write it as normal text without brackets.${linksPrompt}
    7. EXPLICITLY ANSWER THE ORIGINAL USER QUERY. Your primary goal is to answer the specific question asked by the user. If the raw data does not contain the exact answer, state that clearly.
    
    EXISTING VAULT CONTEXT:
    ${existingContext || 'None.'}`;

    try {
      console.log('[WRITER] Drafting new note based on web search results...');
      const markdown = await callLLM(systemPrompt, `Original User Query: ${query}\n\nRaw Data to synthesize: ${rawData}`);
      return markdown;
    } catch (e) {
      console.error('WriterAgent: Failed to draft note.', e);
      return null;
    }
  }

  /**
   * Saves the markdown string to the Vault and immediately indexes it into LanceDB.
   */
  async saveAndIndex(markdown: string): Promise<string | null> {
    try {
      // Extract title from YAML or fallback
      const titleMatch = markdown.match(/title:\s*"(.*?)"/);
      const safeTitle = titleMatch ? titleMatch[1].replace(/[^a-z0-9]/gi, '_').toLowerCase() : `note_${Date.now()}`;
      
      const fileName = `${safeTitle}.md`;
      // Write to the 30-Resources/Sources directory
      const targetDir = path.join(VAULT_PATH, '30-Resources', 'Sources');
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      
      const filePath = path.join(targetDir, fileName);
      fs.writeFileSync(filePath, markdown, 'utf-8');
      console.log(`[WRITER] Saved new note to: ${filePath}`);

      // Instantly index the new file for future queries
      await vaultIndexer.indexDocument(fileName, 'MondayVault', markdown);
      console.log(`[WRITER] Note indexed successfully in LanceDB.`);
      
      return filePath;
    } catch (e) {
      console.error('WriterAgent: Failed to save and index note.', e);
      return null;
    }
  }

  async deepSearchReducePhase(query: string, chunks: {text: string, title: string, url: string, score: number}[]): Promise<string> {
    const formattedChunks = chunks.map((c, i) => `[${i + 1}] SOURCE: ${c.title}\nURL: ${c.url}\nCONTENT: ${c.text}`).join('\n\n');
    
    const systemPrompt = `You are the Deep Search Reducer for MondayVault. Your job is to curate extracted facts into a comprehensive, highly accurate Zettelkasten note.
    
    Rules:
    1. Write the note using strict Markdown.
    2. You MUST include this exact YAML frontmatter at the top of the file:
    ---
    id: {GENERATE_A_TIMESTAMP_LIKE_20260623-120000}
    title: "{A concise, descriptive title}"
    aliases: []
    tags: ["#ai/generated", "#deep-search"]
    created: {CURRENT_TIMESTAMP_ISO}
    modified: {CURRENT_TIMESTAMP_ISO}
    author: "WriterSubAgent"
    project: "MondayVault"
    confidence: 0.95
    summary: "{A 2-sentence summary}"
    ---
    
    3. CITE ALL CLAIMS strictly using bracketed numbers corresponding to the chunk index, e.g., [1], [2]. 
    4. Do not include the actual URLs or titles in the body text citations. Just the numbers.
    5. The final output will have the full reference list appended automatically.
    
    Original User Query: ${query}
    
    Extracted Facts (Ordered List):
    ${formattedChunks}`;

    try {
      console.log(`[WRITER] Reducing ${chunks.length} chunks into final markdown...`);
      const markdown = await callLLM(systemPrompt, query);
      
      // Append the references section
      let referencesSection = `\n\n## References\n\n`;
      chunks.forEach((c, i) => {
        referencesSection += `<a name="cite-${i+1}"></a>[${i+1}] [${c.url}](${c.url})\n<br><i><small>${c.text}</small></i>\n\n`;
      });

      // Add markdown anchors in the body text
      // Matches [1], [2] but ignores frontmatter tags like tags: [...] 
      const finalBody = markdown.replace(/(?<!tags:\s*\[[^\]]*)\[(\d+)\](?!\])/g, '[[$$1](#cite-$$1)]');
      
      return finalBody + referencesSection;
    } catch (e) {
      console.error('WriterAgent: Failed to reduce chunks.', e);
      return '';
    }
  }

  /**
   * Full workflow orchestrator: Evaluate -> Draft -> Save -> Index
   */
  async processNewInformation(query: string, rawData: string, sourceUrl?: string) {
    const evalResult = await this.evaluateData(query, rawData);
    
    if (!evalResult.answered) {
      console.log('[WRITER] Data insufficient to answer query definitively.');
      return { success: false, reason: 'insufficient_data', ...evalResult };
    }

    if (!evalResult.worthSaving) {
      console.log('[WRITER] Data deemed trivial. Returning answer without saving.');
      return { success: true, saved: false, answer: evalResult.answer };
    }

    const markdown = await this.draftNote(query, rawData, sourceUrl);
    if (markdown) {
      const filePath = await this.saveAndIndex(markdown);
      return { success: true, saved: true, answer: evalResult.answer, file: filePath };
    }
    return { success: false, reason: 'drafting_failed', answer: evalResult.answer };
  }
}

export const writerAgent = new WriterAgent();
