import fs from 'fs';
import FormData from 'form-data';

async function testRagPdf() {
    console.log("---TESTING RAG PDF INGESTION---");
    const filePath = "D:/RAG_Fever_Technical_Test_Data.pdf";
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath), 'RAG_Fever.pdf');

    try {
        const response = await fetch("http://localhost:3000/api/ingest/pdf", {
            method: "POST",
            body: formData
        });
        const result = await response.json();
        console.log("Ingestion Result:", JSON.stringify(result, null, 2));
        
        // Wait 5 seconds for graph extraction to finish if it's async (but my code is sync-await)
        console.log("\n---TESTING CHAT RETRIEVAL---");
        const chatResponse = await fetch("http://localhost:3000/api/query", {
            method: "POST",
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: "What is this document about?" })
        });
        const chatResult = await chatResponse.json();
        console.log("Chat Answer:", chatResult.answer);
        console.log("Source:", chatResult.source);
    } catch (e) {
        console.error("Test Error:", e);
    }
}

testRagPdf();
