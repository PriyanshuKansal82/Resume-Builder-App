import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Helper: get a Gemini model instance
export const getModel = (modelName) => {
  return genAI.getGenerativeModel({
    model: modelName || process.env.GEMINI_MODEL || "gemini-2.0-flash",
  });
};

export default genAI;
