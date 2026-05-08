import fs from 'fs';
import FormData from 'form-data';

async function testPdfUpload() {
    console.log("---TESTING PDF UPLOAD---");
    const filePath = "uploads/8330cb1958bff379612c655a0ac896c7";
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath), 'test.pdf');

    try {
        const response = await fetch("http://localhost:3000/api/ingest/pdf", {
            method: "POST",
            body: formData
        });
        const result = await response.json();
        console.log("PDF Result:", JSON.stringify(result, null, 2));
    } catch (e) {
        console.error("PDF Upload Error:", e);
    }
}

testPdfUpload();
