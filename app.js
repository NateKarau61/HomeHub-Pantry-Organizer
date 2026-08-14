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
      version: 3,
      pantries: { "Main Pantry": { items: [] } },
      currentPantry: "Main Pantry",
      recipes: [],
      mealPlan: {},
      shoppingExtras: [],
      shoppingAutoChecked: {},
      costLog: [],
      activityLog: []
    };
  }

  function mergeIntoDefaultShape(raw) {
    const base = defaultState();
    return Object.assign(base, raw, {
      pantries: (raw && raw.pantries) || base.pantries,
      recipes: (raw && raw.recipes) || [],
      mealPlan: (raw && raw.mealPlan) || {},
      shoppingExtras: (raw && raw.shoppingExtras) || [],
      shoppingAutoChecked: (raw && raw.shoppingAutoChecked) || {},
      costLog: (raw && raw.costLog) || [],
      activityLog: (raw && raw.activityLog) || []
    });
  }

  function loadLocalFallback() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return mergeIntoDefaultShape(JSON.parse(raw));
    } catch (e) {
      console.warn("Could not read local data, starting fresh.", e);
      return defaultState();
    }
  }

  let state = loadLocalFallback();
  let saveTimer = null;

  // ---------------- Firebase auth + sync ----------------
  const HOUSEHOLD_COLLECTION = "households";
  const HOUSEHOLD_DOC = "shared";
  let fbAuth = null;
  let fbDb = null;
  let unsubscribeSnapshot = null;
  let applyingRemoteUpdate = false;

  function flashSaveStatus(msg) {
    const el = document.getElementById("saveStatus");
    if (el) el.textContent = msg;
  }

  function showAuthError(err) {
    const el = document.getElementById("authError");
    if (!el) return;
    el.textContent = (err && err.message) ? err.message : "Something went wrong. Please try again.";
    el.style.display = "";
  }

  function hideAuthError() {
    const el = document.getElementById("authError");
    if (el) el.style.display = "none";
  }

  function initFirebase() {
    if (typeof firebase === "undefined") {
      showAuthError({ message: "The login system couldn't load — check your internet connection and refresh the page." });
      return false;
    }
    if (typeof firebaseConfig === "undefined" || !firebaseConfig.apiKey || firebaseConfig.apiKey.indexOf("PASTE_YOUR") === 0) {
      showAuthError({ message: "This site isn't connected to a Firebase project yet — firebase-config.js still has placeholder values." });
      return false;
    }
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    fbAuth = firebase.auth();
    fbDb = firebase.firestore();
    return true;
  }

  function attachHouseholdListener() {
    if (unsubscribeSnapshot) unsubscribeSnapshot();
    const ref = fbDb.collection(HOUSEHOLD_COLLECTION).doc(HOUSEHOLD_DOC);
    unsubscribeSnapshot = ref.onSnapshot(
      snap => {
        applyingRemoteUpdate = true;
        if (snap.exists) {
          state = mergeIntoDefaultShape(snap.data());
          renderAll();
          flashSaveStatus("Synced");
        } else {
          // First person ever to log in — seed the shared household doc.
          // If this browser already has local data (from before login existed), carry it over.
          state = loadLocalFallback();
          ref.set(state).then(() => flashSaveStatus("Synced")).catch(() => flashSaveStatus("Couldn't sync — check your connection"));
          renderAll();
        }
        applyingRemoteUpdate = false;
      },
      () => {
        flashSaveStatus("Sync error — check your connection");
      }
    );
  }

  function saveState() {
    if (applyingRemoteUpdate) return; // don't echo back a write we're only applying locally
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!fbDb) return;
      fbDb.collection(HOUSEHOLD_COLLECTION).doc(HOUSEHOLD_DOC).set(state)
        .then(() => flashSaveStatus("Synced"))
        .catch(() => flashSaveStatus("Couldn't sync — check your connection"));
    }, 300);
  }

  function wireAuthUI() {
    document.getElementById("loginBtn").addEventListener("click", () => {
      hideAuthError();
      const email = document.getElementById("authEmail").value.trim();
      const password = document.getElementById("authPassword").value;
      if (!email || !password) { showAuthError({ message: "Enter an email and password." }); return; }
      fbAuth.signInWithEmailAndPassword(email, password).catch(showAuthError);
    });

    document.getElementById("signupBtn").addEventListener("click", () => {
      hideAuthError();
      const email = document.getElementById("authEmail").value.trim();
      const password = document.getElementById("authPassword").value;
      if (!email || !password) { showAuthError({ message: "Enter an email and password." }); return; }
      fbAuth.createUserWithEmailAndPassword(email, password).catch(showAuthError);
    });

    document.getElementById("logoutBtn").addEventListener("click", () => {
      fbAuth.signOut();
    });
  }

  function startAuthFlow() {
    wireAuthUI();
    if (!initFirebase()) return;
    fbAuth.onAuthStateChanged(user => {
      if (user) {
        document.getElementById("authScreen").style.display = "none";
        document.getElementById("appRoot").style.display = "";
        document.getElementById("loggedInAs").textContent = user.email;
        attachHouseholdListener();
      } else {
        document.getElementById("authScreen").style.display = "flex";
        document.getElementById("appRoot").style.display = "none";
        if (unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }
      }
    });
  }

  // ---------------- Activity log ----------------
  function currentUserLabel() {
    return (fbAuth && fbAuth.currentUser && fbAuth.currentUser.email) || "Someone";
  }

  function logActivity(action, detail) {
    state.activityLog = state.activityLog || [];
    state.activityLog.unshift({ id: uid(), ts: Date.now(), user: currentUserLabel(), action, detail });
    if (state.activityLog.length > 200) state.activityLog.length = 200;
  }

  function timeAgo(ts) {
    const diff = Math.max(0, Date.now() - ts);
    const mins = Math.round(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    const hours = Math.round(mins / 60);
    if (hours < 24) return hours + "h ago";
    const days = Math.round(hours / 24);
    if (days < 30) return days + "d ago";
    return new Date(ts).toLocaleDateString();
  }

  function renderActivityLog() {
    const wrap = document.getElementById("activityLogWrap");
    if (!wrap) return;
    const log = state.activityLog || [];
    if (log.length === 0) {
      wrap.innerHTML = '<p class="empty-note">No activity yet. Actions like adding items, saving recipes, and marking meals cooked will show up here.</p>';
      return;
    }
    wrap.innerHTML = log.map(entry => `
      <div class="shopping-item">
        <span class="label">${escapeHtml(entry.detail)}</span>
        <span class="pill" style="margin-left:auto;">${escapeHtml(entry.user)}</span>
        <span class="footnote" style="margin:0; white-space:nowrap;">${timeAgo(entry.ts)}</span>
      </div>
    `).join("");
  }

  // ---------------- Undo toast ----------------
  let pendingUndo = null;
  let undoTimer = null;

  function showUndoToast(message, restoreFn) {
    const toast = document.getElementById("undoToast");
    if (!toast) { return; }
    clearTimeout(undoTimer);
    document.getElementById("undoToastMsg").textContent = message;
    toast.style.display = "flex";
    pendingUndo = restoreFn;
    undoTimer = setTimeout(() => {
      toast.style.display = "none";
      pendingUndo = null;
    }, 6000);
  }

  function undoLastDelete() {
    clearTimeout(undoTimer);
    const toast = document.getElementById("undoToast");
    if (toast) toast.style.display = "none";
    if (pendingUndo) {
      const fn = pendingUndo;
      pendingUndo = null;
      fn();
    }
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

  function pantryNameExists(name) {
    const key = normName(name);
    return Object.keys(state.pantries).some(p => normName(p) === key);
  }

  document.getElementById("addPantryBtn").addEventListener("click", () => {
    document.getElementById("addPantryPanel").style.display = "flex";
    document.getElementById("newPantryPreset").value = "";
    document.getElementById("newPantryCustomWrap").style.display = "none";
    document.getElementById("newPantryCustomName").value = "";
  });

  document.getElementById("newPantryPreset").addEventListener("change", e => {
    document.getElementById("newPantryCustomWrap").style.display = e.target.value === "__custom" ? "" : "none";
  });

  document.getElementById("cancelAddPantryBtn").addEventListener("click", () => {
    document.getElementById("addPantryPanel").style.display = "none";
  });

  document.getElementById("confirmAddPantryBtn").addEventListener("click", () => {
    const preset = document.getElementById("newPantryPreset").value;
    const name = preset === "__custom"
      ? document.getElementById("newPantryCustomName").value.trim()
      : preset;
    if (!name) { alert("Pick a location or enter a custom name."); return; }
    if (pantryNameExists(name)) { alert("That location already exists."); return; }
    state.pantries[name] = { items: [] };
    state.currentPantry = name;
    document.getElementById("addPantryPanel").style.display = "none";
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
  const TAB_NAMES = ["inventory", "quick", "recipes", "mealplan", "shopping", "spending", "activity"];
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      TAB_NAMES.forEach(t => {
        const el = document.getElementById("tab-" + t);
        if (el) el.style.display = t === tab ? "" : "none";
      });
      if (tab === "quick") renderQuickCount();
      if (tab === "recipes") { renderRecipeList(); renderCookNow(); }
      if (tab === "mealplan") renderMealPlan();
      if (tab === "shopping") renderShoppingList();
      if (tab === "spending") renderSpending();
      if (tab === "activity") renderActivityLog();
    });
  });

  const undoToastBtn = document.getElementById("undoToastBtn");
  if (undoToastBtn) undoToastBtn.addEventListener("click", undoLastDelete);
  const undoToastDismissBtn = document.getElementById("undoToastDismissBtn");
  if (undoToastDismissBtn) undoToastDismissBtn.addEventListener("click", () => {
    clearTimeout(undoTimer);
    const toast = document.getElementById("undoToast");
    if (toast) toast.style.display = "none";
    pendingUndo = null;
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
    const barcode = document.getElementById("itemBarcode").value.trim() || null;
    const stapleEl = document.getElementById("itemStaple");
    const staple = !!(stapleEl && stapleEl.checked);
    const restockDaysEl = document.getElementById("itemRestockDays");
    const restockDays = staple ? (parseFloat(restockDaysEl && restockDaysEl.value) || 14) : null;
    const priceEl = document.getElementById("itemPrice");
    const price = priceEl && priceEl.value ? parseFloat(priceEl.value) : null;

    const newItem = {
      id: uid(), name, category, qty, unit, threshold, expiry, barcode,
      staple, restockDays,
      lastRestocked: staple ? new Date().toISOString().slice(0, 10) : null,
      price: (price != null && !isNaN(price)) ? price : null
    };
    currentPantryData().items.push(newItem);

    if (price != null && !isNaN(price) && price > 0) {
      state.costLog.push({ id: uid(), date: new Date().toISOString().slice(0, 10), amount: price, note: name });
    }

    logActivity("add", `Added "${name}"${qty ? " ×" + qty : ""} to ${escapeHtml(state.currentPantry)}`);

    document.getElementById("itemName").value = "";
    document.getElementById("itemQty").value = "1";
    document.getElementById("itemUnit").value = "";
    document.getElementById("itemThreshold").value = "1";
    document.getElementById("itemExpiry").value = "";
    document.getElementById("itemBarcode").value = "";
    if (stapleEl) stapleEl.checked = false;
    if (restockDaysEl) restockDaysEl.value = "";
    if (priceEl) priceEl.value = "";

    saveState();
    renderAll();
  }
  document.getElementById("addItemBtn").addEventListener("click", addItem);

  function removeItem(id) {
    const data = currentPantryData();
    const idx = data.items.findIndex(i => i.id === id);
    if (idx === -1) return;
    const removed = data.items[idx];
    const locationName = state.currentPantry;
    data.items.splice(idx, 1);
    logActivity("remove", `Removed "${removed.name}" from ${escapeHtml(locationName)}`);
    saveState();
    renderAll();
    showUndoToast(`Removed "${removed.name}".`, () => {
      const pantry = state.pantries[locationName];
      if (pantry) {
        pantry.items.splice(Math.min(idx, pantry.items.length), 0, removed);
        logActivity("undo", `Restored "${removed.name}" to ${escapeHtml(locationName)}`);
        saveState();
        renderAll();
      }
    });
  }

  function adjustQty(id, delta) {
    const data = currentPantryData();
    const item = data.items.find(i => i.id === id);
    if (!item) return;
    item.qty = Math.max(0, (parseFloat(item.qty) || 0) + delta);
    if (delta > 0 && item.staple) item.lastRestocked = new Date().toISOString().slice(0, 10);
    saveState();
    renderAll();
  }

  function toggleStaple(id) {
    const data = currentPantryData();
    const item = data.items.find(i => i.id === id);
    if (!item) return;
    item.staple = !item.staple;
    if (item.staple) {
      if (!item.restockDays) item.restockDays = 14;
      if (!item.lastRestocked) item.lastRestocked = new Date().toISOString().slice(0, 10);
    }
    saveState();
    renderAll();
  }

  function markRestocked(id) {
    const data = currentPantryData();
    const item = data.items.find(i => i.id === id);
    if (!item) return;
    item.lastRestocked = new Date().toISOString().slice(0, 10);
    saveState();
    renderShoppingList();
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
          <td data-label="Item">${escapeHtml(item.name)}${item.staple ? ' <span class="pill amber" title="Staple — restocks every ' + (item.restockDays || 14) + ' days">★ staple</span>' : ""}</td>
          <td data-label="Qty" class="qty-cell">${item.qty}${isLow ? ' <span class="pill warn">low</span>' : ""}</td>
          <td data-label="Unit">${escapeHtml(item.unit || "—")}</td>
          <td data-label="Expires" class="exp-cell">${expText}</td>
          <td data-label="">
            <button class="btn-icon" onclick="pantryApp.adjustQty('${item.id}', -1)">−</button>
            <button class="btn-icon" onclick="pantryApp.adjustQty('${item.id}', 1)">+</button>
            <button class="btn-icon" title="Toggle staple / recurring restock reminder" onclick="pantryApp.toggleStaple('${item.id}')">${item.staple ? "★" : "☆"}</button>
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

  function findPantryItemByName(name) {
    const key = normName(name);
    if (!key) return null;
    return allItemsAcrossLocations().find(i => normName(i.name) === key) || null;
  }

  function renderPantryItemNamesDatalist() {
    const dl = document.getElementById("pantryItemNames");
    if (!dl) return;
    const seen = new Map(); // lowercase name -> original-case name
    allItemsAcrossLocations().forEach(item => {
      const key = normName(item.name);
      if (key && !seen.has(key)) seen.set(key, item.name);
    });
    dl.innerHTML = Array.from(seen.values())
      .sort((a, b) => a.localeCompare(b))
      .map(name => `<option value="${escapeHtml(name)}"></option>`)
      .join("");
  }

  function ingredientRowTemplate(vals) {
    vals = vals || {};
    const row = document.createElement("div");
    row.className = "ingredient-row";
    row.innerHTML = `
      <input type="text" class="ing-name" list="pantryItemNames" placeholder="Ingredient name" value="${escapeHtml(vals.name || "")}">
      <input type="number" class="ing-qty" placeholder="Qty" min="0" step="0.1" value="${vals.qty != null ? vals.qty : ""}">
      <input type="text" class="ing-unit" placeholder="Unit" value="${escapeHtml(vals.unit || "")}">
      <select class="ing-category">
        ${CATEGORIES_ORDER.map(c => `<option ${vals.category === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
      </select>
      <button type="button" class="btn-danger remove-ing">✕</button>
    `;
    row.querySelector(".remove-ing").addEventListener("click", () => row.remove());

    // Picking (or typing) a name that matches something already in the pantry fills in
    // its unit and aisle automatically, so you're not re-typing details you already tracked.
    const nameInput = row.querySelector(".ing-name");
    nameInput.addEventListener("input", () => {
      const match = findPantryItemByName(nameInput.value);
      if (!match) return;
      const unitInput = row.querySelector(".ing-unit");
      const catSelect = row.querySelector(".ing-category");
      if (!unitInput.value && match.unit) unitInput.value = match.unit;
      if (match.category) catSelect.value = match.category;
    });

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
      logActivity("edit-recipe", `Updated recipe "${name}"`);
    } else {
      state.recipes.push({ id: uid(), name, servings, notes, ingredients });
      logActivity("add-recipe", `Added recipe "${name}"`);
    }

    saveState();
    resetRecipeForm();
    renderRecipeList();
    renderMealPlan();
    renderCookNow();
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
    const idx = state.recipes.findIndex(r => r.id === id);
    if (idx === -1) return;
    const removed = state.recipes[idx];
    const clearedSlots = [];
    Object.keys(state.mealPlan).forEach(dateKey => {
      MEAL_SLOTS.forEach(slot => {
        if (state.mealPlan[dateKey][slot] === id) {
          clearedSlots.push({ dateKey, slot });
          state.mealPlan[dateKey][slot] = null;
        }
      });
    });
    state.recipes.splice(idx, 1);
    logActivity("delete-recipe", `Deleted recipe "${removed.name}"`);
    saveState();
    renderRecipeList();
    renderMealPlan();
    renderCookNow();
    showUndoToast(`Deleted recipe "${removed.name}".`, () => {
      state.recipes.splice(Math.min(idx, state.recipes.length), 0, removed);
      clearedSlots.forEach(({ dateKey, slot }) => {
        ensureMealSlot(dateKey)[slot] = removed.id;
      });
      logActivity("undo", `Restored recipe "${removed.name}"`);
      saveState();
      renderRecipeList();
      renderMealPlan();
      renderCookNow();
    });
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

  // ---------------- What can I make right now ----------------
  function haveMap() {
    const have = {};
    allItemsAcrossLocations().forEach(item => {
      const k = normName(item.name);
      have[k] = (have[k] || 0) + (parseFloat(item.qty) || 0);
    });
    return have;
  }

  function canMakeRecipe(recipe, have) {
    return recipe.ingredients.every(ing => {
      if (!ing.qty) return (have[normName(ing.name)] || 0) > 0;
      return (have[normName(ing.name)] || 0) >= ing.qty - 0.0001;
    });
  }

  function renderCookNow() {
    const wrap = document.getElementById("cookNowWrap");
    if (!wrap) return;
    if (state.recipes.length === 0) {
      wrap.innerHTML = '<p class="empty-note">Add some recipes below, and the ones you already have everything for will show up here.</p>';
      return;
    }
    const have = haveMap();
    const makeable = state.recipes.filter(r => r.ingredients.length && canMakeRecipe(r, have));
    if (makeable.length === 0) {
      wrap.innerHTML = '<p class="empty-note">Nothing yet — recipes will show up here once you have every ingredient on hand.</p>';
      return;
    }
    wrap.innerHTML = makeable.map(r => `<span class="pill amber" style="margin:3px 6px 3px 0; font-size:0.85rem; padding:5px 12px;">🍳 ${escapeHtml(r.name)}</span>`).join("");
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
        </select>
        ${slot[s] ? `<button class="btn-icon" style="margin-top:4px; font-size:0.75rem;" onclick="pantryApp.markRecipeCooked('${key}','${s}')">✓ Cooked</button>` : ""}
        </td>`;
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
    renderMealPlan();
  }

  function markRecipeCooked(dateKey, slot) {
    const mealSlot = state.mealPlan[dateKey];
    const recipeId = mealSlot && mealSlot[slot];
    if (!recipeId) return;
    const recipe = state.recipes.find(r => r.id === recipeId);
    if (!recipe) return;
    if (!confirm(`Mark "${recipe.name}" as cooked? This will subtract its ingredients from your pantry inventory.`)) return;

    recipe.ingredients.forEach(ing => {
      let remaining = ing.qty || 0;
      if (remaining <= 0) return;
      Object.keys(state.pantries).forEach(loc => {
        if (remaining <= 0) return;
        state.pantries[loc].items.forEach(item => {
          if (remaining <= 0) return;
          if (normName(item.name) !== normName(ing.name)) return;
          const onHand = parseFloat(item.qty) || 0;
          const take = Math.min(remaining, onHand);
          item.qty = Math.max(0, onHand - take);
          remaining -= take;
        });
      });
    });

    logActivity("cooked", `Marked "${recipe.name}" as cooked (${MEAL_SLOT_LABELS[slot]}, ${dateKey})`);
    saveState();
    renderAll();
    alert(`Nice! Subtracted "${recipe.name}"'s ingredients from your pantry.`);
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

    logActivity("mealplan-shop", `Generated shopping list for the week of ${formatDateKey(days[0])} (${addedCount} item${addedCount === 1 ? "" : "s"})`);
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

  // Staple items are due for a restock reminder once their configured interval has elapsed
  // since they were last restocked — independent of whether they're technically "low stock."
  function stapleDueItems() {
    const out = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    Object.keys(state.pantries).forEach(loc => {
      state.pantries[loc].items.forEach(item => {
        if (!item.staple) return;
        const days = parseFloat(item.restockDays) || 14;
        const last = item.lastRestocked ? new Date(item.lastRestocked + "T00:00:00") : null;
        const dueDate = last ? new Date(last.getTime() + days * 86400000) : today;
        if (dueDate <= today) out.push({ location: loc, item });
      });
    });
    return out;
  }

  function renderShoppingList() {
    const wrap = document.getElementById("shoppingListWrap");
    const low = lowStockItems();
    const staples = stapleDueItems().filter(({ item }) => !low.some(l => l.item.id === item.id));
    const extras = state.shoppingExtras || [];

    if (low.length === 0 && staples.length === 0 && extras.length === 0) {
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

    staples.forEach(({ location, item }) => {
      pushToGroup(item.category || "Other", `
        <div class="shopping-item">
          <span class="label">${escapeHtml(item.name)}${item.unit ? " (" + escapeHtml(item.unit) + ")" : ""}</span>
          <span class="pill amber">restock reminder · ${escapeHtml(location)}</span>
          <button class="btn-secondary" style="margin-left:auto;" onclick="pantryApp.markRestocked('${item.id}')">Mark restocked</button>
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
    logActivity("add-shopping", `Added "${label}" to the shopping list`);
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
    const staples = stapleDueItems().filter(({ item }) => !low.some(l => l.item.id === item.id));
    const extras = (state.shoppingExtras || []).filter(e => !e.checked);
    const lines = [
      ...low.map(({ item }) => `- ${item.name}${item.unit ? " (" + item.unit + ")" : ""}`),
      ...staples.map(({ item }) => `- ${item.name}${item.unit ? " (" + item.unit + ")" : ""} (staple restock)`),
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

  document.getElementById("printListBtn").addEventListener("click", () => {
    const low = lowStockItems().filter(({ location, item }) => !state.shoppingAutoChecked["lowstock:" + location + ":" + item.id]);
    const staples = stapleDueItems().filter(({ item }) => !low.some(l => l.item.id === item.id));
    const extras = (state.shoppingExtras || []).filter(e => !e.checked);

    if (low.length === 0 && staples.length === 0 && extras.length === 0) {
      alert("Your shopping list is empty — nothing to print.");
      return;
    }

    const groups = {};
    function pushToGroup(cat, text) {
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(text);
    }
    low.forEach(({ location, item }) => {
      pushToGroup(item.category || "Other", `${escapeHtml(item.name)}${item.unit ? " (" + escapeHtml(item.unit) + ")" : ""} — ${escapeHtml(location)}`);
    });
    staples.forEach(({ location, item }) => {
      pushToGroup(item.category || "Other", `${escapeHtml(item.name)}${item.unit ? " (" + escapeHtml(item.unit) + ")" : ""} — restock reminder, ${escapeHtml(location)}`);
    });
    extras.forEach(ex => {
      pushToGroup(ex.category || "Other", `${escapeHtml(ex.label)}${ex.qty ? " — need " + escapeHtml(String(ex.qty)) : ""}`);
    });

    const cats = CATEGORIES_ORDER.filter(c => groups[c]).concat(Object.keys(groups).filter(c => !CATEGORIES_ORDER.includes(c)));
    const dateStr = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

    const printArea = document.getElementById("printArea");
    printArea.innerHTML = `
      <h1>🥫 Shopping List</h1>
      <p style="color:#555; margin:0 0 12px;">${dateStr}</p>
      ${cats.map(cat => `
        <h3>${escapeHtml(cat)}</h3>
        <ul>
          ${groups[cat].map(line => `<li>&#9744; ${line}</li>`).join("")}
        </ul>
      `).join("")}
    `;

    window.print();
  });

  // ---------------- Spending / cost tracking ----------------
  function addCostEntry() {
    const amountEl = document.getElementById("costAmount");
    const amount = parseFloat(amountEl.value);
    if (!amount || amount <= 0) { alert("Enter an amount greater than 0."); return; }
    const dateEl = document.getElementById("costDate");
    const date = dateEl.value || new Date().toISOString().slice(0, 10);
    const noteEl = document.getElementById("costNote");
    const note = noteEl.value.trim();

    state.costLog.push({ id: uid(), date, amount, note });
    logActivity("spending", `Logged $${amount.toFixed(2)}${note ? " — " + note : ""}`);

    amountEl.value = "";
    noteEl.value = "";
    dateEl.value = "";

    saveState();
    renderSpending();
  }
  const addCostBtn = document.getElementById("addCostBtn");
  if (addCostBtn) addCostBtn.addEventListener("click", addCostEntry);

  function removeCostEntry(id) {
    state.costLog = (state.costLog || []).filter(c => c.id !== id);
    saveState();
    renderSpending();
  }

  function renderSpending() {
    const wrap = document.getElementById("spendingListWrap");
    const statsWrap = document.getElementById("spendingStats");
    if (!wrap || !statsWrap) return;

    const log = (state.costLog || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    const cutoff30 = Date.now() - 30 * 86400000;
    const total30 = log
      .filter(c => new Date(c.date + "T00:00:00").getTime() >= cutoff30)
      .reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);

    let monthlyAvg = 0;
    if (log.length) {
      const months = new Set(log.map(c => (c.date || "").slice(0, 7)).filter(Boolean));
      const totalAll = log.reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
      monthlyAvg = totalAll / Math.max(1, months.size);
    }

    statsWrap.innerHTML = `
      <span class="pill warn">Last 30 days: $${total30.toFixed(2)}</span>
      <span class="pill amber">Monthly average: $${monthlyAvg.toFixed(2)}</span>
    `;

    if (log.length === 0) {
      wrap.innerHTML = '<p class="empty-note">No spending logged yet. Add a grocery trip total above to start tracking.</p>';
      return;
    }

    wrap.innerHTML = log.map(c => `
      <div class="shopping-item">
        <span class="label">${escapeHtml(c.date)} — $${(parseFloat(c.amount) || 0).toFixed(2)}${c.note ? " · " + escapeHtml(c.note) : ""}</span>
        <button class="btn-danger" style="margin-left:auto;" onclick="pantryApp.removeCostEntry('${c.id}')">Remove</button>
      </div>
    `).join("");
  }

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

  // ---------------- Barcode scanning ----------------
  const OFF_LOOKUP_URL = "https://world.openfoodfacts.org/api/v2/product/";
  const CATEGORY_KEYWORD_MAP = [
    ["Produce", ["fruit", "vegetable", "produce"]],
    ["Grains & Pasta", ["pasta", "rice", "cereal", "grain", "bread", "noodle"]],
    ["Canned & Jarred", ["canned", "jarred", "preserve", "conserve"]],
    ["Baking", ["baking", "flour", "sugar", "cake", "cookie-doughs"]],
    ["Spices & Condiments", ["spice", "condiment", "sauce", "seasoning", "herb"]],
    ["Snacks", ["snack", "chip", "candy", "chocolate"]],
    ["Frozen", ["frozen"]],
    ["Dairy & Eggs", ["dairy", "milk", "cheese", "egg", "yogurt", "yoghurt"]],
    ["Meat & Seafood", ["meat", "seafood", "fish", "poultry", "beef", "pork", "chicken"]],
    ["Beverages", ["beverage", "drink", "juice", "soda", "water", "coffee", "tea"]],
    ["Cleaning & Household", ["clean", "household", "detergent", "paper-goods"]]
  ];

  let scanner = null;
  let scannerRunning = false;
  let scannerTeardown = Promise.resolve();

  function guessCategoryFromTags(tags) {
    if (!tags || !tags.length) return null;
    const joined = tags.join(" ").toLowerCase();
    for (let i = 0; i < CATEGORY_KEYWORD_MAP.length; i++) {
      const [cat, keywords] = CATEGORY_KEYWORD_MAP[i];
      if (keywords.some(kw => joined.includes(kw))) return cat;
    }
    return null;
  }

  function setScanStatus(msg, isError) {
    const el = document.getElementById("scanStatusMsg");
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle("scan-error", !!isError);
  }

  function openScanModal() {
    if (typeof Html5Qrcode === "undefined") {
      alert("The barcode scanner couldn't load (no internet connection?). You can still add items by typing them in.");
      return;
    }
    document.getElementById("scanModal").style.display = "flex";
    setScanStatus("Starting camera…", false);
    document.getElementById("scanBtn").disabled = true;

    // Wait for any previous camera session to fully stop and clear before starting a new one.
    // Skipping this is what caused the scanner to "re-scan" a frozen leftover frame from last time.
    scannerTeardown
      .then(() => {
        document.getElementById("qrReader").innerHTML = "";
        scanner = new Html5Qrcode("qrReader");
        const config = {
          fps: 10,
          qrbox: { width: 250, height: 150 },
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.QR_CODE
          ]
        };

        return scanner.start(
          { facingMode: "environment" },
          config,
          decodedText => {
            if (!scannerRunning) return; // ignore duplicate fires while we're already handling one
            scannerRunning = false;
            handleScannedBarcode(decodedText);
          },
          () => { /* per-frame decode errors are normal while searching for a barcode; ignore */ }
        ).then(() => {
          scannerRunning = true;
          setScanStatus("Point your camera at a barcode. Already have it in stock? Scanning it just adds one to the count.", false);
        });
      })
      .catch(err => {
        setScanStatus("Couldn't access the camera: " + (err && err.message ? err.message : err), true);
      })
      .finally(() => {
        document.getElementById("scanBtn").disabled = false;
      });
  }

  function closeScanModal() {
    document.getElementById("scanModal").style.display = "none";
    scannerRunning = false;
    const s = scanner;
    scanner = null;
    if (s) {
      // stop() then clear() tears down the video stream and removes leftover DOM nodes so the
      // next scan starts from a truly blank state instead of showing a stale frame.
      scannerTeardown = s.stop().catch(() => {}).then(() => {
        try { s.clear(); } catch (e) { /* ignore */ }
        const el = document.getElementById("qrReader");
        if (el) el.innerHTML = "";
      });
    } else {
      scannerTeardown = Promise.resolve();
    }
  }

  function handleScannedBarcode(code) {
    // 1) If this barcode is already tracked in the current location, just bump its quantity.
    const data = currentPantryData();
    const existing = data.items.find(i => i.barcode === code);
    if (existing) {
      existing.qty = (parseFloat(existing.qty) || 0) + 1;
      if (existing.staple) existing.lastRestocked = new Date().toISOString().slice(0, 10);
      saveState();
      renderAll();
      closeScanModal();
      alert(`Scanned "${existing.name}" — quantity is now ${existing.qty}.`);
      return;
    }

    // 2) New barcode: try to look up the product, then prefill the add-item form.
    closeScanModal();
    document.getElementById("itemBarcode").value = code;
    document.getElementById("itemName").value = "";
    flashSaveStatus("Looking up barcode " + code + "…");

    fetch(OFF_LOOKUP_URL + encodeURIComponent(code) + ".json")
      .then(r => r.json())
      .then(data => {
        if (data && data.status === 1 && data.product) {
          const p = data.product;
          const name = p.product_name || p.generic_name || "";
          if (name) document.getElementById("itemName").value = p.brands ? `${name} (${p.brands})` : name;
          const guessed = guessCategoryFromTags(p.categories_tags);
          if (guessed) document.getElementById("itemCategory").value = guessed;
          flashSaveStatus(name ? `Found "${name}" — check the details and click Add item.` : `Barcode ${code} scanned — enter the name and click Add item.`);
        } else {
          flashSaveStatus(`Barcode ${code} scanned but not found online — enter the name and click Add item.`);
        }
      })
      .catch(() => {
        flashSaveStatus(`Barcode ${code} scanned (lookup unavailable) — enter the name and click Add item.`);
      })
      .finally(() => {
        document.getElementById("itemName").focus();
      });
  }

  document.getElementById("scanBtn").addEventListener("click", openScanModal);
  document.getElementById("closeScanBtn").addEventListener("click", closeScanModal);

  // Test-only hooks: let automated tests exercise things that are hard to trigger for real
  // (a camera scan, the passage of time for a restock reminder, etc). Harmless in normal use —
  // nothing here is ever called unless a test explicitly invokes it.
  window.__pantryTestHooks = {
    handleScannedBarcode, guessCategoryFromTags,
    getState: () => state,
    renderAll, renderShoppingList, renderSpending, renderActivityLog, renderCookNow,
    stapleDueItems
  };

  // ---------------- Full render ----------------
  function renderAll() {
    renderPantrySelect();
    renderInventory();
    renderQuickCount();
    renderRecipeList();
    renderCookNow();
    renderMealPlan();
    renderShoppingList();
    renderPantryItemNamesDatalist();
    renderSpending();
    renderActivityLog();
  }

  window.pantryApp = {
    adjustQty, removeItem, editRecipe, deleteRecipe, setMeal, markRecipeCooked,
    toggleAutoChecked, toggleExtraChecked, removeExtra, toggleStaple, markRestocked,
    removeCostEntry
  };

  startAuthFlow();
})();
