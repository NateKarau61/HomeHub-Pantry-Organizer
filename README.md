# Pantry Organizer

A free pantry tracker and meal planner — inspired by [PantryTrack](https://pantrytrack.app/)'s "track your pantry, plan meals, cut food waste" idea, built as a simple static site like your [Budget Planner](https://natekarau61.github.io/Budget-Planner/). Everyone in your household logs in with their own email/password account, and everyone sees and edits the same shared pantry, recipes, meal plan, and shopping list — synced instantly across every device via Firebase.

**Live demo:** enable GitHub Pages on this repo (see below) and it'll be at `https://<your-username>.github.io/Pantry-Organizer/`

## Features

- **Individual logins, one shared pantry** — everyone in the household creates their own account (email + password), and all accounts read/write the same shared data. Changes made on one phone show up on everyone else's device within a second or two.
- **Dashboard** — the first thing you see after logging in: a one-glance summary (items in stock, low-stock count, expiring-soon count, and an estimated pantry value if you've logged any prices), a Pantry Health Score, a "Needs attention" list of what's running low or expiring across every location — leftovers about to go bad show up here too — (with any recipes that use those items called out), your top-ready recipes, this week's meal plan, how many items are on your shopping list, what's in your leftovers, and what's been used lately — plus quick-action buttons to add an item, scan a barcode, or jump to recipes.
- **Pantry Health Score** — a 0–100 score on the Dashboard summarizing how things are going overall, with its breakdown always shown alongside it rather than as an unexplained number: stock levels, freshness (how much is expired), whether staples are on schedule, and how much has gone to waste lately versus how much got used.
- **In-app notifications** — a 🔔 bell in the header (visible from any tab) with a badge count for anything that needs a look: low stock, staple restock reminders, items expiring within 2 days, and leftovers about to go bad. Click it to see the list and dismiss individual alerts or all of them at once — a dismissed alert stays hidden only while its underlying cause is still true, so it resurfaces on its own if the same thing happens again later (e.g. it goes low again after being restocked).
- **Inventory tracking** — log items by aisle/category, quantity, unit, a low-stock number, and an optional expiration date, across one or more storage locations (pantry, freezer, garage shelf, etc.). Pick (or add) the destination location right in the "Add an item" form — storage location, item name, category, quantity, unit, and low-stock number all have to be filled in (they're outlined in red until you do) before "Add item" will work, and nothing is pre-filled for you. Current inventory shows as cards (not a table) with a status pill (Good/Low/Expiring) and the same tap +/- as Quick count, and always includes every storage location — use the filter chips (All / Low Stock / Expiring / a chip per location) to narrow it down. Click "Print inventory" any time for a clean, category-grouped printout — pick "All locations" or a single one from the dropdown next to the button first.
- **Quick count mode** — a fast tap-to-adjust grid for walking the shelves and updating counts without the full form. Every storage location shows here at once, stacked one after another, so there's no need to switch locations mid-walk.
- **Recipes** — save recipes with their ingredients (quantity, unit, aisle) so they can be planned and shopped for. Ingredient names autocomplete from what's already in your pantry, filling in the unit and aisle for you.
- **Recipe upload** — click "Upload recipe" on the Add a recipe card and choose a photo of a recipe (a card, a cookbook page, a printout). The app reads it with the same on-device OCR used for receipt scanning and fills in the name, servings, ingredients, and notes for you — review and fix anything before clicking "Save recipe."
- **Weekly meal plan** — a Breakfast/Lunch/Dinner grid for each day of the week. Assign any saved recipe (or a saved batch of leftovers) to any slot, and step through past/future weeks. Click "🎲 Auto-fill this week" to fill in whatever's still empty using your most-ready-to-cook recipes, without touching anything you've already planned.
- **Leftover tracking** — after marking a recipe cooked (from "Make it" or the meal plan's "✓ Cooked"), you're asked how many portions you have left over. Say more than zero and it's tracked separately from your pantry inventory, shows up on the Dashboard with a countdown to its shelf-life date (set in Settings, 4 days by default), and can be assigned to a meal-plan slot just like a recipe. Resolve it any time with "✅ Ate it" (no waste logged) or "🗑️ Tossed" (logs it as food waste) — from the Dashboard, or "🍽️ Ate it" on its meal-plan slot.
- **Food waste tracking** — separate from leftovers on purpose: this tracks food confirmed gone to waste, not just food that's sitting around. Tossing a leftover, or clicking "🗑️ Toss" on an expired/spoiled Inventory item (only offered once it's flagged expiring), logs it with an estimated cost if you'd priced it. See the running total and log on the Spending tab.
- **Consumption tracking** — every time a recipe's ingredients get subtracted (cooking) or you tap "−" on an item (by hand), it's logged. The Dashboard's "Recently used" card shows the last few, and the shopping list uses the last 4 weeks of this history to suggest how much to buy of each low item instead of just flagging that it's low.
- **Smarter shopping list** — sorted by priority instead of just aisle: "Must buy" (completely out), "Running low," "Staple reminders," then anything you've added by hand. Each tracked item shows a suggested buy quantity based on your actual usage pace, and an estimated cost next to it if you've logged a price — with a running estimated total at the top. One click still generates a shopping list for the week from your planned meals: it totals what they need, subtracts what you already have on hand, and adds only the shortfall.
- **Printable shopping list** — click "Print list" for a clean, checkbox-style, aisle-grouped page you can print or save as a PDF to take to the store.
- **Automatic cloud sync** — everything saves to your household's shared account via Firebase, with no manual save button. Export a backup `.json` file any time as an extra safety net, or import one to restore.
- **Barcode scanning** — tap "Scan barcode" on the Inventory tab to use your camera (phone or laptop) to scan a product. Scanning always shows a confirm step before anything changes: if it's already in your pantry, you'll see its current quantity with a "+1" button to confirm; if it's new, the app looks it up via the free [Open Food Facts](https://world.openfoodfacts.org/) database and shows what it found before handing off to the Add Item form for you to review. Works great on a phone — no app to install, just open the site in your browser.
- **Mark a meal cooked** — once a recipe is assigned to a meal-plan slot, a "✓ Cooked" button appears. Clicking it subtracts that recipe's ingredients from your pantry automatically, so your counts stay accurate without manually adjusting each item after you cook.
- **"What can I make?"** — the Recipes tab ranks every saved recipe by how ready you are to cook it, with a per-ingredient have/need breakdown (and how much more you'd need of anything missing), plus a "Make it" button that subtracts the ingredients you do have — even for a recipe that's not 100% ready, since you can still make a partial batch or a substitution on your end.
- **Recurring staples** — flag any item as a staple with a restock reminder interval (e.g. every 14 days). It'll show up on your shopping list as a "restock reminder" on that schedule even if it's not technically low — good for things like paper towels or coffee that you buy on a rhythm rather than by count.
- **Grocery spending tracker** — log what you spend on grocery trips (amount, date, optional note) on the Spending tab, and see your last-30-days total and monthly average. Logging a price when you add an inventory item (or checking off a scanned receipt line) creates an entry automatically too, tagged with that item's aisle.
- **Monthly budget + spending trends** — optionally set a monthly grocery budget on the Spending tab and see a progress bar for what you've spent so far this month, plus a 6-month trend and a by-category breakdown for the current month (built from priced items and receipt scans, since those carry a category — a hand-logged trip total doesn't).
- **Household members & roles** — everyone who logs in is added to a member list automatically (the first person becomes "Owner"); assign a "Kid" role on the Settings tab to hide the Spending and Settings tabs for that person. This is for your own organization, not real access control — see the caveat on the Settings tab.
- **Household activity log** — the Settings tab includes a running feed of who added, removed, or changed what and when, so everyone sharing the pantry can stay in sync.
- **Settings tab** — preferences (the expiring-soon window, default low-stock number, default staple restock interval, and how many days leftovers stay good for — each actually drives the app's behavior, not just cosmetic), a dark theme toggle, household members & roles, the household activity log, and your backup/export/import/reset tools all live here now, tucked out of the way instead of always on-screen.
- **Undo on delete** — removing a pantry item or deleting a recipe shows a brief "Undo" toast, so an accidental delete isn't permanent.
- **Installable, works offline** — the site can be added to your phone's home screen like an app (look for "Add to Home Screen" in your browser's share/menu options), and a service worker caches the app so it still opens without a signal.
- **Receipt scanning** — click "Scan receipt" on the Spending tab, take a photo of a grocery receipt (or upload one), and the app reads it with on-device OCR — no server, no upload. It picks out item/price lines and a total, then shows you an editable checklist so you can add the items you want to your inventory and/or log the total to your spending, all after you've reviewed and corrected anything it got wrong.

## Running it locally

Open `index.html` in any browser — there's no build step and no dependencies. `styles.css`, `app.js`, and `firebase-config.js` sit alongside it. You'll need a real Firebase project connected (see below) for login/sync to work; without one, the app shows a message on the login screen instead of loading.

## Publishing with GitHub Pages

1. Create a new repository on GitHub (e.g. `Pantry-Organizer`) and upload `index.html`, `styles.css`, `app.js`, `firebase-config.js`, `manifest.json`, `service-worker.js`, `icon-192.png`, `icon-512.png`, `favicon-16.png`, `favicon-32.png`, and this `README.md`.
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

Ingredient matching between recipes and your inventory is done by name (case-insensitive), not a barcode or database — so "Ground beef" in a recipe will match "Ground beef" in your pantry, but won't automatically match "80/20 ground beef" unless you name them the same way. Quantities are summed across all your storage locations regardless of unit, so keep units consistent for an item (e.g. always track ground beef in lb) for the numbers to mean much. "Mark cooked" uses the same name-matching logic to subtract ingredients from whichever storage location(s) have them.

## Notes on recurring staples

A staple's restock reminder is based on the date it was last restocked, not a fixed calendar date. Adding a new item as a staple, using the +/− buttons to increase its count, scanning a barcode match, or clicking "Mark restocked" on the shopping list all reset that date. If you toggle the ★ on an item that's never been restocked, it's treated as due right away — restock it once and the schedule takes over from there.

## Notes on offline / installable support

The service worker only caches this site's own files (HTML, CSS, JS, icons) — it never caches Firebase, the barcode lookup, or the scanner library, so login, sync, and barcode lookups always need a live connection. Offline mode just means the app itself still opens and shows whatever was last loaded. If you update these files later, close and reopen the site (or wait a moment) for the new version to take over — the service worker checks for updates in the background.

## Notes on receipt scanning

Receipts vary a lot store to store, so the reader is deliberately assisted rather than fully automatic: it always shows you an editable checklist of what it found before anything is added, so you can fix a misread name or price, uncheck a line, or skip it entirely if it's not usable. Items you add this way land in your current storage location with quantity 1 and aisle "Other" — recategorize or merge duplicates afterward in the Inventory tab if needed. The OCR engine ([Tesseract.js](https://tesseract.projectnaptha.com/)) downloads a language file the first time you use it (a few megabytes), so that first scan needs a decent connection and can take up to 30 seconds; it's faster after that. Like barcode scanning, using your camera directly requires a secure connection (your GitHub Pages link or `localhost`), though choosing an existing photo from your library works either way.

## Notes on recipe upload

Like receipt scanning, this reads entirely in your browser with the same on-device OCR — nothing is uploaded anywhere — and is deliberately assisted rather than fully automatic, since recipe layouts vary a lot from card to card and site to site. It fills in the same "Add a recipe" form you'd use by hand, so it's a first draft to check over rather than a final answer: double-check ingredient quantities and units especially, since those are the easiest for the reader to misjudge, and fix or delete any ingredient row it got wrong before clicking "Save recipe" — nothing saves until you do. It works best on a photo with a clearly labeled "Ingredients" section and one ingredient per line. This only reads photos (JPG/PNG, etc.) — there's no support for uploading a PDF or a webpage link.

## Notes on the Dashboard and "What can I make?"

The Dashboard's estimated pantry value only counts items where you've entered a "Price paid" — it's a rough estimate (price × current quantity for whatever you've priced), not a real-time market value. "What can I make?" and the Dashboard's preview of it use the same ingredient name-matching as the shopping list (see below), so a recipe ingredient named "Ground beef" only counts against pantry items also named "Ground beef." "Make it" is available at any readiness percentage — it subtracts whatever you have of each ingredient (never going below zero), so cooking a recipe you're only partially stocked for just uses what's on hand rather than blocking you.

## Notes on leftovers and consumption-based suggestions

The "how many portions leftover?" prompt appears every time a recipe gets marked cooked, whether from "Make it" or the meal plan's "✓ Cooked" — enter 0 (or cancel) if there aren't any, and nothing gets tracked. A leftover's countdown is based on the shelf-life setting at the moment you save it, so changing that setting in Settings later only affects new leftovers, not ones already saved. The shopping list's suggested buy quantities come from your last 4 weeks of usage (both cooking and manual "−" taps) — with no history yet for an item, it just suggests 1, and it never suggests less than 1. This consumption history isn't shown as its own report; it's used behind the scenes for suggestions and shows up as a short "Recently used" list on the Dashboard.

## Notes on food waste vs. leftovers

These are two different logs on purpose. Leftovers are food that still exists and might get eaten — the Dashboard tracks a countdown so you don't forget about it. Food waste is a confirmed outcome: a leftover you tossed instead of ate, or a pantry item pulled because it went bad. Only "🗑️ Tossed" / "🗑️ Toss" logs waste — "✅ Ate it" and the regular "Remove" button on an Inventory card don't, since removing something you used up isn't waste. The "Toss" button on an Inventory card only appears once an item is flagged expiring or expired (based on the "Flag items expiring within" setting) — for anything else, use "Remove."

## Notes on the Pantry Health Score

The score is a heuristic, not a precise measurement, and it's most meaningful once you've got some real usage history — with very little data (say, one wasted item and nothing else logged yet), a single event can swing the "Low waste" part of the score more than it would once there's a real pattern to compare against. That's also why the full breakdown is always shown right below the number: if something looks off, the four line items underneath explain exactly why, the same way "What can I make?" shows its per-ingredient reasoning instead of just a percentage.

## Notes on household roles

Anyone can sign up for their own account and start using the shared pantry — the roles here (Owner/Member/Kid) are just a label for who's who, editable by anyone in Settings. The only thing a role actually changes is that "Kid" hides the Spending and Settings tabs for that person's own login. It is not a security feature: the underlying Firestore rule (see the setup section above) only checks that someone is logged in, not who — so a household member could still see or change anything by hand if they wanted to, regardless of their assigned role. If you want real access control, that would need a different Firestore rules setup keyed off each person's role, which isn't what's implemented here.

## What's next

This has come together in a few planned rounds of improvements.

**Round 1** built: the Dashboard, "Needs attention"/expiring-items view, the readiness-based "What can I make?", card-based filterable inventory, a confirm step for barcode scans, and a dark theme toggle.

**Round 2** built: consumption tracking tied to cooking and manual use, a smarter shopping list (must-buy/running-low/staple-reminder priority grouping, usage-based suggested quantities, and cost estimates), leftover tracking (with a shelf-life countdown and its own meal-plan slot type), a meal-plan auto-fill button, and an in-app notification bell.

**Round 3** (this one) built the rest of the original wish list: a dedicated food-waste tracker (separate from leftovers), a monthly grocery budget with a progress bar, spending trends (6-month history + this-month-by-category), household members with an organizational Owner/Member/Kid role (Kid hides Spending/Settings), and the Pantry Health Score.

That's everything from the original wish list except two items that were intentionally not planned as-is, for reasons flagged at the very start of this project: an AI chat assistant (it would need an API key with a per-request cost, and that key would be visible to anyone sharing the household login) and true push notifications (this is a static site with no backend to send them from) — the in-app notification bell covers the same need without either of those tradeoffs. Everything else is now built; further rounds would mean refining what's here rather than adding net-new sections.
