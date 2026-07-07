// Seed script to populate rag_embeddings collection with data from orders, products, customers, etc.
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Initialize Firebase Admin
const serviceAccountPath = process.env.FIREBASE_SA_PATH || 'C:\\secret\\eh-cost-center-firebase-adminsdk-fbsvc-2323d0af43.json';

if (fs.existsSync(serviceAccountPath)) {
  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('Firebase Admin initialized with service account');
} else {
  admin.initializeApp();
  console.log('Firebase Admin initialized with default credentials');
}

const db = admin.firestore();

async function seedEmbeddings() {
  console.log('Starting RAG embeddings seed...\n');
  
  const embeddingsRef = db.collection('rag_embeddings');
  let count = 0;
  
  // Seed Products
  console.log('Seeding products...');
  const productsSnap = await db.collection('products').get();
  for (const doc of productsSnap.docs) {
    const data = doc.data();
    const text = `Product: ${data.name || 'Unnamed'}. Type: ${data.type || 'N/A'}. Unit: ${data.unit || 'N/A'}. Price: ${data.price || 0}. Cost: ${data.cost || 0}.`;
    
    await embeddingsRef.add({
      text,
      content: text,
      source: 'products',
      sourceId: doc.id,
      meta: { name: data.name || '', type: data.type || '', price: data.price || 0 },
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    count++;
  }
  console.log(`  Added ${productsSnap.size} products\n`);
  
  // Seed Customers
  console.log('Seeding customers...');
  const customersSnap = await db.collection('customers').get();
  for (const doc of customersSnap.docs) {
    const data = doc.data();
    const text = `Customer: ${data.name || 'Unnamed'}. Phone: ${data.phone || 'N/A'}. Location: ${data.location || 'N/A'}. Balance: ${data.balance || 0}.`;
    
    await embeddingsRef.add({
      text,
      content: text,
      source: 'customers',
      sourceId: doc.id,
      meta: { name: data.name || '', phone: data.phone || '', location: data.location || '' },
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    count++;
  }
  console.log(`  Added ${customersSnap.size} customers\n`);
  
  // Seed Orders (summary only)
  console.log('Seeding orders...');
  const ordersSnap = await db.collection('orders').limit(50).get();
  for (const doc of ordersSnap.docs) {
    const data = doc.data();
    const customerName = data.customerName || 'Unknown customer';
    const status = data.status || 'unknown';
    const total = data.totalAmount || 0;
    const itemCount = (data.items || []).length;
    
    const text = `Order for ${customerName}. Status: ${status}. Total: ${total}. Items: ${itemCount}. Order ID: ${doc.id}.`;
    
    await embeddingsRef.add({
      text,
      content: text,
      source: 'orders',
      sourceId: doc.id,
      meta: { customerName: customerName || '', status: status || '', totalAmount: total || 0 },
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    count++;
  }
  console.log(`  Added ${Math.min(ordersSnap.size, 50)} orders\n`);
  
  console.log(`✅ Seeding complete! Added ${count} documents to rag_embeddings collection.`);
  console.log('\nNote: Embeddings are null and will be computed on-demand by the RAG API.');
  
  process.exit(0);
}

seedEmbeddings().catch(err => {
  console.error('Error seeding embeddings:', err);
  process.exit(1);
});
