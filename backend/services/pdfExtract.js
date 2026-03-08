/**
 * PDF text extraction using Python pdfminer
 * Works on Railway without qpdf, handles password-protected PDFs natively
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function extractPdfText(pdfBuffer, passwords = []) {
  const tmpPdf = path.join(os.tmpdir(), `cas_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
  
  try {
    fs.writeFileSync(tmpPdf, pdfBuffer);
    
    // Build password list: always try empty first, then provided passwords
    const allPasswords = ['', ...passwords].filter((p, i, arr) => arr.indexOf(p) === i);
    
    const scriptPath = path.join(__dirname, 'pdfExtractor.py');
    
    const result = spawnSync('python3', [scriptPath, tmpPdf, ...allPasswords], {
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024 // 10MB
    });
    
    if (result.status === 0 && result.stdout) {
      const text = result.stdout.toString('utf-8');
      if (text.trim().length > 100) {
        console.log(JSON.stringify({ event: 'PDF_EXTRACTED_PYTHON', chars: text.length, preview: text.slice(0, 100).replace(/\n/g,' ') }));
        return text;
      }
    }
    
    if (result.stderr) {
      console.log(JSON.stringify({ event: 'PDF_PYTHON_ERROR', error: result.stderr.toString().slice(0, 200) }));
    }
    
    return null;
  } finally {
    try { fs.unlinkSync(tmpPdf); } catch(e) {}
  }
}

module.exports = { extractPdfText };
