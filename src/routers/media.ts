import { Hono } from 'hono';
import * as fs from 'fs';
import * as path from 'path';
import { writerAgent } from '../services/writer.js';

export const mediaRouter = new Hono();

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:11434/v1';
const VAULT_PATH = process.env.VAULT_PATH || path.join(process.env.HOME || '', 'Documents', 'MondayVault');
const MEDIA_DIR = path.join(VAULT_PATH, '30-Resources', 'Media');

/**
 * Scaffolding for Gemma 4 (or similar Vision Language Models).
 * Accepts base64 image data and prompts the local vLLM instance to describe/extract text.
 */
async function processVisionModel(base64Image: string, prompt: string): Promise<string> {
  // Using standard OpenAI Vision API format which vLLM supports for VLMs
  const response = await fetch(`${GATEWAY_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemma4-12b-q4km-8k', // Gemma 4 natively supports vision
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}` } },
            { type: 'text', text: prompt }
          ]
        }
      ],
      max_tokens: 500,
      temperature: 0.2
    })
  });

  if (!response.ok) {
    throw new Error(`VLM Processing Error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

mediaRouter.post('/process', async (c) => {
  const body = await c.req.parseBody();
  const file = body['file'];
  const customPrompt = body['prompt'] as string || 'Extract all text and describe this image in extreme detail for semantic indexing.';

  if (!file || typeof file === 'string') {
    return c.json({ error: 'No valid file uploaded' }, 400);
  }

  try {
    // 1. Save the raw media file
    if (!fs.existsSync(MEDIA_DIR)) {
      fs.mkdirSync(MEDIA_DIR, { recursive: true });
    }
    
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-]/g, '_');
    const filePath = path.join(MEDIA_DIR, safeName);
    
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(filePath, buffer);
    
    console.log(`[MEDIA] Saved raw media file to ${filePath}`);

    // 2. Convert to Base64 for VLM (Assuming image/jpeg or png for this scaffold)
    const base64Data = buffer.toString('base64');

    // 3. Trigger Gemma 4 VLM hook
    console.log('[MEDIA] Triggering VLM Hook (Gemma 4 Scaffold)...');
    const vlmExtraction = await processVisionModel(base64Data, customPrompt);

    // 4. Pass extraction to WriterAgent to generate the Markdown sidecar file
    // This allows images and PDFs to be semantically searchable in LanceDB
    const sidecarContent = `Raw Media Path: ${filePath}\n\nVision Extraction:\n${vlmExtraction}`;
    
    // We bypass the "worthSaving" check here because explicitly uploaded media is assumed valuable
    console.log('[MEDIA] Synthesizing Sidecar Note via Writer Agent...');
    const sidecarMarkdown = await writerAgent.draftNote(
      `Media Extraction for ${safeName}`, 
      sidecarContent, 
      `file://${filePath}`
    );

    if (sidecarMarkdown) {
      const sidecarPath = await writerAgent.saveAndIndex(sidecarMarkdown);
      return c.json({ success: true, mediaPath: filePath, sidecarPath, extraction: vlmExtraction });
    }

    return c.json({ success: true, mediaPath: filePath, extraction: vlmExtraction, note: 'Failed to draft sidecar.' });

  } catch (error) {
    console.error('[MEDIA] VLM Processing failed:', error);
    return c.json({ error: 'VLM processing failed', details: (error as Error).message }, 500);
  }
});
