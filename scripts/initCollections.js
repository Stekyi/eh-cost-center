// Initialize Firestore collections with starter data
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const path = require('path');

// Initialize Firebase Admin
const serviceAccount = require('C:\\secret\\eh-cost-center-firebase-adminsdk-fbsvc-2323d0af43.json');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function initializeCollections() {
  console.log('🚀 Initializing Firestore collections...');
  
  const now = Timestamp.now();
  const adminUid = 'SYSTEM_INIT';

  try {
    // 1. Create customers collection
    const customerRef = await db.collection('customers').add({
      name: 'Walk-in Customer',
      phone: '',
      email: '',
      address: '',
      createdAt: now,
      createdBy: adminUid,
      modifiedAt: now,
      modifiedBy: adminUid
    });
    console.log('✅ Created customers collection with ID:', customerRef.id);

    // 2. Create products collection
    const productRef = await db.collection('products').add({
      name: 'Sample Product',
      category: 'General',
      unit: 'pcs',
      unitCost: 0,
      sellingPrice: 0,
      createdAt: now,
      createdBy: adminUid,
      modifiedAt: now,
      modifiedBy: adminUid
    });
    console.log('✅ Created products collection with ID:', productRef.id);

    // 3. Create staff collection
    const staffRef = await db.collection('staff').add({
      name: 'Sample Staff',
      role: 'General',
      phone: '',
      email: '',
      salary: 0,
      createdAt: now,
      createdBy: adminUid,
      modifiedAt: now,
      modifiedBy: adminUid
    });
    console.log('✅ Created staff collection with ID:', staffRef.id);

    // 4. Create assets collection
    const assetRef = await db.collection('assets').add({
      name: 'Sample Asset',
      category: 'Equipment',
      purchaseDate: now,
      purchasePrice: 0,
      currentValue: 0,
      createdAt: now,
      createdBy: adminUid,
      modifiedAt: now,
      modifiedBy: adminUid
    });
    console.log('✅ Created assets collection with ID:', assetRef.id);

    // 5. Create expenseItems collection
    const expenseRef = await db.collection('expenseItems').add({
      description: 'Sample Expense',
      amount: 0,
      costType: 'variable',
      date: now,
      createdAt: now,
      createdBy: adminUid,
      modifiedAt: now,
      modifiedBy: adminUid
    });
    console.log('✅ Created expenseItems collection with ID:', expenseRef.id);

    // Seed expense categories
    const categories = [
      { code: 'EXP001', label: 'Ingredients' },
      { code: 'EXP002', label: 'Packaging' },
      { code: 'EXP003', label: 'Labour' },
      { code: 'EXP004', label: 'Logistics / Transport' },
      { code: 'EXP005', label: 'Utilities (Gas, Water, Electricity)' },
      { code: 'EXP006', label: 'Equipment / Repairs' },
      { code: 'EXP007', label: 'Marketing' },
      { code: 'EXP008', label: 'Miscellaneous' },
    ]
    for(const c of categories) {
      await db.collection('expenseCategories').add({ ...c, createdAt: now, createdBy: adminUid })
    }

    const customerCategories = [
      { code: 'CAT001', label: 'PCOS Support' },
      { code: 'CAT002', label: 'Fibroid Support' },
      { code: 'CAT003', label: 'Diabetes Support' },
      { code: 'CAT004', label: 'Hypertension Support' },
      { code: 'CAT005', label: 'Weight Management' },
      { code: 'CAT006', label: 'Low Carb Lifestyle' },
      { code: 'CAT007', label: 'Postpartum Nutrition' },
      { code: 'CAT008', label: 'General Wellness' },
    ]
    for (const c of customerCategories) {
      await db.collection('customerCategories').add({ ...c, active: true, createdAt: now, createdBy: adminUid })
    }

    const customerAllergies = [
      { code: 'ALG001', label: 'Citrus Allergy' },
      { code: 'ALG002', label: 'Pineapple Sensitivity' },
      { code: 'ALG003', label: 'Tomato Allergy' },
      { code: 'ALG004', label: 'Pepper Allergy' },
      { code: 'ALG005', label: 'Avocado Sensitivity' },
      { code: 'ALG006', label: 'Mushroom Allergy' },
      { code: 'ALG007', label: 'Nut Allergy' },
      { code: 'ALG008', label: 'Dairy Intolerance' },
      { code: 'ALG009', label: 'Egg Allergy' },
      { code: 'ALG010', label: 'Soy Allergy' },
      { code: 'ALG011', label: 'Gluten Sensitivity' },
    ]
    for (const a of customerAllergies) {
      await db.collection('customerAllergies').add({ ...a, active: true, createdAt: now, createdBy: adminUid })
    }

    // 6. Create orders collection
    const orderRef = await db.collection('orders').add({
      orderNumber: 'ORD-00001',
      customerId: customerRef.id,
      customerName: 'Walk-in Customer',
      items: [{
        productId: productRef.id,
        productName: 'Sample Product',
        quantity: 1,
        unitPrice: 0,
        total: 0
      }],
      subtotal: 0,
      deliveryFee: 0,
      total: 0,
      status: 'pending',
      orderDate: now,
      createdAt: now,
      createdBy: adminUid,
      modifiedAt: now,
      modifiedBy: adminUid
    });
    console.log('✅ Created orders collection with ID:', orderRef.id);

    // 7. Create revenue collection (requires admin email)
    // Note: This will be created when first payment is recorded
    console.log('ℹ️  Revenue collection will be created on first payment recording');

    console.log('\n🎉 All collections initialized successfully!');
    console.log('\n📝 Note: You can now delete these sample documents from the Firebase Console');
    console.log('   or keep them as templates. Your app should work now.');
    
  } catch (error) {
    console.error('❌ Error initializing collections:', error);
    process.exit(1);
  }
}

initializeCollections()
  .then(() => {
    console.log('\n✨ Done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
