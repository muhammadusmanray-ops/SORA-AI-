import * as lancedb from "vectordb";
import path from "path";
import dotenv from "dotenv";
dotenv.config();

/**
 * Step 1: Text ke chunks banana (splitting)
 */
export function chunkText(text: string, size: number = 1000): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

/**
 * Step 2: Jina AI se embeddings nikalna (Batch Processing for Speed)
 */
async function getJinaEmbeddings(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) throw new Error("JINA_API_KEY missing");

  const response = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'jina-embeddings-v3',
      task: 'text-matching',
      dimensions: 1024,
      embedding_type: 'float',
      input: texts
    })
  });

  if (!response.ok) {
    throw new Error(`Jina API error: ${response.statusText} - ${await response.text()}`);
  }
  const data = await response.json();
  return data.data.map((item: any) => item.embedding);
}

/**
 * Step 3: LanceDB mein data save karna (with Metadata)
 */
export async function saveToLanceDB(text: string, source: string, metadata: { year?: string, category?: string } = {}) {
  const dbPath = path.join(process.cwd(), "lancedb_store");
  const db = await lancedb.connect(dbPath);
  
  const chunks = chunkText(text);
  const data = [];

  console.log(`---GENERATING JINA EMBEDDINGS FOR ${chunks.length} CHUNKS (IN BATCHES)---`);
  
  const year = metadata.year || new Date().getFullYear().toString();
  const category = metadata.category || "General";

  // Process in batches of 50 to avoid API payload limits
  const batchSize = 50;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    try {
      const vectors = await getJinaEmbeddings(batch);
      for (let j = 0; j < batch.length; j++) {
        data.push({
          vector: vectors[j],
          text: batch[j],
          source: source,
          year: year,
          category: category
        });
      }
      console.log(`✅ Processed batch ${i / batchSize + 1} / ${Math.ceil(chunks.length / batchSize)}`);
    } catch (err) {
      console.error(`Error in batch ${i / batchSize + 1}:`, err);
    }
  }

  if (data.length === 0) {
    throw new Error("No embeddings generated, failing save to LanceDB.");
  }

  // Table create ya open karna
  let table;
  const tableNames = await db.tableNames();
  const tableName = "knowledge_chunks_v3_jina";
  if (tableNames.includes(tableName)) {
    table = await db.openTable(tableName);
    await table.add(data);
  } else {
    table = await db.createTable(tableName, data);
  }
  
  console.log(`✅ Saved ${data.length} chunks to LanceDB!`);
}

/**
 * Step 4: LanceDB se relevant chunks dhoondna (Vector Search with Pre-Filter)
 */
export async function searchVectorStore(query: string, limit: number = 3, filterCondition?: string): Promise<string> {
  const dbPath = path.join(process.cwd(), "lancedb_store");
  const db = await lancedb.connect(dbPath);
  
  const tableName = "knowledge_chunks_v3_jina";
  const tableNames = await db.tableNames();
  if (!tableNames.includes(tableName)) return "";

  const table = await db.openTable(tableName);
  
  // Get query embedding
  const queryVectors = await getJinaEmbeddings([query]);
  const queryVector = queryVectors[0];

  let searchReq = table.search(queryVector);
  
  if (filterCondition) {
    console.log(`---APPLYING LANCEDB PRE-FILTER: ${filterCondition}---`);
    searchReq = searchReq.where(filterCondition);
  }

  const results = await searchReq.limit(limit).execute();

  return results.map((r: any) => r.text).join("\n---\n");
}
