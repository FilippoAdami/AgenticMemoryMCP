import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:11434/v1';
const VAULT_PATH = process.env.VAULT_PATH || path.join(process.env.HOME || '', 'Documents', 'MondayVault');

async function callLLM(systemPrompt: string, userPrompt: string) {
  const response = await fetch(`${GATEWAY_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemma4-12b-q4km-8k',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) throw new Error(`LLM Error: ${response.statusText}`);
  const data = await response.json();
  return data.choices[0].message.content;
}

export class LibrarianAgent {
  /**
   * Scans a directory recursively and returns all markdown files
   */
  private getMarkdownFiles(dir: string, fileList: string[] = []): string[] {
    if (!fs.existsSync(dir)) return fileList;
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        this.getMarkdownFiles(fullPath, fileList);
      } else if (fullPath.endsWith('.md')) {
        fileList.push(fullPath);
      }
    }
    return fileList;
  }

  /**
   * The core routine: extracts all tags, asks LLM to unify them, and writes them back.
   */
  async unifyTags() {
    console.log('[LIBRARIAN] Scanning vault for tags...');
    const searchDirs = [
      path.join(VAULT_PATH, '20-Projects'),
      path.join(VAULT_PATH, '30-Resources', 'Sources')
    ];

    let allFiles: string[] = [];
    for (const dir of searchDirs) {
      allFiles = allFiles.concat(this.getMarkdownFiles(dir));
    }

    // 1. Collect all unique tags
    const tagMap = new Map<string, string[]>(); // Tag -> File paths
    const fileContents = new Map<string, { frontmatter: any, body: string }>();

    for (const file of allFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      if (match) {
        try {
          const frontmatter = yaml.parse(match[1]);
          const body = content.slice(match[0].length);
          fileContents.set(file, { frontmatter, body });

          if (frontmatter.tags && Array.isArray(frontmatter.tags)) {
            for (const tag of frontmatter.tags) {
              const lowerTag = tag.toLowerCase();
              const existing = tagMap.get(lowerTag) || [];
              existing.push(file);
              tagMap.set(lowerTag, existing);
            }
          }
        } catch (e) {
          console.warn(`[LIBRARIAN] Failed to parse YAML in ${file}`);
        }
      }
    }

    const uniqueTags = Array.from(tagMap.keys());
    if (uniqueTags.length === 0) {
      console.log('[LIBRARIAN] No tags found to unify.');
      return;
    }

    // 2. Ask LLM to unify tags
    console.log(`[LIBRARIAN] Found ${uniqueTags.length} unique tags. Asking LLM for a unified taxonomy...`);
    const prompt = `You are the Librarian Sub-Agent for JarvisVault. Your job is to unify and clean redundant markdown tags.
    Review the following list of unique tags found in the vault. 
    Identify redundant tags (e.g., "#ai" and "#artificial-intelligence") and map them to a single, clean, PascalCase standard (e.g., "#AI").
    
    Respond ONLY with a JSON object where keys are the OLD tags (exactly as provided) and values are the NEW unified tags.
    If a tag is already perfect, map it to itself.
    
    Example output:
    {
      "#ai": "#AI",
      "#artificial_intelligence": "#AI",
      "#coding": "#SoftwareEngineering"
    }`;

    try {
      const llmResponse = await callLLM(prompt, JSON.stringify(uniqueTags));
      const unifiedMapping = JSON.parse(llmResponse);

      // 3. Apply the mapping back to the files
      console.log('[LIBRARIAN] Applying unified taxonomy...');
      let updatedCount = 0;

      for (const [file, data] of fileContents.entries()) {
        let changed = false;
        if (data.frontmatter.tags && Array.isArray(data.frontmatter.tags)) {
          const newTags = data.frontmatter.tags.map((t: string) => {
            const mapped = unifiedMapping[t.toLowerCase()];
            if (mapped && mapped !== t) {
              changed = true;
              return mapped;
            }
            return t;
          });

          if (changed) {
            // Deduplicate new tags
            data.frontmatter.tags = [...new Set(newTags)];
            const newYaml = yaml.stringify(data.frontmatter);
            const newContent = `---\n${newYaml}---\n${data.body.trimStart()}`;
            fs.writeFileSync(file, newContent, 'utf-8');
            updatedCount++;
          }
        }
      }

      console.log(`[LIBRARIAN] Unified tags in ${updatedCount} files.`);
      return { success: true, updatedFiles: updatedCount, mapping: unifiedMapping };

    } catch (e) {
      console.error('[LIBRARIAN] Failed to unify tags:', e);
      return { success: false, error: (e as Error).message };
    }
  }
}

export const librarianAgent = new LibrarianAgent();
