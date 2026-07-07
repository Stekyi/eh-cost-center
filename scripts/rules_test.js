// Minimal Firestore rules test script for emulator
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const admin = require('firebase-admin');
const { initializeTestApp, initializeAdminApp, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');

const PROJECT_ID = 'demo-firestore-rules';

async function runTests() {
  // Non-admin test user
  const testUser = {
    uid: 'testuser1',
    email: 'notadmin@example.com',
  };
  const adminUser = {
    uid: 'adminuser1',
    email: 'samueltekyi@gmail.com',
  };

  // Init test apps
  const nonAdminApp = initializeTestApp({
    projectId: PROJECT_ID,
    auth: testUser,
  });
  const adminApp = initializeTestApp({
    projectId: PROJECT_ID,
    auth: adminUser,
  });
  const dbNonAdmin = nonAdminApp.firestore();
  const dbAdmin = adminApp.firestore();

  // Try to write payment as non-admin
  try {
    await assertFails(dbNonAdmin.collection('orders').doc('order1').collection('payments').add({
      orderId: 'order1',
      amount: 50,
      recordedAt: new Date(),
      recordedBy: testUser.uid,
    }));
    console.log('Non-admin payment write correctly denied');
  } catch (e) {
    console.error('Non-admin payment write error:', e);
  }

  // Try to write payment as admin
  try {
    await assertSucceeds(dbAdmin.collection('orders').doc('order1').collection('payments').add({
      orderId: 'order1',
      amount: 50,
      recordedAt: new Date(),
      recordedBy: adminUser.uid,
    }));
    console.log('Admin payment write succeeded');
  } catch (e) {
    console.error('Admin payment write error:', e);
  }
}

runTests().then(() => process.exit(0));
