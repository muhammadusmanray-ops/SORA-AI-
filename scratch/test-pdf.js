import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');
console.log('Type:', typeof pdf);
console.log('Keys:', Object.keys(pdf));
if (typeof pdf === 'function') {
    console.log('PDF is a function');
} else if (pdf.default && typeof pdf.default === 'function') {
    console.log('PDF.default is a function');
} else if (pdf.PDFParse && typeof pdf.PDFParse === 'function') {
    console.log('PDF.PDFParse is a function');
} else {
    console.log('No function found');
}
