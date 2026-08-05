import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

async function checkModels() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  const testModels = ['gemini-2.5-flash', 'gemini-1.5-flash-8b', 'gemini-2.5-pro', 'gemini-1.5-flash-002', 'gemini-1.5-pro-002'];
  
  for (const m of testModels) {
    try {
      const model = genAI.getGenerativeModel({ model: m });
      const res = await model.generateContent("Hello! Say 'OK'");
      console.log(`✅ Model '${m}' works! Response: ${res.response.text().trim()}`);
      return m;
    } catch (e) {
      console.log(`❌ Model '${m}' failed: ${e.message}`);
    }
  }
}

checkModels().catch(console.error);
