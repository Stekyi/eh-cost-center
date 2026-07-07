/**
 * Seed script for the EH Cost Center app.
 * Automatically connects to Firestore emulator at localhost:8080.
 */

// Force emulator connection
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080'

const admin = require('firebase-admin')

admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'eh-cost-center-local' })
const db = admin.firestore()

async function seed(){
  console.log('Seeding sample data...')
  // customers
  const customers = ['Alice', 'Bob', 'Charlie', 'Diana']
  for(const name of customers){
    await db.collection('customers').add({ name, createdAt: admin.firestore.FieldValue.serverTimestamp(), createdBy: 'Angela' })
  }
  // products (small set)
  const juices = ['PCOS','Fibroids','Weight Loss Challenges']
  for(const name of juices){
    await db.collection('products').add({ name, type: 'juice', unitsPerPackage: 1, unitCost: 1000, createdAt: admin.firestore.FieldValue.serverTimestamp(), createdBy: 'Angela' })
  }
  const meals = ['low carb meal','weightloss meal']
  for(const name of meals){
    await db.collection('products').add({ name, type: 'meal', unitsPerPackage: 1, unitCost: 2000, createdAt: admin.firestore.FieldValue.serverTimestamp(), createdBy: 'Angela' })
  }
  // staff
  await db.collection('staff').add({ name: 'Worker 1', salary: 50000, status: 'active', createdAt: admin.firestore.FieldValue.serverTimestamp(), createdBy: 'Angela' })
  // expense items
  await db.collection('expenseItems').add({ name: 'Raw materials', amount: 100000, costType: 'variable', appliesTo: ['all'], date: admin.firestore.FieldValue.serverTimestamp(), createdAt: admin.firestore.FieldValue.serverTimestamp() })
  await db.collection('expenseItems').add({ name: 'Electricity', amount: 20000, costType: 'fixed', appliesTo: ['all'], date: admin.firestore.FieldValue.serverTimestamp(), createdAt: admin.firestore.FieldValue.serverTimestamp() })

  // expense categories (seeded codes EXP001..EXP007)
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
  for(const c of categories){
    await db.collection('expenseCategories').add({ ...c, createdAt: admin.firestore.FieldValue.serverTimestamp(), createdBy: 'seed' })
  }

  console.log('Seed complete')
}

seed().catch(err=>{ console.error(err); process.exit(1) })
