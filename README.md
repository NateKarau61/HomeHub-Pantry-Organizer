# Pantry Organizer

A free pantry tracker and meal planner — inspired by [PantryTrack](https://pantrytrack.app/)'s "track your pantry, plan meals, cut food waste" idea, built as a simple static site like your [Budget Planner](https://natekarau61.github.io/Budget-Planner/). Everyone in your household logs in with their own email/password account, and everyone sees and edits the same shared pantry, recipes, meal plan, and shopping list — synced instantly across every device via Firebase.

**Live demo:** enable GitHub Pages on this repo (see below) and it'll be at `https://<your-username>.github.io/Pantry-Organizer/`

## Features

- **Individual logins, one shared pantry** — everyone in the household creates their own account (email + password), and all accounts read/write the same shared data. Changes made on one phone show up on everyone else's device within a second or two.
- **Inventory tracking** — log items by aisle/category, quantity, unit, a low-stock number, and an optional expiration date, across one or more storage locations (pantry, freezer, garage shelf, etc.). Items running low or expiring within 7 days are flagged automatically.
- **Quick count mode** — a fast tap-to-adjust grid for walking the shelves and updating counts without the full form.
- **Recipes** — save recipes with their ingredients (quantity, unit, aisle) so they can be planned and shopped for. Ingredient names autocomplete from what's already in your pantry, filling in the unit and aisle for you.
- **Weekly meal plan** — a Breakfast/Lunch/Dinner grid for each day of the week. Assign any saved recipe to any slot, and step through past/future weeks.
- **Smart shopping list** — one click generates a shopping list for the week: it totals what your planned meals need, subtracts what you already have on hand, and adds only the shortfall — grouped by aisle, alongside your low-stock items and anything you add by hand.
- **Printable shopping list** — click "Print list" for a clean, checkbox-style, aisle-grouped page you can print or save as a PDF to take to the store.
- **Automatic cloud sync** — everything saves to your household's shared account via Firebase, with no manual save button. Export a backup `.json` file any time as an extra safety net, or import one to restore.
- **Barcode scanning** — tap "Scan barcode" on the Inventory tab to use your camera (phone or laptop) to scan a product. If it's already in your pantry, scanning it just adds one to the count. If it's new, the app looks it up via the free [Open Food Facts](https://world.openfoodfacts.org/) database and pre-fills the name and aisle for you. Works great on a phone — no app to install, just open the site in your browser.

## Running it locally

Open `index.html` in any browser — there's no build step and no dependencies. `styles.css`, `app.js`, and `firebase-config.js` sit alongside it. You'll need a real Firebase project connected (see below) for login/sync to work; without one, the app shows a message on the login screen instead of loading.

## Publishing with GitHub Pages

1. Create a new repository on GitHub (e.g. `Pantry-Organizer`) and upload `index.html`, `styles.css`, `app.js`, `firebase-config.js`, and this `README.md`.
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Pick the `main` branch and the `/ (root)` folder, then click **Save**.
5. GitHub will give you a live URL (usually `https://<your-username>.github.io/Pantry-Organizer/`) within a minute or two.

## Setting up Firebase (required for login/sync)

The app needs a free Firebase project to handle logins and store the shared pantry data. This takes about 10 minutes, one time:

1. Go to [console.firebase.google.com](https://console.firebase.google.com/) and sign in with a Google account. Click **Add project**, give it any name (e.g. "Pantry Organizer"), and finish the setup wizard (you can decline Google Analytics).
2. In your new project, go to **Build → Authentication**, click **Get started**, and enable the **Email/Password** sign-in provider.
3. Go to **Build → Firestore Database**, click **Create database**, choose a location close to you, and start in **production mode**.
4. Still in Firestore, click the **Rules** tab and replace the contents with:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /households/{docId} {
         allow read, write: if request.auth != null;
       }
     }
   }
   ```
   This means: anyone who's logged in can read/write the shared household document, and nobody logged out can touch it. Click **Publish**.
5. Go to **Project settings** (gear icon, top left) → scroll to **Your apps** → click the **`</>`** (web) icon to register a new web app. Give it any nickname and click **Register app**. Firebase will show you a `firebaseConfig` object — copy it.
6. Open `firebase-config.js` in this repo and paste your copied values in, replacing the `PASTE_YOUR_..._HERE` placeholders. Commit the change.
7. Back in **Authentication → Settings → Authorized domains**, click **Add domain** and add your GitHub Pages domain, e.g. `<your-username>.github.io`.
8. Visit your live site, click "Create account," and you're in. Share that same login (or have each household member create their own account) — everyone will see the same pantry.

`firebase-config.js` is safe to commit to a public repo — the values in it aren't secret; the Firestore rules above are what actually control access.

## Notes on barcode scanning

Camera access only works over a secure connection — that means your GitHub Pages link (`https://...github.io/...`) or `localhost`, but not opening `index.html` directly from a file on disk. On your phone, just open the Pages link in Safari or Chrome and allow camera access when prompted; there's nothing to install. If the scanner can't load (no internet, or the barcode database is unreachable), you can always fall back to typing the item in by hand.

## Notes on the shopping-list math

Ingredient matching between recipes and your inventory is done by name (case-insensitive), not a barcode or database — so "Ground beef" in a recipe will match "Ground beef" in your pantry, but won't automatically match "80/20 ground beef" unless you name them the same way. Quantities are summed across all your storage locations regardless of unit, so keep units consistent for an item (e.g. always track ground beef in lb) for the numbers to mean much.
