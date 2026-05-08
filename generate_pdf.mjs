import fs from 'fs';
import PDFDocument from 'pdfkit';

async function generateBankPDF() {
  const doc = new PDFDocument();
  // We save it to the D drive as requested
  const outputPath = './test_bank_statement.pdf';
  doc.pipe(fs.createWriteStream(outputPath));

  // Add some bank text
  doc.fontSize(25).text('Meezan Bank Statement', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text('Account Holder: Hafiz');
  doc.text('Account Number: PK34MEZN0000123456789');
  doc.text('Statement Period: Jan 01, 2026 - Jan 31, 2026');
  doc.moveDown();

  doc.text('Transaction History:');
  doc.text('1. Jan 05: Deposit - Rs. 50,000');
  doc.text('2. Jan 12: ATM Withdrawal - Rs. 10,000');
  doc.text('3. Jan 20: Online Transfer (LlamaGraph Subscription) - Rs. 5,000');
  doc.moveDown();
  doc.text('Total Balance: Rs. 35,000');
  doc.moveDown();
  
  // Add a shape as an "image"
  doc.rect(doc.x, doc.y, 200, 100).fill('#003366');
  doc.fillColor('white').text('CONFIDENTIAL BANK SEAL / LOGO', doc.x + 10, doc.y - 50);

  // Add text explaining the chart
  doc.fillColor('black').moveDown(4);
  doc.text('The blue box above represents the official Meezan Bank secure seal. Only valid if colored dark blue.', { align: 'center' });

  doc.end();
  console.log(`Bank Statement PDF created at: ${outputPath}`);
}

generateBankPDF().catch(console.error);
