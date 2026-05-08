import fetch from 'node-fetch';

async function test() {
  console.log("Sending data to localhost:3000/api/ingest/url");
  const response = await fetch("http://localhost:3000/api/ingest/url", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      url: "Hafiz developed the LlamaGraph Knowledge Agent. This innovative system uses Neo4j for graph relationships and LanceDB for vector storage. It is designed to handle complex RAG tasks."
    })
  });
  
  const data = await response.json();
  console.log("Response:", data);
}

test();
