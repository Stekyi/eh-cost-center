// Minimal Firestore rules test script for emulator (ESM)
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';

const PROJECT_ID = 'demo-firestore-rules';
const RULES_PATH = './firestore.rules';

async function runTests() {
  const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(RULES_PATH, 'utf8'),
    },
  });

  const testUser = env.authenticatedContext('testuser1', { email: 'notadmin@example.com' });
  const adminUser = env.authenticatedContext('adminuser1', { email: 'samueltekyi@gmail.com' });

  const dbNonAdmin = testUser.firestore();
  const dbAdmin = adminUser.firestore();

  // Try to write payment as non-admin
  await assertFails(dbNonAdmin.collection('orders').doc('order1').collection('payments').add({
    orderId: 'order1',
    amount: 50,
    recordedAt: new Date(),
    recordedBy: 'testuser1',
  })).then(() => console.log('Non-admin payment write correctly denied'));

  // Try to write payment as admin
  await assertSucceeds(dbAdmin.collection('orders').doc('order1').collection('payments').add({
    orderId: 'order1',
    amount: 50,
    recordedAt: new Date(),
    recordedBy: 'adminuser1',
  })).then(() => console.log('Admin payment write succeeded'));

  await env.cleanup();
}

runTests().then(() => process.exit(0));
