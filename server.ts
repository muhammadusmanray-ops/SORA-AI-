import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import * as cheerio from 'cheerio';
import { extractionPipeline } from "./src/lib/graph-pipeline.js";
import { ragQuery } from "./src/lib/rag-engine.js";
import { saveToLanceDB } from "./src/lib/vector-store.js";
import { driver } from "./src/lib/neo4j-client.js";
import dotenv from 'dotenv';
import multer from 'multer';
import { createRequire } from 'module';
import { GoogleGenAI } from '@google/genai';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');
import fs from 'fs';

dotenv.config();

const upload = multer({ dest: 'uploads/' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API routes
  app.post("/api/ingest/url", async (req, res) => {
    try {
      const { url, text: providedText } = req.body;
      let text = providedText;

      if (!text) {
        // Simple check: if it starts with http, it's a URL
        if (url.trim().startsWith("http")) {
          console.log(`---INGESTING URL VIA JINA AI: ${url}---`);
          const jinaUrl = `https://r.jina.ai/${url}`;
          const response = await fetch(jinaUrl, {
            headers: {
              'Authorization': `Bearer ${process.env.JINA_API_KEY}`
            },
            signal: AbortSignal.timeout(15000) // 15s timeout
          });
          
          if (!response.ok) {
            throw new Error(`Jina AI returned status: ${response.status}`);
          }
          
          text = await response.text();
        } else {
          console.log(`---TREATING INPUT AS RAW TEXT---`);
          text = url;
        }
      } else {
        console.log(`---INGESTING PROVIDED TEXT FOR SOURCE: ${url}---`);
      }
      
      if (!text || text.trim().length < 5) {
        throw new Error("Content is too short or empty.");
      }

      // Save to Vector DB (LanceDB)
      console.log(`---SAVING TO LANCEDB---`);
      await saveToLanceDB(text, url.substring(0, 50));

      // Step 3: Auto-run Agentic Extraction (Neo4j)
      console.log(`---AUTO-RUNNING AGENTIC EXTRACTION FOR URL: ${url}---`);
      const graphResult = await extractionPipeline.invoke({ 
        text, 
        source: url,
        triplets: [], 
        retryCount: 0, 
        isValid: false 
      });

      res.json({ 
        message: "Successfully ingested URL to Vector and Graph DB",
        source: url,
        graphSummary: `${graphResult.triplets?.length || 0} triplets extracted`
      });
    } catch (error) {
      console.error("Ingestion error:", error);
      res.status(500).json({ error: "Failed to ingest content" });
    }
  });

  app.post("/api/ingest/pdf", upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      console.log(`---PARSING PDF: ${req.file.originalname}---`);
      
      const dataBuffer = fs.readFileSync(req.file.path);
      // Try to use Gemini first for Multimodal PDF reading (Text + Images)
      let extractedText = "";
      try {
        console.log(`---ASKING GEMINI TO READ PDF AND DESCRIBE IMAGES---`);
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
              "Extract all text from this PDF exactly as it is. IMPORTANT: If you see any images, diagrams, charts, or tables, write a detailed description of them in the text so that another text-only AI can understand what was in the images.",
              {
                inlineData: {
                  data: dataBuffer.toString("base64"),
                  mimeType: "application/pdf"
                }
              }
            ]
        });
        extractedText = response.text || "";
        console.log(`✅ Gemini successfully extracted text and described images!`);
      } catch (geminiErr: any) {
        console.error("⚠️ Gemini PDF parsing failed, falling back to standard pdf-parse:", geminiErr.message);
        
        // Fallback to basic pdf-parse
        const pdfParser = typeof pdf === 'function' ? pdf : (pdf.PDFParse || pdf.default || pdf);
        if (typeof pdfParser !== 'function') {
          throw new Error("PDF parser is not a function. Keys available: " + Object.keys(pdf).join(', '));
        }
        
        try {
          const parser = new pdf.PDFParse({ data: dataBuffer });
          const result = await parser.getText();
          extractedText = result.text || "";
        } catch (err: any) {
          console.error("Inner PDF Parse Error:", err.message);
          throw new Error("Library failed to extract text: " + err.message);
        }
      }
      
      // Cleanup
      fs.unlinkSync(req.file.path);
      
      if (!extractedText) {
        throw new Error("PDF parsed but no text found.");
      }

      console.log(`✅ PDF Parsed successfully. Length: ${extractedText.length}`);
      
      const fileName = req.file.originalname;
      
      // Step 2: Auto-save to Vector DB (LanceDB)
      console.log(`---AUTO-SAVING TO LANCEDB FOR: ${fileName}---`);
      await saveToLanceDB(extractedText, fileName);
      
      // Step 3: Auto-run Agentic Extraction (Neo4j) in Background
      const runInChunks = async () => {
        console.log(`---AUTO-RUNNING AGENTIC EXTRACTION IN CHUNKS FOR: ${fileName}---`);
        const chunkSize = 10000; // About 2500 tokens per chunk
        
        for (let i = 0; i < extractedText.length; i += chunkSize) {
          const chunk = extractedText.slice(i, i + chunkSize);
          const chunkNum = Math.floor(i / chunkSize) + 1;
          const totalChunks = Math.ceil(extractedText.length / chunkSize);
          
          console.log(`\n⏳ Processing Graph Extraction Chunk ${chunkNum}/${totalChunks}...`);
          try {
            await extractionPipeline.invoke({ 
              text: chunk, 
              source: fileName,
              triplets: [], 
              retryCount: 0, 
              isValid: false 
            });
            // Delay to respect API limits
            if (chunkNum < totalChunks) await new Promise(resolve => setTimeout(resolve, 8000));
          } catch (err) {
            console.error(`Chunk ${chunkNum} failed:`, err);
          }
        }
        console.log(`✅ Finished processing all chunks for ${fileName}`);
      };
      
      runInChunks().catch(console.error);

      res.json({ 
        message: "Successfully ingested PDF to Vector DB. Graph extraction running in background.",
        textLength: extractedText.length,
        source: fileName,
        graphSummary: `Processing in chunks...`
      });
    } catch (error: any) {
      console.error("❌ PDF Parsing error:", error.message);
      res.status(500).json({ error: `Failed to parse PDF: ${error.message}` });
    }
  });

  app.post("/api/extract-agentic", async (req, res) => {
    try {
      const { text, source } = req.body;
      console.log(`---RUNNING AGENTIC EXTRACTION FOR SOURCE: ${source || 'unknown'}---`);
      const result = await extractionPipeline.invoke({ 
        text, 
        source: source || "",
        triplets: [], 
        retryCount: 0, 
        isValid: false 
      });
      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Agentic extraction failed" });
    }
  });

  app.get("/api/graph", async (req, res) => {
    const session = driver.session();
    try {
      const result = await session.run(`
        MATCH (s:Entity)-[r:RELATED_TO]->(o:Entity)
        RETURN s.id as subject, r.type as predicate, o.id as object
        LIMIT 100
      `);
      
      const nodesSet = new Set<string>();
      const links: any[] = [];
      
      result.records.forEach(r => {
        const sub = r.get("subject");
        const obj = r.get("object");
        nodesSet.add(sub);
        nodesSet.add(obj);
        links.push({ source: sub, target: obj, label: r.get("predicate") });
      });
      
      res.json({
        nodes: Array.from(nodesSet).map(id => ({ id, type: 'entity' })),
        links
      });
    } catch (error) {
      console.error("Graph fetch error:", error);
      res.status(500).json({ error: "Failed to fetch graph" });
    } finally {
      await session.close();
    }
  });

  // Step 2: RAG Query Endpoint
  app.post("/api/query", async (req, res) => {
    try {
      const { question } = req.body;
      if (!question) return res.status(400).json({ error: "Question is required" });
      
      console.log(`\n💬 RAG Question received: "${question}"`);
      const result = await ragQuery(question);
      res.json(result);
    } catch (error) {
      console.error("RAG Query error:", error);
      res.status(500).json({ error: "RAG query failed" });
    }
  });

  app.get("/api/config", (req, res) => {
    res.json({ geminiKey: process.env.GEMINI_API_KEY });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
