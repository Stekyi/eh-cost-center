// Client-side Firestore test: non-admin user tries to write payment
const { initializeApp } = require('firebase/app');
const { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword } = require('firebase/auth');
const { getFirestore, collection, doc, addDoc } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || '<firebase-web-api-key>',
  authDomain: 'eh-cost-center.firebaseapp.com',
  projectId: 'eh-cost-center',
  storageBucket: 'eh-cost-center.firebasestorage.app',
  messagingSenderId: '494392853146',
  appId: '1:494392853146:web:f251da5fd877d51168d523',
};

async function run() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  // Create or sign in as non-admin test user
  let user;
  try {
    user = await createUserWithEmailAndPassword(auth, 'notadmin@example.com', 'test1234');
    console.log('Created test user');
  } catch (e) {
    user = await signInWithEmailAndPassword(auth, 'notadmin@example.com', 'test1234');
    console.log('Signed in as test user');
  }

  // Try to write payment
  try {
    await addDoc(collection(doc(db, 'orders', 'order1'), 'payments'), {
      orderId: 'order1',
      amount: 50,
      recordedAt: new Date(),
      recordedBy: user.user.uid,
    });
    console.log('Non-admin payment write succeeded (should be denied)');
  } catch (e) {
    console.error('Non-admin payment write denied as expected:', e.message);
  }
}

run();
