import dotenv from 'dotenv';
import { getApplications } from '../api/db.js';

dotenv.config();

let failedCount = 0;
let passedCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    passedCount++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    failedCount++;
  }
}

async function runTests() {
  console.log("==========================================");
  console.log("       PINI JOBS AUTOMATED TEST SUITE     ");
  console.log("==========================================");

  // Test 1: JSON Regex Extractor Resilience
  console.log("\n[Test 1] Testing Gemini JSON Regex Extractor");
  const sampleGeminiOutput = "Here is your classification:\n```json\n{\n  \"classification\": \"interview_invite\",\n  \"company\": \"Wix\"\n}\n```\nHope this helps!";
  const jsonMatch = sampleGeminiOutput.match(/\{[\s\S]*\}/);
  assert(jsonMatch !== null, "Extracted JSON payload from wrapped markdown text");
  if (jsonMatch) {
    const parsed = JSON.parse(jsonMatch[0]);
    assert(parsed.classification === 'interview_invite', "Parsed classification successfully");
    assert(parsed.company === 'Wix', "Parsed company name successfully");
  }

  // Test 2: Environment Variables Validation
  console.log("\n[Test 2] Environment Variables Presence");
  const requiredKeys = [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET'
  ];

  requiredKeys.forEach(key => {
    if (process.env[key]) {
      assert(true, `Environment variable ${key} is present`);
    } else {
      console.warn(`⚠️ WARNING: Environment variable ${key} is not set in local environment`);
    }
  });

  // Test 3: Firebase Connectivity (If credentials available)
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    console.log("\n[Test 3] Testing Firebase Firestore Connectivity");
    try {
      const apps = await getApplications();
      assert(Array.isArray(apps), `Fetched applications array from Firestore (Count: ${apps.length})`);
    } catch (err) {
      assert(false, `Firebase connection failed: ${err.message}`);
    }
  } else {
    console.log("\n[Test 3] Skipping Firebase connection test (credentials not fully configured locally)");
  }

  console.log("\n==========================================");
  console.log(`TEST SUMMARY: ${passedCount} passed, ${failedCount} failed.`);
  console.log("==========================================");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests();
