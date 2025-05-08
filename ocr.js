const Tesseract = require("tesseract.js");
const fs = require("fs");
const path = require("path");
const { PDFDocument } = require("pdf-lib");
const pdfParse = require("pdf-parse");
const { PdfConverter } = require("pdf-poppler");

// Extract text using pdf-parse
async function extractTextFromPdfParse(pdfPath) {
  const dataBuffer = fs.readFileSync(pdfPath);
  const data = await pdfParse(dataBuffer);
  return data.text;
}

// Try using pdf-lib (experimental)
async function extractTextFromPdfLib(pdfPath) {
  const fileBuffer = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(fileBuffer);
  const pages = pdfDoc.getPages();
  return pages
    .map((page) => page.getTextContent?.()?.items?.map((i) => i.str).join(" ") ?? "")
    .join("\n");
}

// OCR for an image
async function extractTextFromImage(imagePath) {
  const {
    data: { text },
  } = await Tesseract.recognize(imagePath, "eng", {
    logger: (m) => console.log(m.status, Math.round((m.progress || 0) * 100) + "%"),
  });
  return text;
}

// Convert PDF to images using pdf-poppler
async function convertPdfToImages(pdfPath) {
  const outputDir = path.join(__dirname, "output_images");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

  const options = {
    format: "jpeg",
    out_dir: outputDir,
    out_prefix: "page",
    scale: 1024,
  };

  const converter = new PdfConverter(pdfPath);
  await converter.convert(options);

  // Return all generated image paths
  return fs
    .readdirSync(outputDir)
    .filter((file) => file.startsWith("page") && file.endsWith(".jpg"))
    .map((file) => path.join(outputDir, file));
}

// Hybrid text extraction
async function hybridExtractText({ pdfPath = null, imagePaths = [] }) {
  let text = "";

  if (pdfPath) {
    console.log("Extracting text from PDF (structured methods)...");
    const [textFromParse, textFromLib] = await Promise.all([
      extractTextFromPdfParse(pdfPath),
      extractTextFromPdfLib(pdfPath),
    ]);
    text += textFromParse + "\n" + textFromLib;

    console.log("Converting PDF pages to images and running OCR...");
    const imagePathsFromPdf = await convertPdfToImages(pdfPath);

    for (const imagePath of imagePathsFromPdf) {
      console.log(`Extracting text via OCR from: ${imagePath}`);
      const ocrText = await extractTextFromImage(imagePath);
      text += "\n" + ocrText;
      fs.unlinkSync(imagePath); // Clean up
    }
  }

  for (const imagePath of imagePaths) {
    console.log(`Extracting text via OCR from: ${imagePath}`);
    const ocrText = await extractTextFromImage(imagePath);
    text += "\n" + ocrText;
  }

  return text.trim();
}

module.exports = { hybridExtractText };
