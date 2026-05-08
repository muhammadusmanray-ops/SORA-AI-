import { StateGraph, END, START, Annotation } from "@langchain/langgraph";
import { saveTripletsToNeo4j } from "./neo4j-client.js";
import Groq from "groq-sdk";
import dotenv from "dotenv";

dotenv.config();

// Rate limit fix: 2 second delay between API calls
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 1. Graph ki State define karna (Memory)
// Is mein hum wo data rakhte hain jo poore graph mein move karega
const ExtractionState = Annotation.Root({
  text: Annotation<string>(),         // Input text
  source: Annotation<string>(),       // Source URL or filename
  triplets: Annotation<any[]>(),     // Extracted knowledge (Subject-Predicate-Object)
  retryCount: Annotation<number>(),  // Kitni dafa try kiya
  isValid: Annotation<boolean>(),    // Kya data sahi hai?
});

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || "" });

// 2. Extraction Node: Text se knowledge nikalna
async function extractor(state: typeof ExtractionState.State) {
  console.log("---AI EXTRACTING KNOWLEDGE---");
  const prompt = `You are a Knowledge Engineer. Extract entities and their relationships from the text.
  Return ONLY a JSON array of objects with keys: subject, predicate, object.
  Text: ${state.text}`;
  
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await sleep(2000 * attempt); // Increasing delay between attempts
      console.log("---INVOKING GROQ VIA SDK---");
      const completion = await groq.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.3-70b-versatile",
      });
      console.log("---GROQ RESPONSE RECEIVED---");
      const content = completion.choices[0]?.message?.content || "";
      console.log("Content received:", content);
      
      const jsonStr = content.replace(/```json|```/g, "").trim();
      const triplets = JSON.parse(jsonStr);
      
      return { 
        triplets: Array.isArray(triplets) ? triplets : [],
        retryCount: (state.retryCount || 0) + 1 
      };
    } catch (err: any) {
      if (err?.status === 429 && attempt < 3) {
        console.log(`Rate limit in extractor. Waiting ${5 * attempt}s...`);
        await sleep(5000 * attempt);
      } else {
        console.error("Extraction error:", err);
        return { retryCount: (state.retryCount || 0) + 1 };
      }
    }
  }
  return { retryCount: (state.retryCount || 0) + 1 };
}

// 3. Validation Node: Quality Check
async function validator(state: typeof ExtractionState.State) {
  console.log(`---VALIDATING (${state.triplets?.length || 0} triplets found)---`);
  // Agar koi triplet na mile ya count kam ho to retry
  const isValid = state.triplets && state.triplets.length > 0;
  return { isValid };
}

// 4. Store Node: Neo4j mein save karna
async function store(state: typeof ExtractionState.State) {
  console.log(`---STORING KNOWLEDGE IN NEO4J FOR SOURCE: ${state.source}---`);
  if (state.triplets && state.triplets.length > 0) {
    await saveTripletsToNeo4j(state.triplets, state.source);
  }
  return {};
}

// 5. Router: Faisla karna ke agay kahan jana hai
function router(state: typeof ExtractionState.State) {
  if (state.isValid) {
    return "store"; // Agar data sahi hai to Neo4j mein save karo
  } else if (state.retryCount > 2) {
    return END; // Fail ho gaya 3 baar to khatam
  }
  return "extract"; // Warna wapas try karo
}

// 6. Graph Build karna
const workflow = new StateGraph(ExtractionState)
  .addNode("extract", extractor)
  .addNode("validate", validator)
  .addNode("store", store)
  .addEdge(START, "extract")
  .addEdge("extract", "validate")
  .addConditionalEdges("validate", router)
  .addEdge("store", END);

export const extractionPipeline = workflow.compile();
