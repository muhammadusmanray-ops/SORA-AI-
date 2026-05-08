import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';
dotenv.config();

const driver = neo4j.driver(
  process.env.NEO4J_URI || '',
  neo4j.auth.basic(process.env.NEO4J_USERNAME || '', process.env.NEO4J_PASSWORD || '')
);

async function checkNodes() {
  const session = driver.session();
  try {
    const result = await session.run('MATCH (n) RETURN count(n) as count');
    console.log('TOTAL NODES IN NEO4J:', result.records[0].get('count').toString());
    
    const labels = await session.run('CALL db.labels()');
    console.log('LABELS:', labels.records.map(r => r.get(0)));
  } catch (err) {
    console.error('NEO4J CONNECTION ERROR:', err);
  } finally {
    await session.close();
    await driver.close();
  }
}

checkNodes();
