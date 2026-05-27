import { getModel } from "../configs/ai.js";
import Resume from "../models/Resume.js";

// Helper: call Gemini with a system instruction + user message and get text back
const askGemini = async (systemInstruction, userContent) => {
  const model = getModel();
  const result = await model.generateContent({
    systemInstruction: {
      role: "user",
      parts: [{ text: systemInstruction }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userContent }],
      },
    ],
  });
  return result.response.text();
};

// Basic regex-based resume parser (fallback when AI is unavailable)
const parseResumeWithRegex = (text) => {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // Extract email
  const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
  const email = emailMatch ? emailMatch[0] : "";

  // Extract phone
  const phoneMatch = text.match(/(\+?\d[\d\s\-().]{7,}\d)/);
  const phone = phoneMatch ? phoneMatch[1].trim() : "";

  // Extract LinkedIn
  const linkedinMatch = text.match(/linkedin\.com\/in\/[\w-]+/i);
  const linkedin = linkedinMatch ? "https://" + linkedinMatch[0] : "";

  // Extract website/GitHub
  const websiteMatch = text.match(/github\.com\/[\w-]+|https?:\/\/(?!linkedin)[\w.-]+\.\w+\/[\w.-]*/i);
  const website = websiteMatch ? websiteMatch[0] : "";

  // Name is usually the first non-empty line
  const full_name = lines[0] || "";

  // Profession is usually the second line
  const profession = lines[1] && !lines[1].includes("@") ? lines[1] : "";

  // Location — look for City, State pattern
  const locationMatch = text.match(/[A-Z][a-z]+,\s*[A-Z]{2}|[A-Z][a-z]+,\s*[A-Z][a-z]+/);
  const location = locationMatch ? locationMatch[0] : "";

  // Extract skills — look for a skills section
  const skillsMatch = text.match(/skills[:\s]+([\s\S]*?)(?:\n\n|\n[A-Z]|$)/i);
  let skills = [];
  if (skillsMatch) {
    skills = skillsMatch[1]
      .split(/[,|•·\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 1 && s.length < 40);
  }

  // Extract summary — look for summary/objective section
  const summaryMatch = text.match(/(?:summary|objective|profile)[:\s]+([\s\S]*?)(?:\n\n|\n[A-Z]|$)/i);
  const professional_summary = summaryMatch ? summaryMatch[1].replace(/\s+/g, " ").trim() : "";

  return {
    professional_summary,
    skills,
    personal_info: {
      image: "",
      full_name,
      profession,
      email,
      phone,
      location,
      linkedin,
      website,
    },
    experience: [],
    project: [],
    education: [],
  };
};

// Controller for enhancing a resume's professional summary
// POST: /api/ai/enhanced-pro-sum
export const enhanceProfessionalSummary = async (req, res) => {
  try {
    const { userContent } = req.body;

    if (!userContent) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const systemInstruction =
      "You are an expert in resume writing. Your task is to enhance the professional summary of a resume. The summary should be 2-4 sentences highlighting key skills, experience, and career objectives. Make it compelling and ATS-friendly. Return ONLY the enhanced summary text with no extra commentary, options, or formatting.";

    const enhancedContent = await askGemini(systemInstruction, userContent);

    return res.status(200).json({ enhancedContent: enhancedContent.trim() });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};

// Controller for enhancing a resume's job description
// POST: /api/ai/enhanced-job-desc
export const enhanceJobDescription = async (req, res) => {
  try {
    const { userContent } = req.body;

    if (!userContent) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const systemInstruction =
      "You are an expert in resume writing. Your task is to enhance job description bullet points for a resume. Highlight key responsibilities and achievements. Use strong action verbs and quantifiable results where possible. Make it ATS-friendly. Return ONLY the enhanced description text with no extra commentary or options.";

    const enhancedContent = await askGemini(systemInstruction, userContent);

    return res.status(200).json({ enhancedContent: enhancedContent.trim() });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};

// Controller for uploading a resume PDF (as text) and parsing it into structured data
// POST: /api/ai/upload-resume
export const uploadResume = async (req, res) => {
  try {
    const { resumeText, title } = req.body;
    const userId = req.userId;

    if (!resumeText) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const systemInstruction =
      "You are an expert AI agent that extracts structured data from resume text. You MUST respond with ONLY valid JSON and absolutely nothing else — no markdown, no code fences, no explanations.";

    const userPrompt = `Extract all information from this resume text and return it as a single valid JSON object with exactly this structure:

{
  "professional_summary": "string",
  "skills": ["skill1", "skill2"],
  "personal_info": {
    "image": "",
    "full_name": "string",
    "profession": "string",
    "email": "string",
    "phone": "string",
    "location": "string",
    "linkedin": "string",
    "website": "string"
  },
  "experience": [
    {
      "company": "string",
      "position": "string",
      "start_date": "YYYY-MM",
      "end_date": "YYYY-MM",
      "description": "string",
      "is_current": false
    }
  ],
  "project": [
    {
      "name": "string",
      "type": "string",
      "description": "string"
    }
  ],
  "education": [
    {
      "institution": "string",
      "degree": "string",
      "field": "string",
      "graduation_date": "YYYY-MM",
      "gpa": "string"
    }
  ]
}

Resume text:
${resumeText}`;

    let parsedData;
    let usedAI = false;

    try {
      // Try Gemini AI first
      const model = getModel();
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        systemInstruction: {
          role: "user",
          parts: [{ text: systemInstruction }],
        },
        generationConfig: {
          responseMimeType: "application/json",
        },
      });

      const rawText = result.response.text();
      const cleanedText = rawText
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/gi, "")
        .trim();

      parsedData = JSON.parse(cleanedText);
      usedAI = true;
    } catch (aiError) {
      // AI unavailable — use basic regex parser as fallback
      console.log("AI unavailable, using regex parser:", aiError.message);
      parsedData = parseResumeWithRegex(resumeText);
    }

    // Ensure skills is always an array of strings
    if (parsedData.skills && Array.isArray(parsedData.skills)) {
      parsedData.skills = parsedData.skills.map((s) =>
        typeof s === "string" ? s : String(s)
      );
    }

    // Create new resume in the database with the parsed data
    const newResume = await Resume.create({ userId, title, ...parsedData });

    return res.status(201).json({
      resumeId: newResume._id,
      usedAI,
      message: usedAI
        ? "Resume parsed with AI successfully"
        : "Resume created with basic parsing — review and complete details",
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};
