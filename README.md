# CA Firm Secure QR Attendance & Variable Payroll System

## Quick Start
1. Extract this ZIP folder and open it in VS Code / Terminal.
2. Run `npm install` to install all dependencies.
3. Duplicate `.env.example` as `.env` and paste your Firebase Web App credentials.
4. In Firebase Console:
   - Enable **Authentication -> Email/Password**.
   - Create **Firestore Database** and paste the rules from `firestore.rules`.
   - Create your Admin user in Authentication, copy their UID, and add a document in `users/{ADMIN_UID}` with:
     - `name`: `"CA Partner"`
     - `role`: `"ADMIN"`
   - Create a document in `office_settings/main_branch` with:
     - `lat`: (number) Your office latitude
     - `lng`: (number) Your office longitude
     - `allowedRadiusMeters`: `50`
     - `qrSecretKey`: `"CA_FIRM_SECURE_KEY_2026"`
5. Run `npm run dev` locally, or push to GitHub and deploy on Vercel (remember to add your Vercel domain to Firebase Authentication -> Settings -> Authorized Domains).
