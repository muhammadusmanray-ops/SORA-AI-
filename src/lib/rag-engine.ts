import { driver } from "./neo4j-client.js";
import { GoogleGenAI } from "@google/genai";
import { searchVectorStore } from "./vector-store.js";
import Groq from "groq-sdk";
import dotenv from "dotenv";
dotenv.config();

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

/**
 * Step 1: Neo4j (Graph) Search
 */
async function retrieveFromNeo4j(question: string): Promise<string> {
  const session = driver.session();
  try {
    const keywords = question
      .replace(/[?.,!]/g, "")
      .split(" ")
      .filter((w) => w.length > 3)
      .map((w) => w.toUpperCase());

    if (keywords.length === 0) return "";

    const query = `
      MATCH (s:Entity)-[r:RELATED_TO]->(o:Entity)
      OPTIONAL MATCH (s)-[:MENTIONED_IN]->(src:Source)
      WHERE any(keyword IN $keywords WHERE 
        toUpper(s.id) CONTAINS keyword OR 
        toUpper(o.id) CONTAINS keyword OR
        toUpper(r.type) CONTAINS keyword
      )
      RETURN s.id as subject, r.type as predicate, o.id as object, src.id as source
      LIMIT 15
    `;

    const result = await session.run(query, { keywords });
    const context = result.records
      .map((r) => {
        const triple = `${r.get("subject")} ${r.get("predicate").replace(/_/g, " ")} ${r.get("object")}`;
        const source = r.get("source");
        return source ? `${triple} (Source: ${source})` : triple;
      })
      .join("\n");

    return context ? `\n--- GRAPH CONTEXT ---\n${context}` : "";
  } catch (error) {
    console.error("Neo4j error:", error);
    return "";
  } finally {
    await session.close();
  }
}

/**
 * Step 2: Answer generation with Hybrid Context
 */
async function generateAnswer(question: string, graphContext: string, vectorContext: string): Promise<string> {
  const combinedContext = `${graphContext}\n${vectorContext}`.trim();
  
  const systemPrompt = combinedContext
    ? `You are a knowledge assistant. Use the following context to answer the question.
    
${combinedContext}

Answer based on the context above. If the context doesn't have enough info, say so.`
    : `You are a helpful assistant. The knowledge base doesn't have specific info. Answer from general knowledge.`;

  if (groq) {
    try {
      console.log("---GENERATING ANSWER VIA GROQ (Llama-3)---");
      const completion = await groq.chat.completions.create({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: question },
        ],
        model: "llama-3.3-70b-versatile",
      });
      return completion.choices[0]?.message?.content || "";
    } catch (err) {
      console.error("Groq Error, falling back to Gemini:", err);
    }
  }

  // Fallback to Gemini
  console.log("---GENERATING ANSWER VIA GEMINI---");
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await genai.models.generateContent({
        model: "gemini-2.0-flash-lite",
        contents: `${systemPrompt}\n\nUser Question: ${question}`,
      });
      return result.text ?? "";
    } catch (err: any) {
      if (err?.status === 429 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 5000 * attempt));
      } else {
        return "I'm sorry, I'm currently receiving too many requests.";
      }
    }
  }
  return "Error in generation.";
}

export async function ragQuery(question: string): Promise<{
  answer: string;
  context: string;
  source: string;
}> {
  console.log(`\n🔍 HYBRID RAG QUERY: "${question}"`);

  // Staged Hybrid Search: Stage 1 - Pre-Filter (Extract Metadata from Query)
  let filterCondition = "";
  const yearMatch = question.match(/\b(20\d{2})\b/);
  if (yearMatch) {
     // Create a SQL-like filter for LanceDB
     filterCondition = `year = '${yearMatch[1]}'`;
     console.log(`🎯 Extracted Metadata Filter: ${filterCondition}`);
  }

  // Parallel Search (Stage 2 - Vector Search with Pre-Filter)
  const [graphContext, vectorContextText] = await Promise.all([
    retrieveFromNeo4j(question),
    searchVectorStore(question, 3, filterCondition)
  ]);

  const vectorContext = vectorContextText ? `\n--- VECTOR CONTEXT ---\n${vectorContextText}` : "";
  
  const answer = await generateAnswer(question, graphContext, vectorContext);

  let source = "general_ai";
  if (graphContext && vectorContext) source = "hybrid (graph + vector)";
  else if (graphContext) source = "knowledge_graph";
  else if (vectorContext) source = "vector_db";

  return {
    answer,
    context: `${graphContext}\n${vectorContext}`.trim(),
    source
  };
}
