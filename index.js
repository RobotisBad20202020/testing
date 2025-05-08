const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { hybridExtractText } = require('./ocr');

const app = express();
const upload = multer({ dest: 'uploads/' });
app.get('/', (req, res) => {
    res.send(`
      <h2>Upload a PDF</h2>
      <form action="/extract-text" method="post" enctype="multipart/form-data">
        <input type="file" name="pdf" accept=".pdf" required />
        <br/><br/>
        <button type="submit">Extract Text</button>
      </form>
    `);
});

app.post('/extract-text', upload.single('pdf'), async (req, res) => {
    const pdfPath = req.file.path;

    try {
        const dataBuffer = fs.readFileSync(pdfPath);
        const parsed = await pdfParse(dataBuffer);

        const hybridText = await hybridExtractText(pdfPath, parsed.numpages);

        fs.unlinkSync(pdfPath); // cleanup
        res.json({ text: hybridText });
    }catch (err) {
        console.error('Detailed error:', err);
        res.status(500).send(`Error processing PDF: ${err.message}`);
    }
  
});

app.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});
