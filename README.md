# Pantry Organizer

https://natekarau61.github.io/HomeHub-Pantry-Organizer/

**Live demo:** enable GitHub Pages on this repo (see below) and it'll be at `https://<your-username>.github.io/Pantry-Organizer/`

## Features

- **Inventory tracking** — log items by aisle/category, quantity, unit, a low-stock number, and an optional expiration date, across one or more storage locations (pantry, freezer, garage shelf, etc.). Items running low or expiring within 7 days are flagged automatically.
- **Quick count mode** — a fast tap-to-adjust grid for walking the shelves and updating counts without the full form.
- **Recipes** — save recipes with their ingredients (quantity, unit, aisle) so they can be planned and shopped for.
- **Weekly meal plan** — a Breakfast/Lunch/Dinner grid for each day of the week. Assign any saved recipe to any slot, and step through past/future weeks.
- **Smart shopping list** — one click generates a shopping list for the week: it totals what your planned meals need, subtracts what you already have on hand, and adds only the shortfall — grouped by aisle, alongside your low-stock items and anything you add by hand.
- **Automatic local save** — everything persists in this browser via `localStorage`. Export a backup `.json` file any time, or import one to restore/move devices.

## Running it locally

Open `index.html` in any browser — there's no build step and no dependencies. `styles.css` and `app.js` sit alongside it.

## Publishing with GitHub Pages

1. Create a new repository on GitHub (e.g. `Pantry-Organizer`) and upload `index.html`, `styles.css`, `app.js`, and this `README.md`.
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Pick the `main` branch and the `/ (root)` folder, then click **Save**.
5. GitHub will give you a live URL (usually `https://<your-username>.github.io/Pantry-Organizer/`) within a minute or two.

## Notes on the shopping-list math

Ingredient matching between recipes and your inventory is done by name (case-insensitive), not a barcode or database — so "Ground beef" in a recipe will match "Ground beef" in your pantry, but won't automatically match "80/20 ground beef" unless you name them the same way. Quantities are summed across all your storage locations regardless of unit, so keep units consistent for an item (e.g. always track ground beef in lb) for the numbers to mean much.
