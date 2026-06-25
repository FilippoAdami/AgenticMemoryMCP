import { Hono } from 'hono';
import { vaultIndexer } from '../services/indexer.js';
import { writerAgent } from '../services/writer.js';
import { webScraperAgent } from '../services/scraper.js';

export const queryRouter = new Hono();

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:11434/v1';

const sessions = new Map<string, {
  history: string[];
  lastPlan?: any;
  exchanges: number;
}>();

const ROUTING_MODEL = process.env.ROUTING_MODEL || 'gemma4-12b-q4km-8k';

async function callLLM(systemPrompt: string, userPrompt: string, jsonMode = false) {
  const response = await fetch(`${GATEWAY_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ROUTING_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
      response_format: jsonMode ? { type: 'json_object' } : undefined
    })
  });
  if (!response.ok) throw new Error(`LLM Error: ${response.statusText}`);
  const data = await response.json();
  return data.choices[0].message.content;
}

async function isTimeSensitive(query: string): Promise<boolean> {
  const prompt = `Evaluate if the following query requires real-time or very recent data (news, weather, sports scores, current events). Respond with ONLY valid JSON: {"timeSensitive": true|false}`;
  try {
    const raw = await callLLM(prompt, query, true);
    return !!JSON.parse(raw).timeSensitive;
  } catch (e) {
    return false;
  }
}

async function evaluateRAGConfidence(query: string, chunks: any[]): Promise<{ confidence: number; answer: string }> {
  const context = chunks.map(c => c.text).join('\n---\n');
  const prompt = `You are Monday. Use the Memory Vault context to answer the user's query.
  If the context does not contain enough information to give a highly accurate answer, set confidence below 0.85.
  Respond with ONLY valid JSON: {"confidence": 0.0 to 1.0, "answer": "Your answer based strictly on context"}`;
  try {
    const raw = await callLLM(prompt, `CONTEXT:\n${context}\nQUERY: ${query}`, true);
    const parsed = JSON.parse(raw);
    return { confidence: parsed.confidence || 0, answer: parsed.answer || '' };
  } catch (e) {
    return { confidence: 0, answer: 'Failed to evaluate.' };
  }
}

async function classifyIntent(userMessage: string, planContext: string): Promise<'APPROVE'|'TWEAK'|'ABORT'|'REVERT_TO_STANDARD'|'NEW_TOPIC'> {
  const prompt = `You are Monday's intent classifier. The system proposed a Deep Search Plan:
${planContext}

User says: "${userMessage}"

Classify the user's intent as EXACTLY ONE of the following:
APPROVE - user agrees or says go ahead.
TWEAK - user wants to add, remove, or change something.
ABORT - user says cancel or stop deep search.
REVERT_TO_STANDARD - user wants to skip deep search and just do simple web search.
NEW_TOPIC - user asks a completely unrelated question.

Respond ONLY with the exact classification string.`;

  const raw = await callLLM(prompt, userMessage);
  const clean = raw.trim().toUpperCase();
  if (['APPROVE', 'TWEAK', 'ABORT', 'REVERT_TO_STANDARD', 'NEW_TOPIC'].includes(clean)) return clean as any;
  return 'TWEAK';
}

async function runIterativeStandardSearch(query: string) {
  let missingInfo = query;
  let allContext = "";
  
  for (let i = 0; i < 5; i++) {
    console.log(`[ITERATION ${i+1}/5] Standard Search for: ${missingInfo}`);
    const webResults = await webScraperAgent.standardSearch(missingInfo);
    allContext += `\n\n[Search Iteration ${i+1}]\n` + webResults;
    
    const evalResult = await writerAgent.evaluateData(query, allContext);
    
    if (evalResult.answered) {
      if (!evalResult.worthSaving) return { success: true, saved: false, answer: evalResult.answer };
      const markdown = await writerAgent.draftNote(query, allContext, 'Iterative Search');
      if (markdown) {
        const filePath = await writerAgent.saveAndIndex(markdown);
        return { success: true, saved: true, answer: evalResult.answer, file: filePath };
      }
      return { success: false, reason: 'drafting_failed', answer: evalResult.answer };
    }
    
    // Not answered yet.
    if (evalResult.suggested_query) {
      console.log(`[MISSING INFO IDENTIFIED] ${evalResult.missing_fields}`);
      missingInfo = evalResult.suggested_query;
    } else {
      break; // No suggestions left
    }
  }
  
  return { success: false, reason: 'insufficient_data' };
}

export async function processQuery(query: string, projectScope?: string, sessionId?: string) {
  // Session / Interactive Intent Routing
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    session.history.push(`User: ${query}`);
    session.exchanges++;
    
    console.log(`[ROUTER] Session active. Classifying intent for: ${query}`);
    const intent = await classifyIntent(query, JSON.stringify(session.lastPlan));
    console.log(`[ROUTER] Intent classified as: ${intent}`);
    
    if (intent === 'APPROVE' || session.exchanges >= 3) {
      sessions.delete(sessionId);
      const chunks = await webScraperAgent.executeDeepSearchMapReduce(session.lastPlan);
      const markdown = await writerAgent.deepSearchReducePhase(query, chunks);
      const file = await writerAgent.saveAndIndex(markdown);
      return { status: 'DEEP_SEARCH_COMPLETE', file };
    }
    if (intent === 'ABORT') {
      sessions.delete(sessionId);
      return { status: "ABORTED", message: "Deep search aborted." };
    }
    if (intent === 'REVERT_TO_STANDARD') {
      sessions.delete(sessionId);
      const res = await runIterativeStandardSearch(query);
      return { source: 'web_search', data: res };
    }
    if (intent === 'NEW_TOPIC') {
      sessions.delete(sessionId);
      // Fall through to normal query processing
    } else if (intent === 'TWEAK') {
      const newPlan = await webScraperAgent.generateDeepSearchPlan(query, session.history);
      session.lastPlan = newPlan;
      return { status: 'WAITING_FOR_USER_PLAN_APPROVAL', plan: newPlan, sessionId };
    }
  }

  const timeSensitive = await isTimeSensitive(query);
  
  if (!timeSensitive) {
    console.log('[ROUTER] Searching LanceDB...');
    const results = await vaultIndexer.search(query, projectScope, 5);
    if (results.length > 0) {
      const evalResult = await evaluateRAGConfidence(query, results);
      console.log(`[ROUTER] RAG Confidence: ${evalResult.confidence}`);
      if (evalResult.confidence >= 0.85) {
        return { source: 'vault_rag', answer: evalResult.answer, confidence: evalResult.confidence };
      }
    }
  }

  // Fallback to iterative standard search
  const result = await runIterativeStandardSearch(query);
  if (result.success) {
    return { source: 'web_search', data: result };
  }

  // Standard search failed completely, trigger Deep Search Planner
  console.log('[ROUTER] Iterative Standard Search insufficient. Escalating to Deep Search Planner.');
  const newSessionId = sessionId || `session_${Date.now()}`;
  const plan = await webScraperAgent.generateDeepSearchPlan(query, [`User: ${query}`]);
  sessions.set(newSessionId, { history: [`User: ${query}`], lastPlan: plan, exchanges: 1 });
  
  return { status: 'WAITING_FOR_USER_PLAN_APPROVAL', plan, sessionId: newSessionId };
}

queryRouter.post('/', async (c) => {
  const { query, projectScope, sessionId } = await c.req.json();
  const response = await processQuery(query, projectScope, sessionId);
  return c.json(response);
});
