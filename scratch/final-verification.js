import fs from 'fs';
import FormData from 'form-data';

async function finalLiveTest() {
    console.log("🚀 [1/3] STARTING LIVE INGESTION TEST: Profile.pdf");
    const filePath = "D:/Profile.pdf";
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath), 'Profile.pdf');

    try {
        const ingestRes = await fetch("http://localhost:3000/api/ingest/pdf", {
            method: "POST",
            body: formData,
            headers: formData.getHeaders()
        });
        const ingestData = await ingestRes.json();
        console.log("✅ INGESTION STATUS:", ingestData.message || ingestData.error);
        console.log("📊 GRAPH SUMMARY:", ingestData.graphSummary);

        console.log("\n⏳ [2/3] WAITING FOR GRAPH SYNC...");
        await new Promise(r => setTimeout(r, 5000));

        console.log("\n🔍 [3/3] QUERYING KNOWLEDGE BASE...");
        const queryRes = await fetch("http://localhost:3000/api/query", {
            method: "POST",
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: "What are Usman's skills and experience?" })
        });
        const queryData = await queryRes.json();
        
        console.log("\n🤖 AI ANSWER:");
        console.log("--------------------------------------------------");
        console.log(queryData.answer);
        console.log("--------------------------------------------------");
        console.log("📂 SOURCE:", queryData.source);
        
    } catch (e) {
        console.error("❌ TEST FAILED:", e.message);
    }
}

finalLiveTest();
