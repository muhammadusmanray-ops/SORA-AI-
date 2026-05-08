async function testIngest() {
  const response = await fetch('http://localhost:3000/api/ingest/url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://en.wikipedia.org/wiki/Artificial_intelligence' })
  });
  const data = await response.json();
  console.log('INGESTION RESULT:', JSON.stringify(data, null, 2));
}
testIngest();
