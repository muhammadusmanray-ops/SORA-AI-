import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';
dotenv.config();

const uri = process.env.NEO4J_URI || "";
const user = process.env.NEO4J_USERNAME || "";
const password = process.env.NEO4J_PASSWORD || "";

// Initialize the Neo4j Driver
export const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));

/**
 * Saves extracted triplets (Subject, Predicate, Object) into Neo4j
 */
export const saveTripletsToNeo4j = async (triplets: any[], source?: string) => {
  const session = driver.session();
  try {
    if (source) {
      // Create source node
      await session.run(`MERGE (s:Source {id: $source})`, { source: source.toUpperCase() });
    }

    for (const t of triplets) {
      if (!t.subject || !t.object || !t.predicate) continue;
      
      const sub = t.subject.toString().toUpperCase();
      const obj = t.object.toString().toUpperCase();
      const pred = t.predicate.toString().toUpperCase().replace(/\s+/g, '_');

      // Cypher Query to create nodes and relationships
      const query = `
        MERGE (s:Entity {id: $subject})
        MERGE (o:Entity {id: $object})
        MERGE (s)-[r:RELATED_TO {type: $predicate}]->(o)
      `;
      await session.run(query, { subject: sub, object: obj, predicate: pred });

      if (source) {
        // Link entities to source
        await session.run(`
          MATCH (e:Entity {id: $subject}), (src:Source {id: $source})
          MERGE (e)-[:MENTIONED_IN]->(src)
        `, { subject: sub, source: source.toUpperCase() });
        
        await session.run(`
          MATCH (e:Entity {id: $object}), (src:Source {id: $source})
          MERGE (e)-[:MENTIONED_IN]->(src)
        `, { object: obj, source: source.toUpperCase() });
      }
    }
    console.log(`✅ Successfully saved ${triplets.length} knowledge triplets to Neo4j Cloud!`);
  } catch (error) {
    console.error("❌ Error saving to Neo4j:", error);
  } finally {
    await session.close();
  }
};
