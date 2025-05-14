// index.js (with added debugging logs)

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const multer = require("multer");
const pdf = require("pdf-parse");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(bodyParser.json());

if (!process.env.GEMINI_API_KEY) {
  console.error("❌ Missing GEMINI_API_KEY in environment variables!");
  process.exit(1);
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// --- Routes ---

app.get("/", (req, res) => {
  res.status(200).send("✅ Memosize backend is running!");
});

app.post("/extract", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded." });
  }
  if (req.file.mimetype !== "application/pdf") {
    return res.status(400).json({ error: "Uploaded file is not a PDF." });
  }

  try {
    const options = {
      pagerender: (pageData) => {
        return pageData.getTextContent().then((textContent) => {
          const textItems = textContent.items.map(item => item.str);
          return textItems.join(" ") + "\n---PAGE BREAK---\n";
        });
      }
    };
    const data = await pdf(req.file.buffer, options);
    res.status(200).json({ text: data.text.trim() });
  } catch (err) {
    console.error("❌ PDF parse error:", err);
    const errorMessage = err.message || "Failed to extract text from PDF.";
    res.status(500).json({ error: errorMessage });
  }
});

app.post("/generate-flashcards", async (req, res) => {
  const { text, totalCount = 100, questionType = "Objective" } = req.body;

  // --- DEBUG LOG 1: Log received parameters ---
  console.log(`\n--- New /generate-flashcards request ---`);
  console.log(`Received questionType: '${questionType}', totalCount: ${totalCount}`);
  // --- End Debug Log 1 ---

  if (!text || typeof text !== 'string' || text.trim() === "") {
    return res.status(400).json({ error: "Text is required and must be a non-empty string." });
  }

  const requestedCount = parseInt(totalCount, 10);
  if (isNaN(requestedCount) || requestedCount <= 0) {
      return res.status(400).json({ error: "totalCount must be a positive number." });
  }
  const maxFlashcards = 250;
  const finalTotalCount = Math.min(requestedCount, maxFlashcards);

  const validTypes = ["MCQ", "Objective", "Subjective"];
  const finalQuestionType = validTypes.includes(questionType) ? questionType : "Objective";

  // --- DEBUG LOG 2: Log the validated type ---
  console.log(`Validated finalQuestionType: '${finalQuestionType}'`);
  // --- End Debug Log 2 ---

  try {
    const model = genAI.getGenerativeModel({ model: "models/gemini-1.5-flash" });
    const pages = text.split("---PAGE BREAK---").filter((page) => page && page.trim() !== "");

    if (pages.length === 0) {
        return res.status(400).json({ error: "No processable content found in the provided text after splitting by page breaks." });
    }

    const approxPerPage = Math.ceil((finalTotalCount * 1.2) / pages.length);
    let allFlashcards = [];
    let attempts = 0;
    const maxAttempts = pages.length + 2;

    while (allFlashcards.length < finalTotalCount && attempts < maxAttempts) {
        const currentPageIndex = attempts % pages.length;
        const pageText = pages[currentPageIndex]?.trim();
        attempts++;

        if (!pageText) continue;

        // --- DEBUG LOG 3: Log which type is being passed to buildPrompt ---
        console.log(`Attempt ${attempts}: Building prompt for type '${finalQuestionType}' with approx count ${approxPerPage}`);
        // --- End Debug Log 3 ---

        const prompt = buildPrompt(pageText, approxPerPage, finalQuestionType);

        // --- DEBUG LOG 4: Log the generated prompt (first 500 chars) ---
        console.log(`Attempt ${attempts}: Sending prompt (start):\n${prompt.substring(0, 500)}...\n`);
        // --- End Debug Log 4 ---

        try {
             const result = await model.generateContent(prompt);
             const rawResponse = result.response.text();

             // --- DEBUG LOG 5: Log raw response (first 500 chars) ---
             console.log(`Attempt ${attempts}: Received raw response (start):\n${rawResponse.substring(0, 500)}...\n`);
             // --- End Debug Log 5 ---

             const jsonMatch = rawResponse.match(/\[\s*{[\s\S]*?}\s*]/);

             if (jsonMatch && jsonMatch[0]) {
                 try {
                     const parsedFlashcards = JSON.parse(jsonMatch[0]);
                     if (Array.isArray(parsedFlashcards)) {
                        const validParsed = parsedFlashcards.filter(card => card && typeof card === 'object');
                        allFlashcards = allFlashcards.concat(validParsed);
                        console.log(`DEBUG: Parsed ${validParsed.length} flashcards from attempt ${attempts}. Total: ${allFlashcards.length}`);
                     } else {
                         console.warn(`⚠️ WARNING: Attempt ${attempts} response was valid JSON but not an array.`);
                     }
                 } catch (parseError) {
                     console.warn(`⚠️ WARNING: JSON parsing failed for attempt ${attempts}: ${parseError.message}. Raw start: ${rawResponse.slice(0,100)}`);
                 }
             } else {
                 console.warn(`⚠️ WARNING: No valid JSON array found in Gemini response for attempt ${attempts}. Raw start: ${rawResponse.slice(0,100)}`);
             }
        } catch (genError) {
            console.error(`❌ ERROR: Gemini generation error on attempt ${attempts}: ${genError.message}`);
        }
    }


    if (allFlashcards.length === 0) {
      return res.status(500).json({ error: "Failed to generate any valid flashcards after multiple attempts." });
    }

     const uniqueFlashcards = Array.from(new Map(allFlashcards.map(item => [item.question, item])).values());
    const limitedFlashcards = uniqueFlashcards.slice(0, Math.min(finalTotalCount + 10, maxFlashcards));

    console.log(`✅ Generated ${limitedFlashcards.length} unique flashcards (requested ${finalTotalCount}).`);
    res.status(200).json({ flashcards: limitedFlashcards });

  } catch (err) {
    console.error("❌ Flashcard generation endpoint error:", err);
    res.status(500).json({ error: err.message || "An internal server error occurred during flashcard generation." });
  }
});


// --- Helper Functions ---

function buildPrompt(text, count, type) {
  let formatInstructions = "";
  let typeDescription = "";

  // --- DEBUG LOG 6: Log entry into buildPrompt ---
  console.log(`   [buildPrompt] Called with type: '${type}'`);
  // --- End Debug Log 6 ---

  if (type === "MCQ") {
    // --- DEBUG LOG 7: Confirming MCQ block execution ---
    console.log(`   [buildPrompt] Matched type 'MCQ'. Setting MCQ instructions.`);
    // --- End Debug Log 7 ---
    typeDescription = "Multiple-Choice Questions (MCQs)";
    formatInstructions = `
Strictly output a single JSON array containing objects. Each object MUST have the following keys:
- "question": A string containing the question text.
- "options": An array of exactly 4 strings representing the answer choices.
- "answer": A string containing the correct answer, which MUST exactly match one of the strings in the "options" array.

Example of the required JSON structure:
[
  {
    "question": "What is the most abundant gas in Earth's atmosphere?",
    "options": ["Oxygen", "Hydrogen", "Nitrogen", "Carbon Dioxide"],
    "answer": "Nitrogen"
  },
  { ... }
]
`;
  } else if (type === "Objective") {
    console.log(`   [buildPrompt] Matched type 'Objective'. Setting Objective instructions.`);
    typeDescription = "Objective Questions (True/False, Fill-in-the-blanks, Definitions)";
    formatInstructions = `
Strictly output a single JSON array containing objects. Each object MUST have the following keys:
- "question": A string containing the question text. Include hints like "(True/False)" or "(Fill in the blank: ___)" or "(Define)" where appropriate.
- "answer": A string containing the correct answer.

Example of the required JSON structure:
[
  {
    "question": "The Earth revolves around the Sun. (True/False)",
    "answer": "True"
  },
  { ... }
]
`;
  } else { // Subjective
    console.log(`   [buildPrompt] Defaulting to/Matched type 'Subjective'. Setting Subjective instructions.`);
    type = "Subjective";
    typeDescription = "Subjective / Short Answer Questions";
    formatInstructions = `
Strictly output a single JSON array containing objects. Each object MUST have the following keys:
- "question": A string containing the question prompting for a short explanation or description.
- "answer": A string providing a concise summary or key points for the answer, derived directly from the text.

Example of the required JSON structure:
[
  {
    "question": "Explain the main function of the mitochondria based on the text.",
    "answer": "Mitochondria are often called the 'powerhouses' of the cell..."
  },
  { ... }
]
`;
  }

  return `
You are an AI assistant specialized in creating educational flashcards from provided text.
Your task is to generate high-quality questions based on the specified type and quantity, formatted precisely according to the instructions.

**Input Text:**
--- START OF TEXT ---
${text}
--- END OF TEXT ---

**Task Details:**
1.  **Flashcard Type:** Generate ${typeDescription}.
2.  **Quantity:** Generate approximately ${count} flashcards. Prioritize quality and relevance.
3.  **Source:** Base all questions and answers *exclusively* on the provided Input Text.

**Required Output Format:**
${formatInstructions}

**Critical Instructions & Rules:**
- Your *entire* response MUST be a single, valid JSON array, enclosed in square brackets [...]
- Do NOT include any text, explanations, or markdown outside the JSON array.
- Strictly adhere to the JSON structure and keys specified for the "${type}" flashcard type.
- Ensure content directly reflects the Input Text. Generate fewer cards if the text lacks detail.
`;
}


// --- Start Server ---
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
