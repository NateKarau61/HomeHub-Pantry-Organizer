(function () {
  "use strict";

  const STORAGE_KEY = "pantryOrganizerData";
  const CATEGORIES_ORDER = ["Produce","Grains & Pasta","Canned & Jarred","Baking","Spices & Condiments","Snacks","Frozen","Dairy & Eggs","Meat & Seafood","Beverages","Cleaning & Household","Other"];
  const EXPIRING_SOON_DAYS = 7;
  const MEAL_SLOTS = ["breakfast", "lunch", "dinner"];
  const MEAL_SLOT_LABELS = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };

  let uidCounter = 1;
  function uid() {
    return "id_" + Date.now().toString(36) + "_" + (uidCounter++) + "_" + Math.random().toString(36).slice(2, 7);
  }

  function defaultState() {
    return {
      version: 2,
      pantries: { "Main Pantry": { items: [] } },
      currentPantry: "Main Pantry",
      recipes: [],
      mealPlan: {},
      shoppingExtras: [],
      shoppingAutoChecked: {}
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const base = defaultState();
      return Object.assign(base, parsed, {
        pantries: parsed.pantries || base.pantries,
        recipes: parsed.recipes || [],
        mealPlan: parsed.mealPlan || {},
        shoppingExtras: parsed.shoppingExtras || [],
        shoppingAutoChecked: parsed.shoppingAutoChecked || {}
      });
    } catch (e) {
      console.warn("Could not read saved data, starting fresh.", e);
      return defaultState();
    }
  }

  let state = loadState();
  let saveTimer = null;

  function saveState() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        flashSaveStatus("Saved automatically in this browser");
      } catch (e) {
        flashSaveStatus("Couldn't save — storage may be full");
      }
    }, 150);
  }

  function flashSaveStatus(msg) {
    const el = document.getElementById("saveStatus");
    if (el) el.textContent = msg;
  }

  function currentPantryData() {
    if (!state.pantries[state.currentPantry]) {
      const first = Object.keys(state.pantries)[0];
      state.currentPantry = first;
    }
    return state.pantries[state.currentPantry];
  }

  function allItemsAcrossLocations() {
    const out = [];
    Object.keys(state.pantries).forEach(loc => {
      state.pantries[loc].items.forEach(item => out.push(Object.assign({ __location: loc }, item)));
    });
    return out;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function normName(s) {
    return (s || "").trim().toLowerCase();
  }

  // ---------------- Pantry location selector ----------------
  function renderPantrySelect() {
    const sel = document.getElementById("pantrySelect");
    sel.innerHTML = "";
    Object.keys(state.pantries).forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      if (name === state.currentPantry) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  document.getElementById("pantrySelect").addEventListener("change", e => {
    state.currentPantry = e.target.value;
    saveState();
    renderAll();
  });

  document.getElementById("addPantryBtn").addEventListener("click", () => {
    const name = prompt("Name this storage location (e.g. 'Garage Freezer', 'Basement Shelf'):");
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    if (state.pantries[trimmed]) { alert("That location already exists."); return; }
    state.pantries[trimmed] = { items: [] };
    state.currentPantry = trimmed;
    saveState();
    renderAll();
  });

  document.getElementById("removePantryBtn").addEventListener("click", () => {
    const names = Object.keys(state.pantries);
    if (names.length <= 1) { alert("You need at least one storage location."); return; }
    if (!confirm(`Remove "${state.currentPantry}" and everything in it?`)) return;
    delete state.pantries[state.currentPantry];
    state.currentPantry = Object.keys(state.pantries)[0];
    saveState();
    renderAll();
  });

  // ---------------- Tabs ----------------
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      ["inventory", "quick", "recipes", "mealplan", "shopping"].forEach(t => {
        document.getElementById("tab-" + t).style.display = t === tab ? "" : "none";
      });
      if (tab === "quick") renderQuickCount();
      if (tab === "recipes") renderRecipeList();
      if (tab === "mealplan") renderMealPlan();
      if (tab === "shopping") renderShoppingList();
    });
  });

  // ---------------- Inventory ----------------
  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(dateStr + "T00:00:00");
    return Math.round((d - today) / 86400000);
  }

  function addItem() {
    const name = document.getElementById("itemName").value.trim();
    if (!name) { alert("Enter an item name."); return; }
    const category = document.getElementById("itemCategory").value;
    const qty = parseFloat(document.getElementById("itemQty").value) || 0;
    const unit = document.getElementById("itemUnit").value.trim();
    const threshold = parseFloat(document.getElementById("itemThreshold").value) || 0;
    const expiry = document.getElementById("itemExpiry").value;

    currentPantryData().items.push({ id: uid(), name, category, qty, unit, threshold, expiry });

    document.getElementById("itemName").value = "";
    document.getElementById("itemQty").value = "1";
    document.getElementById("itemUnit").value = "";
    document.getElementById("itemThreshold").value = "1";
    document.getElementById("itemExpiry").value = "";

    saveState();
    renderAll();
  }
  document.getElementById("addItemBtn").addEventListener("click", addItem);

  function removeItem(id) {
    const data = currentPantryData();
    data.items = data.items.filter(i => i.id !== id);
    saveState();
    renderAll();
  }

  function adjustQty(id, delta) {
    const data = currentPantryData();
    const item = data.items.find(i => i.id === id);
    if (!item) return;
    item.qty = Math.max(0, (parseFloat(item.qty) || 0) + delta);
    saveState();
    renderAll();
  }

  function renderInventory() {
    const data = currentPantryData();
    const search = (document.getElementById("searchInput").value || "").toLowerCase();
    const wrap = document.getElementById("inventoryTableWrap");
    const filtered = data.items.filter(i => i.name.toLowerCase().includes(search));

    if (filtered.length === 0) {
      wrap.innerHTML = '<p class="empty-note">No items yet. Add your first one above.</p>';
      return;
    }

    const byCategory = {};
    filtered.forEach(item => {
      if (!byCategory[item.category]) byCategory[item.category] = [];
      byCategory[item.category].push(item);
    });

    let html = "<table><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Expires</th><th></th></tr></thead><tbody>";

    const cats = CATEGORIES_ORDER.filter(c => byCategory[c]).concat(Object.keys(byCategory).filter(c => !CATEGORIES_ORDER.includes(c)));

    cats.forEach(cat => {
      html += `<tr><td colspan="5" class="category-heading">${escapeHtml(cat)}</td></tr>`;
      byCategory[cat].forEach(item => {
        const dLeft = daysUntil(item.expiry);
        const isExpiring = dLeft !== null && dLeft <= EXPIRING_SOON_DAYS;
        const isLow = item.qty <= item.threshold;
        const rowClasses = [];
        if (isLow) rowClasses.push("low-stock");
        if (isExpiring) rowClasses.push("expiring");

        let expText = item.expiry ? item.expiry : "—";
        if (isExpiring) {
          expText += dLeft < 0 ? ' <span class="pill warn">expired</span>' : ` <span class="pill warn">${dLeft}d left</span>`;
        }

        html += `<tr class="${rowClasses.join(" ")}">
          <td data-label="Item">${escapeHtml(item.name)}</td>
          <td data-label="Qty" class="qty-cell">${item.qty}${isLow ? ' <span class="pill warn">low</span>' : ""}</td>
          <td data-label="Unit">${escapeHtml(item.unit || "—")}</td>
          <td data-label="Expires" class="exp-cell">${expText}</td>
          <td data-label="">
            <button class="btn-icon" onclick="pantryApp.adjustQty('${item.id}', -1)">−</button>
            <button class="btn-icon" onclick="pantryApp.adjustQty('${item.id}', 1)">+</button>
            <button class="btn-danger" onclick="pantryApp.removeItem('${item.id}')">Remove</button>
          </td>
        </tr>`;
      });
    });

    html += "</tbody></table>";
    wrap.innerHTML = html;
  }

  document.getElementById("searchInput").addEventListener("input", renderInventory);

  // ---------------- Quick count ----------------
  function renderQuickCount() {
    const data = currentPantryData();
    const grid = document.getElementById("quickGrid");
    const emptyNote = document.getElementById("quickEmptyNote");

    if (data.items.length === 0) {
      grid.innerHTML = "";
      emptyNote.style.display = "";
      return;
    }
    emptyNote.style.display = "none";

    grid.innerHTML = data.items.map(item => `
      <div class="quick-item">
        <div class="name">${escapeHtml(item.name)}</div>
        <div class="cat">${escapeHtml(item.category)}${item.unit ? " · " + escapeHtml(item.unit) : ""}</div>
        <div class="quick-controls">
          <button class="btn-icon" onclick="pantryApp.adjustQty('${item.id}', -1)">−</button>
          <span class="count">${item.qty}</span>
          <button class="btn-icon" onclick="pantryApp.adjustQty('${item.id}', 1)">+</button>
        </div>
      </div>
    `).join("");
  }

  // ---------------- Recipes ----------------
  let editingRecipeId = null;

  function ingredientRowTemplate(vals) {
    vals = vals || {};
    const row = document.createElement("div");
    row.className = "ingredient-row";
    row.innerHTML = `
      <input type="text" class="ing-name" placeholder="Ingredient name" value="${escapeHtml(vals.name || "")}">
      <input type="number" class="ing-qty" placeholder="Qty" min="0" step="0.1" value="${vals.qty != null ? vals.qty : ""}">
      <input type="text" class="ing-unit" placeholder="Unit" value="${escapeHtml(vals.unit || "")}">
      <select class="ing-category">
        ${CATEGORIES_ORDER.map(c => `<option ${vals.category === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
      </select>
      <button type="button" class="btn-danger remove-ing">✕</button>
    `;
    row.querySelector(".remove-ing").addEventListener("click", () => row.remove());
    return row;
  }

  document.getElementById("addIngredientRowBtn").addEventListener("click", () => {
    document.getElementById("recipeIngredientRows").appendChild(ingredientRowTemplate());
  });

  // seed with one empty row initially
  document.getElementById("recipeIngredientRows").appendChild(ingredientRowTemplate());

  function resetRecipeForm() {
    editingRecipeId = null;
    document.getElementById("recipeName").value = "";
    document.getElementById("recipeServings").value = "4";
    document.getElementById("recipeNotes").value = "";
    const rows = document.getElementById("recipeIngredientRows");
    rows.innerHTML = "";
    rows.appendChild(ingredientRowTemplate());
    document.getElementById("saveRecipeBtn").textContent = "Save recipe";
  }

  function saveRecipe() {
    const name = document.getElementById("recipeName").value.trim();
    if (!name) { alert("Enter a recipe name."); return; }
    const servings = parseFloat(document.getElementById("recipeServings").value) || 1;
    const notes = document.getElementById("recipeNotes").value.trim();

    const ingredients = [];
    document.querySelectorAll("#recipeIngredientRows .ingredient-row").forEach(row => {
      const iname = row.querySelector(".ing-name").value.trim();
      if (!iname) return;
      const qty = parseFloat(row.querySelector(".ing-qty").value) || 0;
      const unit = row.querySelector(".ing-unit").value.trim();
      const category = row.querySelector(".ing-category").value;
      ingredients.push({ name: iname, qty, unit, category });
    });

    if (ingredients.length === 0) { alert("Add at least one ingredient."); return; }

    if (editingRecipeId) {
      const r = state.recipes.find(r => r.id === editingRecipeId);
      if (r) { r.name = name; r.servings = servings; r.notes = notes; r.ingredients = ingredients; }
    } else {
      state.recipes.push({ id: uid(), name, servings, notes, ingredients });
    }

    saveState();
    resetRecipeForm();
    renderRecipeList();
    renderMealPlan();
  }
  document.getElementById("saveRecipeBtn").addEventListener("click", saveRecipe);

  function editRecipe(id) {
    const r = state.recipes.find(r => r.id === id);
    if (!r) return;
    editingRecipeId = id;
    document.getElementById("recipeName").value = r.name;
    document.getElementById("recipeServings").value = r.servings;
    document.getElementById("recipeNotes").value = r.notes || "";
    const rows = document.getElementById("recipeIngredientRows");
    rows.innerHTML = "";
    r.ingredients.forEach(ing => rows.appendChild(ingredientRowTemplate(ing)));
    document.getElementById("saveRecipeBtn").textContent = "Update recipe";
    window.scrollTo({ top: document.getElementById("tab-recipes").offsetTop - 10, behavior: "smooth" });
  }

  function deleteRecipe(id) {
    if (!confirm("Delete this recipe? It will also be cleared from any meal plan slots using it.")) return;
    state.recipes = state.recipes.filter(r => r.id !== id);
    Object.keys(state.mealPlan).forEach(dateKey => {
      MEAL_SLOTS.forEach(slot => {
        if (state.mealPlan[dateKey][slot] === id) state.mealPlan[dateKey][slot] = null;
      });
    });
    saveState();
    renderRecipeList();
    renderMealPlan();
  }

  function renderRecipeList() {
    const wrap = document.getElementById("recipeListWrap");
    if (state.recipes.length === 0) {
      wrap.innerHTML = '<p class="empty-note">No recipes yet. Add one above to start planning meals.</p>';
      return;
    }
    wrap.innerHTML = state.recipes.map(r => `
      <div class="recipe-card">
        <div class="recipe-head">
          <h3>${escapeHtml(r.name)}</h3>
          <span class="servings">${r.servings} servings</span>
        </div>
        <ul>
          ${r.ingredients.map(i => `<li>${escapeHtml(i.name)}${i.qty ? " — " + i.qty : ""}${i.unit ? " " + escapeHtml(i.unit) : ""} <span class="pill">${escapeHtml(i.category)}</span></li>`).join("")}
        </ul>
        ${r.notes ? `<div class="notes">${escapeHtml(r.notes)}</div>` : ""}
        <div class="row" style="margin-top:10px;">
          <button class="btn-secondary" onclick="pantryApp.editRecipe('${r.id}')">Edit</button>
          <button class="btn-danger" onclick="pantryApp.deleteRecipe('${r.id}')">Delete</button>
        </div>
      </div>
    `).join("");
  }

  // ---------------- Meal plan ----------------
  let weekOffset = 0;

  function getMonday(d) {
    const date = new Date(d);
    const day = date.getDay(); // 0 Sun .. 6 Sat
    const diff = (day === 0 ? -6 : 1) - day;
    date.setDate(date.getDate() + diff);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function formatDateKey(d) {
    return d.toISOString().slice(0, 10);
  }

  function getWeekDates() {
    const monday = getMonday(new Date());
    monday.setDate(monday.getDate() + weekOffset * 7);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  }

  function ensureMealSlot(dateKey) {
    if (!state.mealPlan[dateKey]) state.mealPlan[dateKey] = { breakfast: null, lunch: null, dinner: null };
    return state.mealPlan[dateKey];
  }

  document.getElementById("prevWeekBtn").addEventListener("click", () => { weekOffset--; renderMealPlan(); });
  document.getElementById("nextWeekBtn").addEventListener("click", () => { weekOffset++; renderMealPlan(); });

  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  function renderMealPlan() {
    const days = getWeekDates();
    const label = document.getElementById("weekLabel");
    const first = days[0], last = days[6];
    const rangeText = `${MONTH_NAMES[first.getMonth()]} ${first.getDate()} – ${MONTH_NAMES[last.getMonth()]} ${last.getDate()}${weekOffset === 0 ? " (this week)" : ""}`;
    label.textContent = rangeText;

    const wrap = document.getElementById("mealGridWrap");
    let html = '<table class="meal-grid"><thead><tr><th>Day</th>' + MEAL_SLOTS.map(s => `<th>${MEAL_SLOT_LABELS[s]}</th>`).join("") + "</tr></thead><tbody>";

    days.forEach((d, idx) => {
      const key = formatDateKey(d);
      const slot = ensureMealSlot(key);
      html += `<tr><td class="daycell" data-label="Day">${DAY_NAMES[idx]} ${d.getDate()}</td>`;
      MEAL_SLOTS.forEach(s => {
        html += `<td data-label="${MEAL_SLOT_LABELS[s]}"><select onchange="pantryApp.setMeal('${key}','${s}', this.value)">
          <option value="">—</option>
          ${state.recipes.map(r => `<option value="${r.id}" ${slot[s] === r.id ? "selected" : ""}>${escapeHtml(r.name)}</option>`).join("")}
        </select></td>`;
      });
      html += "</tr>";
    });

    html += "</tbody></table>";
    wrap.innerHTML = html;

    if (state.recipes.length === 0) {
      wrap.innerHTML += '<p class="empty-note">Add a recipe first, then assign it to days here.</p>';
    }
  }

  function setMeal(dateKey, slot, recipeId) {
    const s = ensureMealSlot(dateKey);
    s[slot] = recipeId || null;
    saveState();
  }

  function generateShoppingListForWeek() {
    const days = getWeekDates();
    const needed = {}; // key: name|unit -> {name, unit, category, qty}

    days.forEach(d => {
      const key = formatDateKey(d);
      const slot = state.mealPlan[key];
      if (!slot) return;
      MEAL_SLOTS.forEach(s => {
        const recipeId = slot[s];
        if (!recipeId) return;
        const recipe = state.recipes.find(r => r.id === recipeId);
        if (!recipe) return;
        recipe.ingredients.forEach(ing => {
          const k = normName(ing.name) + "|" + normName(ing.unit);
          if (!needed[k]) needed[k] = { name: ing.name, unit: ing.unit, category: ing.category, qty: 0 };
          needed[k].qty += ing.qty || 0;
        });
      });
    });

    // What's on hand, aggregated by name across all locations (unit-agnostic best-effort match)
    const have = {};
    allItemsAcrossLocations().forEach(item => {
      const k = normName(item.name);
      have[k] = (have[k] || 0) + (parseFloat(item.qty) || 0);
    });

    // Remove previously auto-generated meal-plan shopping items, keep manual ones
    state.shoppingExtras = state.shoppingExtras.filter(i => i.source !== "mealplan");

    let addedCount = 0;
    Object.keys(needed).forEach(k => {
      const n = needed[k];
      const onHand = have[normName(n.name)] || 0;
      const deficit = n.qty - onHand;
      if (deficit > 0.0001) {
        state.shoppingExtras.push({
          id: uid(),
          label: `${n.name}${n.unit ? " (" + n.unit + ")" : ""}`,
          qty: Math.round(deficit * 100) / 100,
          category: n.category || "Other",
          source: "mealplan",
          checked: false
        });
        addedCount++;
      }
    });

    saveState();
    renderShoppingList();

    if (addedCount === 0) {
      alert("Looks like you already have enough on hand for this week's planned meals — nothing added.");
    } else {
      alert(`Added ${addedCount} item${addedCount === 1 ? "" : "s"} to your shopping list based on this week's meals.`);
    }
  }
  document.getElementById("generateShopBtn").addEventListener("click", generateShoppingListForWeek);

  // ---------------- Shopping list ----------------
  function lowStockItems() {
    const out = [];
    Object.keys(state.pantries).forEach(loc => {
      state.pantries[loc].items.forEach(item => {
        if ((parseFloat(item.qty) || 0) <= (parseFloat(item.threshold) || 0)) {
          out.push({ location: loc, item });
        }
      });
    });
    return out;
  }

  function renderShoppingList() {
    const wrap = document.getElementById("shoppingListWrap");
    const low = lowStockItems();
    const extras = state.shoppingExtras || [];

    if (low.length === 0 && extras.length === 0) {
      wrap.innerHTML = '<p class="empty-note">Nothing needed right now. Low-stock pantry items and meal-plan needs will show up here automatically.</p>';
      return;
    }

    const groups = {};
    function pushToGroup(cat, html) {
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(html);
    }

    low.forEach(({ location, item }) => {
      const key = "lowstock:" + location + ":" + item.id;
      const checked = !!state.shoppingAutoChecked[key];
      pushToGroup(item.category || "Other", `
        <div class="shopping-item ${checked ? "checked" : ""}">
          <input type="checkbox" ${checked ? "checked" : ""} onchange="pantryApp.toggleAutoChecked('${key}')">
          <span class="label">${escapeHtml(item.name)}${item.unit ? " (" + escapeHtml(item.unit) + ")" : ""}</span>
          <span class="pill warn">low stock · ${escapeHtml(location)}</span>
        </div>
      `);
    });

    extras.forEach(ex => {
      pushToGroup(ex.category || "Other", `
        <div class="shopping-item ${ex.checked ? "checked" : ""}">
          <input type="checkbox" ${ex.checked ? "checked" : ""} onchange="pantryApp.toggleExtraChecked('${ex.id}')">
          <span class="label">${escapeHtml(ex.label)}${ex.qty ? " — need " + ex.qty : ""}</span>
          ${ex.source === "mealplan" ? '<span class="pill amber">from meal plan</span>' : ""}
          <button class="btn-danger" style="margin-left:auto;" onclick="pantryApp.removeExtra('${ex.id}')">Remove</button>
        </div>
      `);
    });

    const cats = CATEGORIES_ORDER.filter(c => groups[c]).concat(Object.keys(groups).filter(c => !CATEGORIES_ORDER.includes(c)));

    wrap.innerHTML = cats.map(cat => `
      <div class="category-heading">${escapeHtml(cat)}</div>
      ${groups[cat].join("")}
    `).join("");
  }

  function toggleAutoChecked(key) {
    state.shoppingAutoChecked[key] = !state.shoppingAutoChecked[key];
    saveState();
    renderShoppingList();
  }

  function toggleExtraChecked(id) {
    const ex = state.shoppingExtras.find(e => e.id === id);
    if (!ex) return;
    ex.checked = !ex.checked;
    saveState();
    renderShoppingList();
  }

  function removeExtra(id) {
    state.shoppingExtras = state.shoppingExtras.filter(e => e.id !== id);
    saveState();
    renderShoppingList();
  }

  document.getElementById("addExtraShopBtn").addEventListener("click", () => {
    const input = document.getElementById("extraShopItem");
    const label = input.value.trim();
    if (!label) return;
    state.shoppingExtras.push({ id: uid(), label, category: "Other", source: "manual", checked: false });
    input.value = "";
    saveState();
    renderShoppingList();
  });

  document.getElementById("clearCheckedBtn").addEventListener("click", () => {
    state.shoppingExtras = state.shoppingExtras.filter(e => !e.checked);
    Object.keys(state.shoppingAutoChecked).forEach(k => {
      if (state.shoppingAutoChecked[k]) delete state.shoppingAutoChecked[k];
    });
    saveState();
    renderShoppingList();
  });

  document.getElementById("copyListBtn").addEventListener("click", () => {
    const low = lowStockItems().filter(({ location, item }) => !state.shoppingAutoChecked["lowstock:" + location + ":" + item.id]);
    const extras = (state.shoppingExtras || []).filter(e => !e.checked);
    const lines = [
      ...low.map(({ item }) => `- ${item.name}${item.unit ? " (" + item.unit + ")" : ""}`),
      ...extras.map(e => `- ${e.label}${e.qty ? " — need " + e.qty : ""}`)
    ];
    if (lines.length === 0) { alert("Your shopping list is empty."); return; }
    const text = lines.join("\n");
    navigator.clipboard.writeText(text).then(() => {
      alert("Shopping list copied to clipboard.");
    }).catch(() => {
      alert(text);
    });
  });

  // ---------------- Backup / export / import / reset ----------------
  document.getElementById("exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `pantry-organizer-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  document.getElementById("importBtn").addEventListener("click", () => {
    document.getElementById("importFileInput").click();
  });

  document.getElementById("importFileInput").addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const loaded = JSON.parse(evt.target.result);
        if (!loaded.pantries || !loaded.currentPantry) throw new Error("bad format");
        state = Object.assign(defaultState(), loaded);
        saveState();
        renderAll();
        alert("Backup loaded.");
      } catch (err) {
        alert("Could not read that file — is it a Pantry Organizer backup?");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  document.getElementById("resetAllBtn").addEventListener("click", () => {
    if (!confirm("This will erase everything saved in this browser (pantry items, recipes, meal plan, shopping list). This can't be undone unless you have a backup file. Continue?")) return;
    state = defaultState();
    saveState();
    weekOffset = 0;
    renderAll();
  });

  // ---------------- Full render ----------------
  function renderAll() {
    renderPantrySelect();
    renderInventory();
    renderQuickCount();
    renderRecipeList();
    renderMealPlan();
    renderShoppingList();
  }

  window.pantryApp = {
    adjustQty, removeItem, editRecipe, deleteRecipe, setMeal,
    toggleAutoChecked, toggleExtraChecked, removeExtra
  };

  renderAll();
})();
