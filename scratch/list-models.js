import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config({ path: './.env' });
const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function listModels() {
    try {
        const response = await genai.models.list();
        console.log('Response:', JSON.stringify(response, null, 2));
    } catch (e) {
        console.error(e);
    }
}
listModels();
