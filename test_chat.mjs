import fetch from 'node-fetch';

async function testChat() {
  console.log("Sending query to localhost:3000/api/query");
  const response = await fetch("http://localhost:3000/api/query", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      question: "Who developed LlamaGraph Knowledge Agent?"
    })
  });
  
  const data = await response.json();
  console.log("Chat Response:", JSON.stringify(data, null, 2));
}

testChat();
