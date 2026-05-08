import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';
dotenv.config();

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD)
);

const session = driver.session();
try {
  // Test connection
  await session.run('RETURN 1 as n');
  console.log("✅ Neo4j connection successful!");

  // Manually insert test triplets
  const triplets = [
    { subject: "DEEPMIND", predicate: "FOUNDED_IN", object: "SEPTEMBER_2010" },
    { subject: "DEEPMIND", predicate: "CEO_IS", object: "DEMIS_HASSABIS" },
    { subject: "DEEPMIND", predicate: "ACQUIRED_BY", object: "GOOGLE" },
    { subject: "DEEPMIND", predicate: "IS_A", object: "AI_RESEARCH_LAB" },
    { subject: "DEMIS_HASSABIS", predicate: "WORKS_AT", object: "DEEPMIND" }
  ];

  for (const t of triplets) {
    await session.run(`
      MERGE (s:Entity {id: $subject})
      MERGE (o:Entity {id: $object})
      MERGE (s)-[r:RELATED_TO {type: $predicate}]->(o)
    `, t);
  }
  
  console.log(`✅ ${triplets.length} test triplets saved to Neo4j!`);

  // Verify data
  const result = await session.run('MATCH (s)-[r]->(o) RETURN s.id, r.type, o.id LIMIT 10');
  console.log("\n📊 Data in Neo4j:");
  result.records.forEach(r => {
    console.log(`  ${r.get('s.id')} -> ${r.get('r.type')} -> ${r.get('o.id')}`);
  });

} catch(err) {
  console.error("❌ Neo4j Error:", err.message);
} finally {
  await session.close();
  await driver.close();
}
