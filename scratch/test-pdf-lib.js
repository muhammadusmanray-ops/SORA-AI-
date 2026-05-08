import { PDFParse } from 'pdf-parse';
import fs from 'fs';

async function check() {
    console.log('PDFParse type:', typeof PDFParse);
    const parser = new PDFParse({});
    console.log('Parser keys:', Object.keys(parser));
    console.log('Parser proto keys:', Object.getOwnPropertyNames(Object.getPrototypeOf(parser)));
    
    const buffer = fs.readFileSync('D:/Profile.pdf');
    try {
        const result = await parser.getText(buffer);
        console.log('Result keys:', Object.keys(result));
        console.log('Text length:', result.text?.length);
    } catch (e) {
        console.error('Parse error:', e);
    }
}
check();
