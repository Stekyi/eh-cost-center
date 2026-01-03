# EH Cost Center

Minimal scaffold for EH Cost Center app (React + Firebase). This project is a starting point. Follow the steps below to finish setup and deploy.

Quick start

1. Install dependencies:

```bash
cd eh-cost-center
npm install
```

2. Initialize Firebase (run and choose/create a new Firebase project):

```bash
firebase init hosting functions firestore
```

3. Generate bcrypt hash for password `1234` and set functions config (example):

```bash
node -e "console.log(require('bcryptjs').hashSync('1234',10))"
firebase functions:config:set auth.username="Angela" auth.password_hash="<PASTE_HASH>"
```

4. Run dev server:

```bash
npm run dev
```

Next steps: implement Firestore rules, Cloud Functions logic, and wire frontend to Firestore and functions.

Emulator (recommended for testing locally)

1. Install Firebase CLI and start emulators:

```bash
npm install -g firebase-tools
firebase login
firebase emulators:start --only firestore,functions --project YOUR_PROJECT_ID
```

2. Seed data: open the app pages `Products` and click `Seed default products`.

Files of interest:
- `src/pages/*` — UI pages (Customers, Products, Orders, Staff, Expense Items, Assets, Cost-Plus, Production)
- `functions/src/index.ts` — Cloud Functions endpoints (`/auth/login`, `/orders/:orderId/markPaid`)
- `firestore.rules` — sample security rules

Next actions performed by the developer agent:
- Added Assets page, CostName autocomplete, improved Orders list with customer names and subtotals, Production CSV export, audit `createdBy` fields on create flows.

Run the app and test flows: create customers, seed products, book orders, open order detail, mark paid, add expense items, and run Cost-Plus pages.
