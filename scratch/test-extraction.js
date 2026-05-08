const payload = {
  text: "Gemini 2.0 is a powerful AI model developed by Google. It supports multimodal inputs and has high reasoning capabilities.",
  source: "test_source"
};

async function testExtraction() {
    console.log("---TESTING AGENTIC EXTRACTION---");
    try {
        const response = await fetch("http://localhost:3000/api/extract-agentic", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        console.log("Extraction Result:", JSON.stringify(result, null, 2));
    } catch (e) {
        console.error("Extraction Error:", e);
    }
}

testExtraction();
