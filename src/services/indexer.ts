import * as lancedb from '@lancedb/lancedb';
import * as path from 'path';

const VAULT_PATH = process.env.VAULT_PATH || path.join(process.env.HOME || '', 'Documents', 'MondayVault');
const DB_URI = process.env.LANCEDB_URI || path.join(VAULT_PATH, '.lancedb');
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:11434/api';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'bge-m3';
const EMBEDDING_DIMENSIONS = parseInt(process.env.EMBEDDING_DIMENSIONS || '1024', 10);

export class VaultIndexer {
  private db!: lancedb.Connection;
  private table!: lancedb.Table;

  async init() {
    this.db = await lancedb.connect(DB_URI);
    const tableNames = await this.db.tableNames();
    
    if (tableNames.includes('vault_chunks')) {
      this.table = await this.db.openTable('vault_chunks');
    } else {
      const dummyVector = Array(EMBEDDING_DIMENSIONS).fill(0);
      this.table = await this.db.createTable('vault_chunks', [
        { id: 'dummy', vector: dummyVector, text: 'dummy', fileId: 'dummy', project: 'System', timestamp: Date.now() }
      ]);
      await this.table.delete('id = "dummy"');
    }
    console.log(`[INDEXER] LanceDB ready. Routing embeddings to Ollama (${EMBEDDING_MODEL}).`);
  }

  async getEmbedding(text: string): Promise<number[]> {
    const response = await fetch(`${GATEWAY_URL}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        prompt: text
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    return data.embedding;
  }

  chunkText(text: string): string[] {
    return text.split(/(?<=[.?!])\s+/).map(s => s.trim()).filter(s => s.length > 5);
  }

  async indexDocument(fileId: string, project: string, text: string) {
    const sentences = this.chunkText(text);
    if (sentences.length === 0) return;
    // Delete existing chunks for this file
    try {
      if (this.table) {
        await this.table.delete(`"fileId" = '${fileId}'`);
      }
    } catch (e) {
      // It's okay if it doesn't exist yet
    }

    const records = [];
    for (let i = 0; i < sentences.length; i++) {
      try {
        const vector = await this.getEmbedding(sentences[i]);
        records.push({
          id: `${fileId}_chunk_${i}`, vector, text: sentences[i], fileId, project, timestamp: Date.now()
        });
      } catch (e) {
        console.error(`Failed to embed chunk ${i} for ${fileId}:`, e);
      }
    }
    if (records.length > 0) {
      await this.table.add(records);
      console.log(`Indexed ${records.length} chunks for ${fileId} [Project: ${project}]`);
    }
  }

  async search(query: string, projectFilter?: string, limit: number = 5) {
    const queryVector = await this.getEmbedding(query);
    let searchBuilder = this.table.search(queryVector);
    if (projectFilter) searchBuilder = searchBuilder.where(`project = '${projectFilter}'`);
    return await searchBuilder.limit(limit).toArray();
  }
}

export const vaultIndexer = new VaultIndexer();
