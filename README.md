# EH Cost Center

## Vercel + HuggingFace Embedding Proxy Setup

This project supports client-side RAG (Retrieval Augmented Generation) using HuggingFace embeddings, with a Vercel serverless function as a proxy to avoid CORS issues.

### Deployment Steps

1. **Push your latest code to your Vercel-connected Git repository** (or use `vercel deploy` from the CLI).
2. **Set the HuggingFace API token in Vercel dashboard:**
   - Go to your Vercel project settings → Environment Variables.
   - Add:
     - `HUGGINGFACE_API_TOKEN=<your-huggingface-token>`
3. **Deploy your project to Vercel.**
   - Vercel will build the frontend and deploy the `/api/embed` serverless function.
4. **Test the app at your Vercel URL:**
   - Open the chat modal.
   - Switch to "Client RAG" mode.
   - Enter a query. Embedding requests will go through `/api/embed` (no CORS issues).

### Local Development
- In local/dev, the frontend will call HuggingFace directly (using the token from `.env.local`).
- In production (Vercel or `web.app`), the frontend will POST to `/api/embed`.

### Troubleshooting
- If you get CORS errors in production, make sure you are using the Vercel `/api/embed` endpoint and that your token is set in the Vercel dashboard.
- If you get 401/403 errors, check that your HuggingFace token is valid and not rate-limited.

---

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

3. (OPTIONAL) If you want to use Cloud Functions for auth/payments you'll need a Blaze plan.
	This repo includes a no-functions alternative below so you can run on the Firebase free tier.

No-Blaze (free tier) setup — use Email/Password admin + security rules

- Create an admin user in the Firebase Console → Authentication → Add user (pick an email, e.g. `admin@example.com` and a password).
- Update `firestore.rules` and replace the placeholder admin email `ADMIN_EMAIL@example.com` with the admin email you created.
- The app now uses Email/Password sign-in (see `src/pages/Login.tsx`).

After that you can `npm run build` and `firebase deploy --only hosting` to publish the frontend and use Firestore from the client.

Create admin users via script (optional)

1. Create a service account key in the Firebase Console → Project Settings → Service accounts → Generate new private key.
2. Save the JSON file and set `GOOGLE_APPLICATION_CREDENTIALS` to its path.
3. Run:

```bash
node scripts/create_admins.js
```

The script will create the two admin users and set a custom claim `admin: true` on each. The default password is `1234` as requested. You can change the password in the script before running if desired.

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
