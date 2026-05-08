import { GoogleGenAI } from '@google/genai';
const genai = new GoogleGenAI({ apiKey: 'test' });
console.log('Models Keys:', Object.keys(genai.models));
