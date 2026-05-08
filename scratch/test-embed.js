import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config({ path: './.env' });
const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function testEmbed() {
    try {
        const response = await genai.models.embedContent({
            model: 'gemini-embedding-2',
            contents: [{ parts: [{ text: 'Hello world' }] }]
        });
        console.log('Embed Result:', response.embeddings[0].values.slice(0, 5));
    } catch (e) {
        console.error('Embed Error:', e);
    }
}
testEmbed();
