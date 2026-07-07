// Test RAG API endpoint
const admin = require('firebase-admin');
const fetch = require('node-fetch');

const serviceAccount = require('C:\\secret\\eh-cost-center-firebase-adminsdk-fbsvc-2323d0af43.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

async function test() {
  try {
    // Create a custom token for the admin user
    const uid = 'KKEWvkShBJbD0fGYOGMG74GUZ5A3'; // Your user ID
    const token = await admin.auth().createCustomToken(uid, { admin: true });
    
    console.log('Custom token created');
    
    // Exchange for ID token (you'd need to do this in the browser)
    // For now, let's just test with the service account directly
    
    // Or try to call the API without auth to see the error
    const response = await fetch('https://eh-cost-center.vercel.app/api/rag/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ question: 'What products do we sell?' })
    });
    
    const data = await response.json();
    console.log('Response:', JSON.stringify(data, null, 2));
    
  } catch (error) {
    console.error('Error:', error.message);
  }
  
  process.exit(0);
}

test();
