// Helper to base64 encode service account key for Vercel
const fs = require('fs');
const path = require('path');

const keyPath = process.argv[2] || './serviceAccountKey.json';

if (!fs.existsSync(keyPath)) {
  console.error('Service account key file not found:', keyPath);
  console.error('Usage: node encode_sa_key.js <path-to-service-account-key.json>');
  process.exit(1);
}

const keyContent = fs.readFileSync(keyPath, 'utf8');
const base64 = Buffer.from(keyContent).toString('base64');

console.log('\n=== Base64 Encoded Service Account Key ===\n');
console.log(base64);
console.log('\n\nCopy the above value and add it to Vercel as FIREBASE_SA_KEY environment variable');
console.log('Run: npx vercel env add FIREBASE_SA_KEY production --token $env:VERCEL_TOKEN');
