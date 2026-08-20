(function () {
  "use strict";

  const STORAGE_KEY = "pantryOrganizerData";
  const CATEGORIES_ORDER = ["Produce","Grains & Pasta","Canned & Jarred","Baking","Spices & Condiments","Snacks","Frozen","Dairy & Eggs","Meat & Seafood","Beverages","Cleaning & Household","Other"];
  const MEAL_SLOTS = ["breakfast", "lunch", "dinner"];
  const MEAL_SLOT_LABELS = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };

  let uidCounter = 1;
  function uid() {
    return "id_" + Date.now().toString(36) + "_" + (uidCounter++) + "_" + Math.random().toString(36).slice(2, 7);
  }

  function defaultSettings() {
    return { expiringSoonDays: 7, defaultLowStock: 1, defaultRestockDays: 14, darkTheme: false, leftoverShelfLifeDays: 4 };
  }

  function applyTheme() {
    document.body.classList.toggle("dark-theme", !!(state.settings && state.settings.darkTheme));
  }

  function defaultState() {
    return {
      version: 4,
      pantries: { "Main Pantry": { items: [] } },
      currentPantry: "",
      recipes: [],
      mealPlan: {},
      shoppingExtras: [],
      shoppingAutoChecked: {},
      costLog: [],
      activityLog: [],
      consumptionLog: [],
      leftovers: [],
      dismissedNotifications: {},
      settings: defaultSettings()
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
      activityLog: (raw && raw.activityLog) || [],
      consumptionLog: (raw && raw.consumptionLog) || [],
      leftovers: (raw && raw.leftovers) || [],
      dismissedNotifications: (raw && raw.dismissedNotifications) || {},
      settings: Object.assign(defaultSettings(), (raw && raw.settings) || {})
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

  // ---------------- Consumption tracking ----------------
  // A running record of how much of what got used, and how (cooking a recipe vs. tapping the
  // "−" button by hand) — this powers the Dashboard's "Recently used" list and lets the shopping
  // list suggest a buy quantity based on how fast something actually gets used, instead of just
  // flagging that it's low.
  function logConsumption(name, qty, unit, source) {
    if (!name || !qty || qty <= 0) return;
    state.consumptionLog = state.consumptionLog || [];
    state.consumptionLog.unshift({ id: uid(), ts: Date.now(), name, qty, unit: unit || "", source });
    if (state.consumptionLog.length > 300) state.consumptionLog.length = 300;
  }

  // Average amount of an item used per week, based on the last 28 days of consumption — 0 if
  // there's not enough history yet. Matches by name the same way recipes/shopping do.
  function weeklyUsageRate(name) {
    const key = normName(name);
    if (!key) return 0;
    const cutoff = Date.now() - 28 * 86400000;
    const total = (state.consumptionLog || [])
      .filter(c => c.ts >= cutoff && normName(c.name) === key)
      .reduce((sum, c) => sum + (parseFloat(c.qty) || 0), 0);
    return total / 4;
  }

  function renderRecentlyUsed() {
    const wrap = document.getElementById("dashboardRecentlyUsedWrap");
    if (!wrap) return;
    const recent = (state.consumptionLog || []).slice(0, 6);
    if (recent.length === 0) {
      wrap.innerHTML = '<p class="empty-note">Nothing used yet — cooking a recipe or adjusting a quantity down will show up here.</p>';
      return;
    }
    wrap.innerHTML = recent.map(c => `
      <div class="shopping-item">
        <span class="label">${c.source === "cooked" ? "🍳" : "✋"} ${escapeHtml(c.name)}</span>
        <span class="footnote" style="margin:0 8px 0 auto;">${c.qty}${c.unit ? " " + escapeHtml(c.unit) : ""}</span>
        <span class="footnote" style="margin:0; white-space:nowrap;">${timeAgo(c.ts)}</span>
      </div>
    `).join("");
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

  // An intentionally blank selection ("") means "nothing chosen yet" and returns null —
  // distinct from a stale/invalid reference (e.g. a location that got deleted), which still
  // falls back to the first remaining location so existing data never breaks.
  function currentPantryData() {
    if (state.currentPantry === "") return null;
    if (!state.pantries[state.currentPantry]) {
      const first = Object.keys(state.pantries)[0];
      state.currentPantry = first || "";
    }
    if (state.currentPantry === "") return null;
    return state.pantries[state.currentPantry];
  }

  function escapeForInlineJs(str) {
    return String(str == null ? "" : str).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
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
    const blankOpt = document.createElement("option");
    blankOpt.value = "";
    blankOpt.textContent = "— choose a location —";
    sel.appendChild(blankOpt);
    Object.keys(state.pantries).forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    // Reuses currentPantryData()'s fallback rules: a stale reference snaps to the first
    // location, but an intentional blank ("") stays blank instead of auto-selecting one.
    currentPantryData();
    sel.value = state.currentPantry || "";
  }

  // ---------------- Print scope selector ----------------
  function renderPrintScopeSelect() {
    const sel = document.getElementById("printInventoryScope");
    if (!sel) return;
    const prevValue = sel.value;
    sel.innerHTML = "";
    const allOpt = document.createElement("option");
    allOpt.value = "__all";
    allOpt.textContent = "All locations";
    sel.appendChild(allOpt);
    Object.keys(state.pantries).forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    sel.value = (prevValue === "__all" || state.pantries[prevValue]) ? prevValue : "__all";
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
    if (!state.currentPantry) { alert("Choose a storage location first."); return; }
    const names = Object.keys(state.pantries);
    if (names.length <= 1) { alert("You need at least one storage location."); return; }
    if (!confirm(`Remove "${state.currentPantry}" and everything in it?`)) return;
    delete state.pantries[state.currentPantry];
    state.currentPantry = ""; // require an explicit re-pick rather than silently landing on another location
    saveState();
    renderAll();
  });

  // ---------------- Tabs ----------------
  const TAB_NAMES = ["dashboard", "inventory", "quick", "recipes", "mealplan", "shopping", "spending", "settings"];

  function activateTab(tab) {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    TAB_NAMES.forEach(t => {
      const el = document.getElementById("tab-" + t);
      if (el) el.style.display = t === tab ? "" : "none";
    });
    if (tab === "dashboard") renderDashboard();
    if (tab === "quick") renderQuickCount();
    if (tab === "recipes") { renderRecipeList(); renderCookNow(); }
    if (tab === "mealplan") renderMealPlan();
    if (tab === "shopping") renderShoppingList();
    if (tab === "spending") renderSpending();
    if (tab === "settings") { renderActivityLog(); renderSettingsForm(); }
  }

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });

  // Lets the Dashboard's quick-action buttons (and anything else) jump straight to a tab
  // and, for a couple of them, take a follow-up action once that tab is showing.
  function goToTab(tab) { activateTab(tab); }
  function goToAddItem() {
    activateTab("inventory");
    const el = document.getElementById("itemName");
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.focus(); }
  }
  function goToScan() {
    activateTab("inventory");
    openScanModal();
  }
  function goToFindMeals() {
    activateTab("recipes");
  }

  const undoToastBtn = document.getElementById("undoToastBtn");
  if (undoToastBtn) undoToastBtn.addEventListener("click", undoLastDelete);
  const undoToastDismissBtn = document.getElementById("undoToastDismissBtn");
  if (undoToastDismissBtn) undoToastDismissBtn.addEventListener("click", () => {
    clearTimeout(undoTimer);
    const toast = document.getElementById("undoToast");
    if (toast) toast.style.display = "none";
    pendingUndo = null;
  });

  // ---------------- In-app notifications ----------------
  // A header-level bell so alerts are visible from any tab, not just the Dashboard. Built from
  // the same helpers as the Dashboard/shopping list — no separate source of truth. Dismissing an
  // alert hides it until its key is no longer active (e.g. the item gets restocked) and then
  // reappears fresh if the same condition comes back later, rather than being gone forever.
  function computeNotifications() {
    const list = [];
    lowStockItems().forEach(({ location, item }) => {
      const qty = parseFloat(item.qty) || 0;
      list.push({
        key: "low:" + location + ":" + item.id,
        text: `${qty <= 0 ? "Out of" : "Running low on"} ${item.name} (${location})`,
        tab: "shopping"
      });
    });
    stapleDueItems().forEach(({ location, item }) => {
      list.push({ key: "staple:" + location + ":" + item.id, text: `Time to restock ${item.name} (${location})`, tab: "shopping" });
    });
    expiringSoonAcrossLocations().filter(e => e.daysLeft <= 2).forEach(({ location, item, daysLeft }) => {
      const when = daysLeft < 0 ? "expired" : daysLeft === 0 ? "expires today" : `expires in ${daysLeft}d`;
      list.push({ key: "expiring:" + location + ":" + item.id, text: `${item.name} ${when} (${location})`, tab: "inventory" });
    });
    activeLeftovers().forEach(lo => {
      const d = daysUntil(lo.expiresOn);
      if (d !== null && d <= 1) {
        list.push({ key: "leftover:" + lo.id, text: `Leftover "${lo.name}" ${d < 0 ? "expired" : d === 0 ? "should be eaten today" : "expires tomorrow"}`, tab: "dashboard" });
      }
    });
    return list;
  }

  function renderNotifications() {
    const all = computeNotifications();
    const activeKeys = new Set(all.map(n => n.key));
    state.dismissedNotifications = state.dismissedNotifications || {};
    // A dismissal only makes sense while its underlying alert is still active — once the
    // condition's gone (restocked, used up, etc.) drop the dismissal so a future recurrence
    // shows up fresh instead of staying silently hidden forever.
    Object.keys(state.dismissedNotifications).forEach(k => { if (!activeKeys.has(k)) delete state.dismissedNotifications[k]; });
    const visible = all.filter(n => !state.dismissedNotifications[n.key]);

    const badge = document.getElementById("notifBadge");
    if (badge) {
      badge.textContent = String(visible.length);
      badge.style.display = visible.length ? "" : "none";
    }
    const panel = document.getElementById("notifPanel");
    if (!panel) return;
    if (visible.length === 0) {
      panel.innerHTML = '<p class="empty-note" style="padding:10px 12px;">You\'re all caught up.</p>';
    } else {
      panel.innerHTML = visible.map(n => `
        <div class="notif-row" onclick="pantryApp.goToTab('${n.tab}')">
          <span>${escapeHtml(n.text)}</span>
          <button class="btn-icon" type="button" onclick="event.stopPropagation(); pantryApp.dismissNotification('${n.key}')">✕</button>
        </div>
      `).join("") + `<button class="btn-secondary" style="width:100%; margin-top:8px;" type="button" onclick="pantryApp.clearAllNotifications()">Dismiss all</button>`;
    }
  }

  function dismissNotification(key) {
    state.dismissedNotifications = state.dismissedNotifications || {};
    state.dismissedNotifications[key] = true;
    saveState();
    renderNotifications();
  }

  function clearAllNotifications() {
    state.dismissedNotifications = state.dismissedNotifications || {};
    computeNotifications().forEach(n => { state.dismissedNotifications[n.key] = true; });
    saveState();
    renderNotifications();
  }

  const notifBellBtn = document.getElementById("notifBell");
  if (notifBellBtn) notifBellBtn.addEventListener("click", e => {
    e.stopPropagation();
    const panel = document.getElementById("notifPanel");
    if (panel) panel.style.display = panel.style.display === "none" ? "" : "none";
  });
  document.addEventListener("click", e => {
    const panel = document.getElementById("notifPanel");
    const bell = document.getElementById("notifBell");
    if (!panel || panel.style.display === "none") return;
    if (panel.contains(e.target) || (bell && bell.contains(e.target))) return;
    panel.style.display = "none";
  });

  // ---------------- Dashboard ----------------
  // A one-glance summary: status counts, what needs attention, top-ready recipes, this week's
  // meal plan, and the shopping list size — all built from the same helpers the other tabs use,
  // so there's no separate source of truth to keep in sync.
  function renderDashboard() {
    const greetingEl = document.getElementById("dashboardGreeting");
    if (!greetingEl) return; // markup not present yet (shouldn't happen, but be defensive)

    const hour = new Date().getHours();
    const timeOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
    const rawName = currentUserLabel().split("@")[0] || "there";
    greetingEl.textContent = `Good ${timeOfDay}, ${titleCaseWords(rawName.replace(/[._-]+/g, " "))}!`;

    const allItems = allItemsAcrossLocations();
    const low = lowStockItems();
    const expiring = expiringSoonAcrossLocations();
    const pricedTotal = allItems.reduce((sum, i) => sum + (i.price != null ? i.price * (parseFloat(i.qty) || 0) : 0), 0);
    const hasAnyPriced = allItems.some(i => i.price != null);

    const pillsWrap = document.getElementById("dashboardStatusPills");
    if (pillsWrap) {
      pillsWrap.innerHTML = `
        <span class="pill">${allItems.length} item${allItems.length === 1 ? "" : "s"} in stock</span>
        <span class="pill ${low.length ? "warn" : ""}">${low.length} low stock</span>
        <span class="pill ${expiring.length ? "warn" : ""}">${expiring.length} expiring soon</span>
        ${hasAnyPriced ? `<span class="pill amber">~$${pricedTotal.toFixed(2)} estimated value</span>` : ""}
      `;
    }

    const attnWrap = document.getElementById("dashboardNeedsAttentionWrap");
    if (attnWrap) {
      // An item can be both expiring soon AND low stock (e.g. right at its threshold) — merge
      // those into one row with both badges instead of listing the same item twice.
      const merged = new Map(); // item.id -> { location, item, badges: [] }
      expiring.forEach(({ location, item, daysLeft }) => {
        const when = daysLeft < 0 ? "expired" : daysLeft === 0 ? "expires today" : daysLeft + "d left";
        merged.set(item.id, { location, item, badges: [when] });
      });
      low.forEach(({ location, item }) => {
        const entry = merged.get(item.id);
        if (entry) entry.badges.push("low stock");
        else merged.set(item.id, { location, item, badges: ["low stock"] });
      });
      const rows = Array.from(merged.values()).slice(0, 8).map(({ location, item, badges }) => `
        <div class="shopping-item">
          <span class="label">${escapeHtml(item.name)}</span>
          ${badges.map(b => `<span class="pill warn">${escapeHtml(b)}</span>`).join("")}
          <span class="footnote" style="margin:0 0 0 auto;">${escapeHtml(location)}</span>
        </div>`);
      const leftoverRows = urgentLeftovers().map(lo => {
        const d = daysUntil(lo.expiresOn);
        const when = d < 0 ? "expired" : "eat today";
        return `
        <div class="shopping-item">
          <span class="label">🍱 ${escapeHtml(lo.name)} (leftovers)</span>
          <span class="pill warn">${when}</span>
          <button class="btn-danger" style="margin-left:auto;" onclick="pantryApp.removeLeftover('${lo.id}')">Used up</button>
        </div>`;
      });
      let html = (rows.length || leftoverRows.length) ? rows.join("") + leftoverRows.join("") : '<p class="empty-note">Nothing needs attention right now.</p>';
      if (expiring.length) {
        const matchingRecipes = recipesUsingNames(expiring.map(e => e.item.name));
        if (matchingRecipes.length) {
          html += `<p class="footnote" style="margin-top:10px;">Recipes using items expiring soon: ${matchingRecipes.map(r => escapeHtml(r.name)).join(", ")}</p>`;
        }
      }
      attnWrap.innerHTML = html;
    }

    const cookWrap = document.getElementById("dashboardCookNowPreview");
    if (cookWrap) {
      if (state.recipes.length === 0) {
        cookWrap.innerHTML = '<p class="empty-note">Add a recipe to see how ready you are to make it.</p>';
      } else {
        const have = haveMap();
        const ranked = state.recipes.filter(r => r.ingredients.length).map(r => recipeReadiness(r, have)).sort((a, b) => b.percent - a.percent).slice(0, 3);
        cookWrap.innerHTML = ranked.length ? ranked.map(({ recipe, percent }) => `
          <div class="shopping-item">
            <span class="label">${escapeHtml(recipe.name)}</span>
            <span class="pill ${percent === 100 ? "" : "amber"}" style="margin-left:auto;">${percent}% ready</span>
          </div>
        `).join("") : '<p class="empty-note">Add ingredients to a recipe to see how ready you are to make it.</p>';
      }
    }

    const mealWrap = document.getElementById("dashboardMealPlanPreview");
    if (mealWrap) {
      const days = getDatesForOffset(0); // always "this week", regardless of the Meal plan tab's own navigation
      const lines = [];
      days.forEach((d, idx) => {
        const key = formatDateKey(d);
        const slot = state.mealPlan[key];
        if (!slot) return;
        const names = MEAL_SLOTS.map(s => slot[s]).filter(Boolean).map(mealSlotLabel).filter(Boolean);
        if (names.length) lines.push(`<div class="shopping-item"><span class="label">${DAY_NAMES[idx]}</span><span class="footnote" style="margin:0 0 0 auto;">${names.map(n => escapeHtml(n)).join(", ")}</span></div>`);
      });
      mealWrap.innerHTML = lines.length ? lines.join("") : '<p class="empty-note">Nothing planned this week yet.</p>';
    }

    const shopWrap = document.getElementById("dashboardShoppingPreview");
    if (shopWrap) {
      const count = shoppingListCount();
      shopWrap.innerHTML = `
        <div class="shopping-item">
          <span class="label">${count} item${count === 1 ? "" : "s"} on your shopping list</span>
          <button class="btn-secondary" style="margin-left:auto;" type="button" onclick="pantryApp.goToTab('shopping')">Open shopping list</button>
        </div>
      `;
    }

    renderRecentlyUsed();
    renderLeftovers();
  }

  // ---------------- Inventory ----------------
  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(dateStr + "T00:00:00");
    return Math.round((d - today) / 86400000);
  }

  // Storage location, item name, category, quantity, unit, and low-stock number must all be
  // filled in before an item can be added — nothing here defaults to a pre-filled value.
  const ADD_ITEM_REQUIRED_FIELD_IDS = ["pantrySelect", "itemName", "itemCategory", "itemQty", "itemUnit", "itemThreshold"];

  function fieldIsEmpty(el) {
    if (!el) return true;
    return String(el.value == null ? "" : el.value).trim() === "";
  }

  function validateAddItemForm() {
    let allValid = true;
    ADD_ITEM_REQUIRED_FIELD_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const empty = fieldIsEmpty(el);
      el.classList.toggle("input-invalid", empty);
      if (empty) allValid = false;
    });
    return allValid;
  }

  ADD_ITEM_REQUIRED_FIELD_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", validateAddItemForm);
    el.addEventListener("change", validateAddItemForm);
  });

  function addItem() {
    if (!validateAddItemForm()) {
      alert("Fill in storage location, item name, category, quantity, unit, and low-stock number before adding an item.");
      return;
    }
    const data = currentPantryData();
    if (!data) { alert("Choose a storage location first."); return; }

    const name = document.getElementById("itemName").value.trim();
    const category = document.getElementById("itemCategory").value;
    const qty = parseFloat(document.getElementById("itemQty").value) || 0;
    const unit = document.getElementById("itemUnit").value.trim();
    const threshold = parseFloat(document.getElementById("itemThreshold").value) || 0;
    const expiry = document.getElementById("itemExpiry").value;
    const barcode = document.getElementById("itemBarcode").value.trim() || null;
    const stapleEl = document.getElementById("itemStaple");
    const staple = !!(stapleEl && stapleEl.checked);
    const restockDaysEl = document.getElementById("itemRestockDays");
    const restockDays = staple ? (parseFloat(restockDaysEl && restockDaysEl.value) || state.settings.defaultRestockDays) : null;
    const priceEl = document.getElementById("itemPrice");
    const price = priceEl && priceEl.value ? parseFloat(priceEl.value) : null;

    const newItem = {
      id: uid(), name, category, qty, unit, threshold, expiry, barcode,
      staple, restockDays,
      lastRestocked: staple ? new Date().toISOString().slice(0, 10) : null,
      price: (price != null && !isNaN(price)) ? price : null
    };
    data.items.push(newItem);

    if (price != null && !isNaN(price) && price > 0) {
      state.costLog.push({ id: uid(), date: new Date().toISOString().slice(0, 10), amount: price, note: name });
    }

    logActivity("add", `Added "${name}"${qty ? " ×" + qty : ""} to ${escapeHtml(state.currentPantry)}`);

    // Storage location and category are left as-is (handy for adding several items of the
    // same kind in a row); everything else clears and goes back to needing your input.
    document.getElementById("itemName").value = "";
    document.getElementById("itemQty").value = "";
    document.getElementById("itemUnit").value = "";
    document.getElementById("itemThreshold").value = "";
    document.getElementById("itemExpiry").value = "";
    document.getElementById("itemBarcode").value = "";
    if (stapleEl) stapleEl.checked = false;
    if (restockDaysEl) restockDaysEl.value = "";
    if (priceEl) priceEl.value = "";

    saveState();
    renderAll();
  }
  document.getElementById("addItemBtn").addEventListener("click", addItem);

  // Takes an explicit location — Inventory cards can show items from any storage location at
  // once now, not just whichever one is picked in "Add an item".
  function removeItem(location, id) {
    const data = state.pantries[location];
    if (!data) return;
    const idx = data.items.findIndex(i => i.id === id);
    if (idx === -1) return;
    const removed = data.items[idx];
    data.items.splice(idx, 1);
    logActivity("remove", `Removed "${removed.name}" from ${escapeHtml(location)}`);
    saveState();
    renderAll();
    showUndoToast(`Removed "${removed.name}".`, () => {
      const pantry = state.pantries[location];
      if (pantry) {
        pantry.items.splice(Math.min(idx, pantry.items.length), 0, removed);
        logActivity("undo", `Restored "${removed.name}" to ${escapeHtml(location)}`);
        saveState();
        renderAll();
      }
    });
  }

  // Takes an explicit location rather than assuming "whichever one is currently selected" —
  // needed because Quick Count shows every location stacked at once, and this is called from
  // whichever location's card the tap happened in.
  function adjustQty(location, id, delta) {
    const data = state.pantries[location];
    if (!data) return;
    const item = data.items.find(i => i.id === id);
    if (!item) return;
    const before = parseFloat(item.qty) || 0;
    item.qty = Math.max(0, before + delta);
    if (delta > 0 && item.staple) item.lastRestocked = new Date().toISOString().slice(0, 10);
    if (delta < 0) logConsumption(item.name, before - item.qty, item.unit, "manual");
    saveState();
    renderAll();
  }

  function toggleStaple(location, id) {
    const data = state.pantries[location];
    if (!data) return;
    const item = data.items.find(i => i.id === id);
    if (!item) return;
    item.staple = !item.staple;
    if (item.staple) {
      if (!item.restockDays) item.restockDays = state.settings.defaultRestockDays;
      if (!item.lastRestocked) item.lastRestocked = new Date().toISOString().slice(0, 10);
    }
    saveState();
    renderAll();
  }

  // Takes an explicit location because staple-due items on the shopping list can belong to
  // any storage location, not just whichever one happens to be selected in the Inventory tab.
  function markRestocked(location, id) {
    const data = state.pantries[location];
    if (!data) return;
    const item = data.items.find(i => i.id === id);
    if (!item) return;
    item.lastRestocked = new Date().toISOString().slice(0, 10);
    saveState();
    renderShoppingList();
  }

  // "All" / "Low Stock" / "Expiring" / one chip per storage location. Not persisted — purely a
  // display filter, independent from which location "Add an item" is pointed at.
  let inventoryFilter = "all";

  function setInventoryFilter(key) {
    inventoryFilter = key;
    renderInventory();
  }

  function renderInventoryFilterChips() {
    const chipsWrap = document.getElementById("inventoryFilterChips");
    if (!chipsWrap) return;
    const chipDefs = [{ key: "all", label: "All" }, { key: "low", label: "Low Stock" }, { key: "expiring", label: "Expiring" }]
      .concat(Object.keys(state.pantries).map(loc => ({ key: loc, label: loc })));
    // A location that got deleted can't stay selected as a filter.
    if (inventoryFilter !== "all" && inventoryFilter !== "low" && inventoryFilter !== "expiring" && !state.pantries[inventoryFilter]) {
      inventoryFilter = "all";
    }
    chipsWrap.innerHTML = chipDefs.map(c => `<button type="button" class="filter-chip ${inventoryFilter === c.key ? "active" : ""}" onclick="pantryApp.setInventoryFilter('${escapeForInlineJs(c.key)}')">${escapeHtml(c.label)}</button>`).join("");
  }

  // Shows items across every storage location at once (filterable via the chips above), as
  // cards rather than a table — the same tap +/- used in Quick Count works right on each card.
  function renderInventory() {
    renderInventoryFilterChips();

    const wrap = document.getElementById("inventoryTableWrap");
    const subNote = document.getElementById("inventorySubNote");
    const search = (document.getElementById("searchInput").value || "").toLowerCase();

    let items = allItemsAcrossLocations();
    if (inventoryFilter === "low") {
      items = items.filter(i => (parseFloat(i.qty) || 0) <= (parseFloat(i.threshold) || 0));
    } else if (inventoryFilter === "expiring") {
      items = items.filter(i => { const d = daysUntil(i.expiry); return d !== null && d <= state.settings.expiringSoonDays; });
    } else if (inventoryFilter !== "all") {
      items = items.filter(i => i.__location === inventoryFilter);
    }
    if (search) items = items.filter(i => i.name.toLowerCase().includes(search));

    if (subNote) subNote.textContent = `Items expiring within ${state.settings.expiringSoonDays} day${state.settings.expiringSoonDays === 1 ? "" : "s"} or at/below their low-stock number are flagged. Showing ${items.length} item${items.length === 1 ? "" : "s"}.`;

    if (items.length === 0) {
      wrap.innerHTML = '<p class="empty-note">No items match this filter yet.</p>';
      return;
    }

    const byCategory = {};
    items.forEach(item => {
      if (!byCategory[item.category]) byCategory[item.category] = [];
      byCategory[item.category].push(item);
    });
    const cats = CATEGORIES_ORDER.filter(c => byCategory[c]).concat(Object.keys(byCategory).filter(c => !CATEGORIES_ORDER.includes(c)));

    wrap.innerHTML = cats.map(cat => `
      <div class="category-heading">${escapeHtml(cat)}</div>
      <div class="inv-card-grid">
        ${byCategory[cat].map(item => {
          const dLeft = daysUntil(item.expiry);
          const isExpiring = dLeft !== null && dLeft <= state.settings.expiringSoonDays;
          const isLow = (parseFloat(item.qty) || 0) <= (parseFloat(item.threshold) || 0);
          const statusClass = isExpiring ? "expiring" : isLow ? "low" : "good";
          const statusLabel = isExpiring ? (dLeft < 0 ? "Expired" : dLeft === 0 ? "Today" : dLeft + "d left") : isLow ? "Low" : "Good";
          const loc = item.__location;
          return `
            <div class="inv-card ${statusClass}">
              <div class="inv-card-top">
                <span class="inv-card-name">${escapeHtml(item.name)}${item.staple ? " ★" : ""}</span>
                <span class="pill ${statusClass === "good" ? "" : "warn"}">${statusLabel}</span>
              </div>
              <div class="inv-card-meta">${item.qty}${item.unit ? " " + escapeHtml(item.unit) : ""} · <span class="inv-card-loc">${escapeHtml(loc)}</span>${item.expiry ? " · exp " + escapeHtml(item.expiry) : ""}</div>
              <div class="quick-controls" style="margin-top:10px;">
                <button class="btn-icon" onclick="pantryApp.adjustQty('${escapeForInlineJs(loc)}', '${item.id}', -1)">−</button>
                <span class="count">${item.qty}</span>
                <button class="btn-icon" onclick="pantryApp.adjustQty('${escapeForInlineJs(loc)}', '${item.id}', 1)">+</button>
              </div>
              <div class="row" style="margin-top:8px;">
                <button class="btn-icon" title="Toggle staple / recurring restock reminder" onclick="pantryApp.toggleStaple('${escapeForInlineJs(loc)}', '${item.id}')">${item.staple ? "★" : "☆"}</button>
                <button class="btn-danger" onclick="pantryApp.removeItem('${escapeForInlineJs(loc)}', '${item.id}')">Remove</button>
              </div>
            </div>`;
        }).join("")}
      </div>
    `).join("");
  }

  document.getElementById("searchInput").addEventListener("input", renderInventory);

  // ---------------- Quick count ----------------
  // Shows every storage location stacked on top of each other (each with its own heading and
  // its own tap +/- grid), rather than only whichever one is picked in "Add an item" — so this
  // stays useful even before/without a location chosen there.
  function renderQuickCount() {
    const container = document.getElementById("quickGrid");
    const emptyNote = document.getElementById("quickEmptyNote");
    const locations = Object.keys(state.pantries);
    const nonEmptyLocations = locations.filter(loc => state.pantries[loc].items.length > 0);

    if (nonEmptyLocations.length === 0) {
      container.innerHTML = "";
      emptyNote.style.display = "";
      return;
    }
    emptyNote.style.display = "none";

    container.innerHTML = nonEmptyLocations.map(loc => {
      const items = state.pantries[loc].items;
      return `
        <div class="quick-location-group">
          <div class="category-heading">${escapeHtml(loc)}</div>
          <div class="quick-grid">
            ${items.map(item => `
              <div class="quick-item">
                <div class="name">${escapeHtml(item.name)}</div>
                <div class="cat">${escapeHtml(item.category)}${item.unit ? " · " + escapeHtml(item.unit) : ""}</div>
                <div class="quick-controls">
                  <button class="btn-icon" onclick="pantryApp.adjustQty('${escapeForInlineJs(loc)}', '${item.id}', -1)">−</button>
                  <span class="count">${item.qty}</span>
                  <button class="btn-icon" onclick="pantryApp.adjustQty('${escapeForInlineJs(loc)}', '${item.id}', 1)">+</button>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      `;
    }).join("");
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

  // A per-ingredient have/need breakdown plus an overall readiness percentage — the matching
  // system behind both the Recipes tab and the Dashboard's "What can I make?" preview.
  function recipeReadiness(recipe, have) {
    const statuses = (recipe.ingredients || []).map(ing => {
      const haveQty = Math.round((have[normName(ing.name)] || 0) * 100) / 100;
      const needQty = ing.qty || 0;
      let ok, missing;
      if (!needQty) {
        ok = haveQty > 0;
        missing = null; // recipe didn't specify an amount, so we can't say how much is short
      } else {
        ok = haveQty >= needQty - 0.0001;
        missing = ok ? 0 : Math.round((needQty - haveQty) * 100) / 100;
      }
      return { name: ing.name, unit: ing.unit, need: needQty, have: haveQty, ok, missing };
    });
    const total = statuses.length || 1;
    const readyCount = statuses.filter(s => s.ok).length;
    const percent = statuses.length ? Math.round((readyCount / total) * 100) : 0;
    return { recipe, percent, statuses, readyCount, total: statuses.length };
  }

  function renderCookNow() {
    const wrap = document.getElementById("cookNowWrap");
    if (!wrap) return;
    if (state.recipes.length === 0) {
      wrap.innerHTML = '<p class="empty-note">Add some recipes below, and we\'ll show how ready you are to make each one.</p>';
      return;
    }
    const have = haveMap();
    const ranked = state.recipes
      .filter(r => r.ingredients.length)
      .map(r => recipeReadiness(r, have))
      .sort((a, b) => b.percent - a.percent);

    wrap.innerHTML = ranked.map(({ recipe, percent, statuses }) => `
      <div class="readiness-card">
        <div class="readiness-head">
          <span class="readiness-name">${escapeHtml(recipe.name)}</span>
          <span class="readiness-pct ${percent === 100 ? "full" : percent >= 50 ? "mid" : "low"}">${percent}% ready</span>
        </div>
        <div class="readiness-bar"><div class="readiness-bar-fill" style="width:${percent}%;"></div></div>
        <ul class="readiness-ing-list">
          ${statuses.map(s => `
            <li class="${s.ok ? "ok" : "missing"}"><span class="dot"></span>${escapeHtml(s.name)}${s.ok ? " — have it" : (s.missing != null ? ` — need ${s.missing}${s.unit ? " " + escapeHtml(s.unit) : ""} more` : " — none on hand")}</li>
          `).join("")}
        </ul>
        <button class="btn-primary" style="margin-top:8px;" type="button" onclick="pantryApp.cookRecipeNow('${recipe.id}')">🍳 Make it</button>
      </div>
    `).join("");
  }

  // Finds saved recipes that use any of the given ingredient names (case-insensitive) — used to
  // surface "recipes using items expiring soon" on the Dashboard.
  function recipesUsingNames(names) {
    const keys = new Set(names.map(normName).filter(Boolean));
    if (keys.size === 0) return [];
    return state.recipes.filter(r => r.ingredients.some(ing => keys.has(normName(ing.name))));
  }

  // Subtracts a recipe's ingredients from pantry stock across all locations — shared by "Mark
  // cooked" (from a meal-plan slot) and "Make it" (cooking a recipe straight from the list).
  function subtractRecipeIngredients(recipe) {
    recipe.ingredients.forEach(ing => {
      let remaining = ing.qty || 0;
      if (remaining <= 0) return;
      let takenTotal = 0;
      Object.keys(state.pantries).forEach(loc => {
        if (remaining <= 0) return;
        state.pantries[loc].items.forEach(item => {
          if (remaining <= 0) return;
          if (normName(item.name) !== normName(ing.name)) return;
          const onHand = parseFloat(item.qty) || 0;
          const take = Math.min(remaining, onHand);
          item.qty = Math.max(0, onHand - take);
          remaining -= take;
          takenTotal += take;
        });
      });
      if (takenTotal > 0) logConsumption(ing.name, takenTotal, ing.unit, "cooked");
    });
  }

  function cookRecipeNow(id) {
    const recipe = state.recipes.find(r => r.id === id);
    if (!recipe) return;
    if (!confirm(`Mark "${recipe.name}" as cooked? This will subtract its ingredients from your pantry inventory.`)) return;
    subtractRecipeIngredients(recipe);
    logActivity("cooked", `Marked "${recipe.name}" as cooked (Make it)`);
    promptForLeftovers(recipe.name);
    saveState();
    renderAll();
    alert(`Nice! Subtracted "${recipe.name}"'s ingredients from your pantry.`);
  }

  // ---------------- Leftovers ----------------
  // A lightweight tracker for what's sitting in the fridge after cooking — separate from the
  // main pantry inventory since leftovers aren't bought/restocked the same way, just eaten
  // within a few days or tossed.
  function addLeftover(name, portions) {
    if (!name || !portions || portions <= 0) return;
    const shelfDays = (state.settings && state.settings.leftoverShelfLifeDays) || 4;
    const expires = new Date();
    expires.setHours(0, 0, 0, 0);
    expires.setDate(expires.getDate() + shelfDays);
    state.leftovers = state.leftovers || [];
    state.leftovers.push({
      id: uid(), name, portions,
      dateCooked: new Date().toISOString().slice(0, 10),
      expiresOn: expires.toISOString().slice(0, 10)
    });
  }

  function removeLeftover(id) {
    state.leftovers = (state.leftovers || []).filter(l => l.id !== id);
    saveState();
    renderAll();
  }

  function activeLeftovers() {
    return (state.leftovers || []).slice().sort((a, b) => (a.expiresOn || "").localeCompare(b.expiresOn || ""));
  }

  // After cooking, offer to save any leftover portions. Cancelling (or leaving it at 0) just
  // skips this silently — leftovers are optional, not every meal has any.
  function promptForLeftovers(recipeName) {
    const raw = prompt(`Any leftovers from "${recipeName}"? Enter how many portions (0 if none).`, "0");
    if (raw == null) return;
    const portions = parseFloat(raw);
    if (!portions || portions <= 0) return;
    addLeftover(recipeName, portions);
    logActivity("leftovers", `Saved ${portions} portion${portions === 1 ? "" : "s"} of "${recipeName}" as leftovers`);
  }

  function renderLeftovers() {
    const wrap = document.getElementById("dashboardLeftoversWrap");
    if (!wrap) return;
    const list = activeLeftovers();
    if (list.length === 0) {
      wrap.innerHTML = '<p class="empty-note">No leftovers being tracked right now — saving some after cooking will show up here.</p>';
      return;
    }
    wrap.innerHTML = list.map(lo => {
      const d = daysUntil(lo.expiresOn);
      const when = d == null ? "" : d < 0 ? "expired" : d === 0 ? "eat today" : d + "d left";
      return `
        <div class="shopping-item">
          <span class="label">🍱 ${escapeHtml(lo.name)}</span>
          <span class="footnote" style="margin:0 8px;">${lo.portions} portion${lo.portions === 1 ? "" : "s"}</span>
          <span class="pill ${d != null && d <= 1 ? "warn" : ""}">${when}</span>
          <button class="btn-danger" style="margin-left:auto;" onclick="pantryApp.removeLeftover('${lo.id}')">Used up</button>
        </div>`;
    }).join("");
  }

  // Leftovers about to expire (or already expired) — folded into the Dashboard's "Needs
  // attention" list right alongside pantry items so nothing about to go to waste is easy to miss.
  function urgentLeftovers() {
    return activeLeftovers().filter(lo => { const d = daysUntil(lo.expiresOn); return d !== null && d <= 1; });
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

  // offset in weeks relative to the current week (0 = this week) — used directly by the meal
  // plan's own week-navigation, and with a fixed 0 by the Dashboard's "This week" preview so it
  // always shows the current week regardless of whatever week the Meal plan tab is browsing.
  function getDatesForOffset(offset) {
    const monday = getMonday(new Date());
    monday.setDate(monday.getDate() + offset * 7);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  }

  function getWeekDates() {
    return getDatesForOffset(weekOffset);
  }

  function ensureMealSlot(dateKey) {
    if (!state.mealPlan[dateKey]) state.mealPlan[dateKey] = { breakfast: null, lunch: null, dinner: null };
    return state.mealPlan[dateKey];
  }

  // A meal-plan slot value is either a recipe id or "leftover:<id>" — this resolves either to
  // a display name, or null if it no longer points at anything (e.g. the leftover got eaten).
  function mealSlotLabel(value) {
    if (!value) return null;
    if (typeof value === "string" && value.indexOf("leftover:") === 0) {
      const lo = (state.leftovers || []).find(l => l.id === value.slice("leftover:".length));
      return lo ? "🍱 " + lo.name : null;
    }
    const r = state.recipes.find(r => r.id === value);
    return r ? r.name : null;
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

    const leftovers = activeLeftovers();

    days.forEach((d, idx) => {
      const key = formatDateKey(d);
      const slot = ensureMealSlot(key);
      html += `<tr><td class="daycell" data-label="Day">${DAY_NAMES[idx]} ${d.getDate()}</td>`;
      MEAL_SLOTS.forEach(s => {
        const value = slot[s];
        const isLeftover = typeof value === "string" && value.indexOf("leftover:") === 0;
        html += `<td data-label="${MEAL_SLOT_LABELS[s]}"><select onchange="pantryApp.setMeal('${key}','${s}', this.value)">
          <option value="">—</option>
          <optgroup label="Recipes">
            ${state.recipes.map(r => `<option value="${r.id}" ${value === r.id ? "selected" : ""}>${escapeHtml(r.name)}</option>`).join("")}
          </optgroup>
          ${leftovers.length ? `<optgroup label="Leftovers">
            ${leftovers.map(lo => `<option value="leftover:${lo.id}" ${value === "leftover:" + lo.id ? "selected" : ""}>🍱 ${escapeHtml(lo.name)}</option>`).join("")}
          </optgroup>` : ""}
        </select>
        ${isLeftover ? `<button class="btn-icon" style="margin-top:4px; font-size:0.75rem;" onclick="pantryApp.eatLeftoverFromSlot('${key}','${s}')">🍽️ Ate it</button>`
          : value ? `<button class="btn-icon" style="margin-top:4px; font-size:0.75rem;" onclick="pantryApp.markRecipeCooked('${key}','${s}')">✓ Cooked</button>` : ""}
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

  // Removes the leftover entry and clears it from this slot — the "Ate it" action for a
  // leftover-assigned meal, parallel to "✓ Cooked" for a recipe-assigned one.
  function eatLeftoverFromSlot(dateKey, slot) {
    const s = ensureMealSlot(dateKey);
    const value = s[slot];
    if (typeof value !== "string" || value.indexOf("leftover:") !== 0) return;
    const id = value.slice("leftover:".length);
    const lo = (state.leftovers || []).find(l => l.id === id);
    state.leftovers = (state.leftovers || []).filter(l => l.id !== id);
    s[slot] = null;
    logActivity("leftover-eaten", `Ate leftover "${lo ? lo.name : "?"}" (${MEAL_SLOT_LABELS[slot]}, ${dateKey})`);
    saveState();
    renderAll();
  }

  // Fills any empty slots this week with your most-ready-to-cook recipes, cycling through the
  // top few so the week isn't just one recipe repeated — never overwrites a slot you already set.
  function autoFillWeek() {
    if (state.recipes.length === 0) { alert("Add a recipe first, then auto-fill can pick from them."); return; }
    const have = haveMap();
    const ranked = state.recipes.filter(r => r.ingredients.length).map(r => recipeReadiness(r, have)).sort((a, b) => b.percent - a.percent);
    const pool = (ranked.length ? ranked : state.recipes.map(r => ({ recipe: r }))).slice(0, Math.min(5, Math.max(1, ranked.length || state.recipes.length))).map(r => r.recipe);
    const days = getWeekDates();
    let filled = 0, poolIdx = 0;
    days.forEach(d => {
      const key = formatDateKey(d);
      const slot = ensureMealSlot(key);
      MEAL_SLOTS.forEach(s => {
        if (slot[s]) return;
        slot[s] = pool[poolIdx % pool.length].id;
        poolIdx++;
        filled++;
      });
    });
    if (filled === 0) { alert("This week's already fully planned!"); return; }
    logActivity("mealplan-autofill", `Auto-filled ${filled} empty meal slot${filled === 1 ? "" : "s"} for the week of ${formatDateKey(days[0])}`);
    saveState();
    renderMealPlan();
    alert(`Filled in ${filled} empty meal slot${filled === 1 ? "" : "s"} using your most-ready recipes.`);
  }
  const autoFillWeekBtn = document.getElementById("autoFillWeekBtn");
  if (autoFillWeekBtn) autoFillWeekBtn.addEventListener("click", autoFillWeek);

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

    subtractRecipeIngredients(recipe);

    logActivity("cooked", `Marked "${recipe.name}" as cooked (${MEAL_SLOT_LABELS[slot]}, ${dateKey})`);
    promptForLeftovers(recipe.name);
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
        const days = parseFloat(item.restockDays) || state.settings.defaultRestockDays;
        const last = item.lastRestocked ? new Date(item.lastRestocked + "T00:00:00") : null;
        const dueDate = last ? new Date(last.getTime() + days * 86400000) : today;
        if (dueDate <= today) out.push({ location: loc, item });
      });
    });
    return out;
  }

  // Every item expiring within the configured window, across every storage location, soonest
  // first — the "Use First" list on the Dashboard.
  function expiringSoonAcrossLocations() {
    const out = [];
    Object.keys(state.pantries).forEach(loc => {
      state.pantries[loc].items.forEach(item => {
        const d = daysUntil(item.expiry);
        if (d !== null && d <= state.settings.expiringSoonDays) out.push({ location: loc, item, daysLeft: d });
      });
    });
    out.sort((a, b) => a.daysLeft - b.daysLeft);
    return out;
  }

  // Same dedup rules used when rendering/printing/copying the shopping list, just as a count —
  // used by the Dashboard's shopping-list preview.
  function shoppingListCount() {
    const low = lowStockItems();
    const staples = stapleDueItems().filter(({ item }) => !low.some(l => l.item.id === item.id));
    const extras = (state.shoppingExtras || []).filter(e => !e.checked);
    return low.length + staples.length + extras.length;
  }

  // Suggested buy quantity based on the last 4 weeks of actual usage (see weeklyUsageRate) —
  // falls back to 1 when there's not enough history yet.
  function suggestedBuyQty(name) {
    return Math.max(1, Math.round(weeklyUsageRate(name)) || 1);
  }

  function estimatedCost(item, qty) {
    return (item && item.price != null && !isNaN(item.price)) ? item.price * qty : null;
  }

  // Splits the shopping-worthy items into priority buckets instead of just "low stock" — must
  // buy (completely out), running low (some left but at/under threshold), and staple reminders
  // (due for a restock regardless of count). Shared by the render, copy, and print paths so
  // they can't drift out of sync with each other.
  function shoppingSections() {
    const low = lowStockItems();
    const mustBuy = low.filter(({ item }) => (parseFloat(item.qty) || 0) <= 0);
    const runningLow = low.filter(({ item }) => (parseFloat(item.qty) || 0) > 0);
    const staples = stapleDueItems().filter(({ item }) => !low.some(l => l.item.id === item.id));
    return { mustBuy, runningLow, staples };
  }

  function renderShoppingList() {
    const wrap = document.getElementById("shoppingListWrap");
    const totalsWrap = document.getElementById("shoppingTotalsWrap");
    const { mustBuy, runningLow, staples } = shoppingSections();
    const extras = state.shoppingExtras || [];

    if (mustBuy.length === 0 && runningLow.length === 0 && staples.length === 0 && extras.length === 0) {
      wrap.innerHTML = '<p class="empty-note">Nothing needed right now. Low-stock pantry items and meal-plan needs will show up here automatically.</p>';
      if (totalsWrap) totalsWrap.innerHTML = "";
      return;
    }

    let grandTotal = 0, anyPriced = false;

    function trackedRow(location, item, badgeText, badgeClass) {
      const key = "lowstock:" + location + ":" + item.id;
      const checked = !!state.shoppingAutoChecked[key];
      const qty = suggestedBuyQty(item.name);
      const cost = estimatedCost(item, qty);
      if (cost != null) { grandTotal += cost; anyPriced = true; }
      return `
        <div class="shopping-item ${checked ? "checked" : ""}">
          <input type="checkbox" ${checked ? "checked" : ""} onchange="pantryApp.toggleAutoChecked('${key}')">
          <span class="label">${escapeHtml(item.name)}${item.unit ? " (" + escapeHtml(item.unit) + ")" : ""}</span>
          <span class="pill ${badgeClass}">${badgeText} · ${escapeHtml(location)}</span>
          <span class="footnote" style="margin:0 0 0 8px; white-space:nowrap;">buy ~${qty}${cost != null ? " · $" + cost.toFixed(2) : ""}</span>
        </div>`;
    }

    const mustBuyRows = mustBuy.map(({ location, item }) => trackedRow(location, item, "out of stock", "warn"));
    const runningLowRows = runningLow.map(({ location, item }) => trackedRow(location, item, "running low", "amber"));
    const stapleRows = staples.map(({ location, item }) => {
      const qty = suggestedBuyQty(item.name);
      const cost = estimatedCost(item, qty);
      if (cost != null) { grandTotal += cost; anyPriced = true; }
      return `
        <div class="shopping-item">
          <span class="label">${escapeHtml(item.name)}${item.unit ? " (" + escapeHtml(item.unit) + ")" : ""}</span>
          <span class="pill amber">restock reminder · ${escapeHtml(location)}</span>
          <span class="footnote" style="margin:0 0 0 8px; white-space:nowrap;">${cost != null ? "~$" + cost.toFixed(2) : ""}</span>
          <button class="btn-secondary" style="margin-left:auto;" onclick="pantryApp.markRestocked('${escapeForInlineJs(location)}', '${item.id}')">Mark restocked</button>
        </div>`;
    });
    const extraRows = extras.map(ex => `
      <div class="shopping-item ${ex.checked ? "checked" : ""}">
        <input type="checkbox" ${ex.checked ? "checked" : ""} onchange="pantryApp.toggleExtraChecked('${ex.id}')">
        <span class="label">${escapeHtml(ex.label)}${ex.qty ? " — need " + ex.qty : ""}</span>
        ${ex.source === "mealplan" ? '<span class="pill amber">from meal plan</span>' : ""}
        <button class="btn-danger" style="margin-left:auto;" onclick="pantryApp.removeExtra('${ex.id}')">Remove</button>
      </div>`);

    function section(title, icon, rows) {
      if (rows.length === 0) return "";
      return `<div class="shopping-section-heading">${icon} ${title} <span class="pill">${rows.length}</span></div>${rows.join("")}`;
    }

    wrap.innerHTML =
      section("Must buy", "🔴", mustBuyRows) +
      section("Running low", "🟡", runningLowRows) +
      section("Staple reminders", "🔁", stapleRows) +
      section("Added by you", "➕", extraRows);

    if (totalsWrap) totalsWrap.innerHTML = anyPriced ? `<span class="pill amber">Estimated total: $${grandTotal.toFixed(2)}</span>` : "";
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
    const { mustBuy, runningLow, staples } = shoppingSections();
    const uncheckedMustBuy = mustBuy.filter(({ location, item }) => !state.shoppingAutoChecked["lowstock:" + location + ":" + item.id]);
    const uncheckedRunningLow = runningLow.filter(({ location, item }) => !state.shoppingAutoChecked["lowstock:" + location + ":" + item.id]);
    const extras = (state.shoppingExtras || []).filter(e => !e.checked);
    let total = 0, anyPriced = false;
    function fmt(item) {
      const qty = suggestedBuyQty(item.name);
      const cost = estimatedCost(item, qty);
      if (cost != null) { total += cost; anyPriced = true; }
      return `- ${item.name}${item.unit ? " (" + item.unit + ")" : ""} — buy ~${qty}${cost != null ? ` ($${cost.toFixed(2)})` : ""}`;
    }
    const lines = [
      ...uncheckedMustBuy.map(({ item }) => fmt(item) + " [must buy]"),
      ...uncheckedRunningLow.map(({ item }) => fmt(item) + " [running low]"),
      ...staples.map(({ item }) => fmt(item) + " [staple restock]"),
      ...extras.map(e => `- ${e.label}${e.qty ? " — need " + e.qty : ""}`)
    ];
    if (lines.length === 0) { alert("Your shopping list is empty."); return; }
    if (anyPriced) lines.push(`\nEstimated total: $${total.toFixed(2)}`);
    const text = lines.join("\n");
    navigator.clipboard.writeText(text).then(() => {
      alert("Shopping list copied to clipboard.");
    }).catch(() => {
      alert(text);
    });
  });

  document.getElementById("printListBtn").addEventListener("click", () => {
    const { mustBuy, runningLow, staples } = shoppingSections();
    const extras = (state.shoppingExtras || []).filter(e => !e.checked);

    if (mustBuy.length === 0 && runningLow.length === 0 && staples.length === 0 && extras.length === 0) {
      alert("Your shopping list is empty — nothing to print.");
      return;
    }

    let total = 0, anyPriced = false;
    function line(location, item, tag) {
      const qty = suggestedBuyQty(item.name);
      const cost = estimatedCost(item, qty);
      if (cost != null) { total += cost; anyPriced = true; }
      return `${escapeHtml(item.name)}${item.unit ? " (" + escapeHtml(item.unit) + ")" : ""} — ${escapeHtml(location)}, buy ~${qty}${cost != null ? ` ($${cost.toFixed(2)})` : ""}${tag ? " — " + tag : ""}`;
    }

    const sections = [
      { title: "Must buy", lines: mustBuy.map(({ location, item }) => line(location, item)) },
      { title: "Running low", lines: runningLow.map(({ location, item }) => line(location, item)) },
      { title: "Staple reminders", lines: staples.map(({ location, item }) => line(location, item, "restock reminder")) },
      { title: "Added by you", lines: extras.map(ex => `${escapeHtml(ex.label)}${ex.qty ? " — need " + escapeHtml(String(ex.qty)) : ""}`) }
    ].filter(s => s.lines.length);

    const dateStr = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

    const printArea = document.getElementById("printArea");
    printArea.innerHTML = `
      <h1>🥫 Shopping List</h1>
      <p style="color:#555; margin:0 0 12px;">${dateStr}</p>
      ${sections.map(s => `
        <h3>${escapeHtml(s.title)}</h3>
        <ul>
          ${s.lines.map(l => `<li>&#9744; ${l}</li>`).join("")}
        </ul>
      `).join("")}
      ${anyPriced ? `<p><strong>Estimated total: $${total.toFixed(2)}</strong></p>` : ""}
    `;

    window.print();
  });

  function categoryBlocksHtml(items) {
    const byCategory = {};
    items.forEach(item => {
      const cat = item.category || "Other";
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(item);
    });
    const cats = CATEGORIES_ORDER.filter(c => byCategory[c]).concat(Object.keys(byCategory).filter(c => !CATEGORIES_ORDER.includes(c)));
    return cats.map(cat => `
      <h3>${escapeHtml(cat)}</h3>
      <ul>
        ${byCategory[cat].map(item => {
          const qtyText = `${item.qty}${item.unit ? " " + escapeHtml(item.unit) : ""}`;
          const expText = item.expiry ? " — exp " + escapeHtml(item.expiry) : "";
          const stapleText = item.staple ? " (staple)" : "";
          return `<li>${escapeHtml(item.name)} — ${qtyText}${expText}${stapleText}</li>`;
        }).join("")}
      </ul>
    `).join("");
  }

  const printInventoryBtn = document.getElementById("printInventoryBtn");
  if (printInventoryBtn) printInventoryBtn.addEventListener("click", () => {
    const scopeSel = document.getElementById("printInventoryScope");
    const scope = scopeSel ? scopeSel.value : "__all";
    const dateStr = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    const printArea = document.getElementById("printArea");

    if (scope === "__all") {
      const locations = Object.keys(state.pantries);
      const nonEmpty = locations.filter(loc => state.pantries[loc].items.length > 0);
      if (nonEmpty.length === 0) { alert("There's nothing in any storage location to print."); return; }
      printArea.innerHTML = `
        <h1>🥫 Whole Inventory</h1>
        <p style="color:#555; margin:0 0 12px;">${dateStr}</p>
        ${nonEmpty.map(loc => `
          <h2>${escapeHtml(loc)}</h2>
          ${categoryBlocksHtml(state.pantries[loc].items)}
        `).join("")}
      `;
    } else {
      const data = state.pantries[scope];
      if (!data || data.items.length === 0) { alert(`No items in "${scope}" to print.`); return; }
      printArea.innerHTML = `
        <h1>🥫 ${escapeHtml(scope)} — Inventory</h1>
        <p style="color:#555; margin:0 0 12px;">${dateStr}</p>
        ${categoryBlocksHtml(data.items)}
      `;
    }

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

  // ---------------- Settings / preferences ----------------
  function applyDefaultsToItemForm() {
    // These show as hints, not pre-filled values — low-stock and item quantity now have to be
    // typed in before an item can be added (see validateAddItemForm).
    const thresholdEl = document.getElementById("itemThreshold");
    if (thresholdEl) thresholdEl.placeholder = String(state.settings.defaultLowStock);
    const restockDaysEl = document.getElementById("itemRestockDays");
    if (restockDaysEl) restockDaysEl.placeholder = String(state.settings.defaultRestockDays);
  }

  function renderSettingsForm() {
    const daysEl = document.getElementById("settingExpiringSoonDays");
    const lowStockEl = document.getElementById("settingDefaultLowStock");
    const restockEl = document.getElementById("settingDefaultRestockDays");
    const leftoverEl = document.getElementById("settingLeftoverShelfLifeDays");
    const darkEl = document.getElementById("settingDarkTheme");
    if (!daysEl || !lowStockEl || !restockEl) return;
    // Don't clobber values while someone's actively editing the form (e.g. a sync landed mid-edit).
    if (document.activeElement === daysEl || document.activeElement === lowStockEl || document.activeElement === restockEl || document.activeElement === leftoverEl) return;
    daysEl.value = String(state.settings.expiringSoonDays);
    lowStockEl.value = String(state.settings.defaultLowStock);
    restockEl.value = String(state.settings.defaultRestockDays);
    if (leftoverEl) leftoverEl.value = String(state.settings.leftoverShelfLifeDays);
    if (darkEl) darkEl.checked = !!state.settings.darkTheme;
  }

  const saveSettingsBtn = document.getElementById("saveSettingsBtn");
  if (saveSettingsBtn) saveSettingsBtn.addEventListener("click", () => {
    const days = parseFloat(document.getElementById("settingExpiringSoonDays").value);
    const lowStock = parseFloat(document.getElementById("settingDefaultLowStock").value);
    const restock = parseFloat(document.getElementById("settingDefaultRestockDays").value);
    const leftoverEl = document.getElementById("settingLeftoverShelfLifeDays");
    const leftoverDays = leftoverEl ? parseFloat(leftoverEl.value) : state.settings.leftoverShelfLifeDays;
    if (!days || days < 1) { alert("\"Flag items expiring within\" needs to be at least 1 day."); return; }
    if (lowStock == null || isNaN(lowStock) || lowStock < 0) { alert("Default low-stock number needs to be 0 or more."); return; }
    if (!restock || restock < 1) { alert("Default staple restock interval needs to be at least 1 day."); return; }
    if (!leftoverDays || leftoverDays < 1) { alert("Leftover shelf life needs to be at least 1 day."); return; }

    state.settings = { expiringSoonDays: days, defaultLowStock: lowStock, defaultRestockDays: restock, darkTheme: !!state.settings.darkTheme, leftoverShelfLifeDays: leftoverDays };
    logActivity("settings", `Updated preferences (expiring-soon: ${days}d, default low-stock: ${lowStock}, default restock: ${restock}d, leftover shelf life: ${leftoverDays}d)`);
    saveState();
    applyDefaultsToItemForm();
    renderInventory();
    renderShoppingList();
    alert("Preferences saved.");
  });

  // The dark-theme toggle applies (and syncs) immediately — it's a cosmetic on/off switch with
  // nothing to validate, unlike the numeric preferences above which need the Save button.
  const settingDarkThemeEl = document.getElementById("settingDarkTheme");
  if (settingDarkThemeEl) settingDarkThemeEl.addEventListener("change", e => {
    state.settings.darkTheme = e.target.checked;
    applyTheme();
    saveState();
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

  function hideScanConfirm() {
    const wrap = document.getElementById("scanConfirmWrap");
    if (wrap) { wrap.style.display = "none"; wrap.innerHTML = ""; }
    const reader = document.getElementById("qrReader");
    if (reader) reader.style.display = "";
  }

  function openScanModal() {
    if (typeof Html5Qrcode === "undefined") {
      alert("The barcode scanner couldn't load (no internet connection?). You can still add items by typing them in.");
      return;
    }
    document.getElementById("scanModal").style.display = "flex";
    hideScanConfirm();
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

  // Stops the camera but leaves the modal open — used to pause while a confirm card is shown,
  // as opposed to closeScanModal() which also hides the modal entirely.
  function pauseScanner() {
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

  function closeScanModal() {
    document.getElementById("scanModal").style.display = "none";
    pauseScanner();
    hideScanConfirm();
  }

  // Scan → identify → confirm: nothing is added or incremented until you explicitly confirm it
  // here, rather than the scan silently mutating your pantry the instant a barcode decodes.
  function showScanConfirm(html, wireUp) {
    pauseScanner();
    const reader = document.getElementById("qrReader");
    if (reader) reader.style.display = "none";
    const wrap = document.getElementById("scanConfirmWrap");
    if (!wrap) return;
    wrap.style.display = "";
    wrap.innerHTML = html;
    const cancelBtn = document.getElementById("scanConfirmCancelBtn");
    if (cancelBtn) cancelBtn.addEventListener("click", closeScanModal);
    if (wireUp) wireUp();
  }

  function handleScannedBarcode(code) {
    // 1) If this barcode is already tracked in the current location, confirm before bumping it.
    const data = currentPantryData();
    if (!data) {
      closeScanModal();
      alert("Choose a storage location in \"Add an item\" first, then scan again.");
      return;
    }
    const existing = data.items.find(i => i.barcode === code);
    if (existing) {
      showScanConfirm(`
        <p class="sub" style="margin-top:0;">Already in your pantry</p>
        <div style="font-weight:700; font-size:1.05rem;">${escapeHtml(existing.name)}</div>
        <div class="footnote">Current quantity: ${existing.qty}${existing.unit ? " " + escapeHtml(existing.unit) : ""} in ${escapeHtml(state.currentPantry)}</div>
        <div class="row" style="margin-top:14px;">
          <button class="btn-primary" type="button" id="scanConfirmActionBtn">+1</button>
          <button class="btn-secondary" type="button" id="scanConfirmCancelBtn">Cancel</button>
        </div>
      `, () => {
        document.getElementById("scanConfirmActionBtn").addEventListener("click", () => {
          existing.qty = (parseFloat(existing.qty) || 0) + 1;
          if (existing.staple) existing.lastRestocked = new Date().toISOString().slice(0, 10);
          logActivity("scan", `Scanned "${existing.name}" — quantity is now ${existing.qty}`);
          saveState();
          renderAll();
          closeScanModal();
        });
      });
      return;
    }

    // 2) New barcode: look it up, show what we found, and only hand off to the Add Item form
    // (for final review) once you say to.
    setScanStatus("Looking up barcode " + code + "…", false);
    fetch(OFF_LOOKUP_URL + encodeURIComponent(code) + ".json")
      .then(r => r.json())
      .then(result => {
        if (result && result.status === 1 && result.product) {
          const p = result.product;
          const rawName = p.product_name || p.generic_name || "";
          const name = rawName ? (p.brands ? `${rawName} (${p.brands})` : rawName) : "";
          showNewItemScanConfirm(code, name, guessCategoryFromTags(p.categories_tags));
        } else {
          showNewItemScanConfirm(code, "", null);
        }
      })
      .catch(() => showNewItemScanConfirm(code, "", null));
  }

  function showNewItemScanConfirm(code, name, category) {
    showScanConfirm(`
      <p class="sub" style="margin-top:0;">New item — not in your pantry yet</p>
      <div style="font-weight:700; font-size:1.05rem;">${name ? escapeHtml(name) : "Not found online"}</div>
      ${category ? `<div class="footnote">Guessed aisle: ${escapeHtml(category)}</div>` : ""}
      <div class="footnote">Barcode: ${escapeHtml(code)}</div>
      <div class="row" style="margin-top:14px;">
        <button class="btn-primary" type="button" id="scanConfirmActionBtn">Use this — fill in the form</button>
        <button class="btn-secondary" type="button" id="scanConfirmCancelBtn">Cancel</button>
      </div>
    `, () => {
      document.getElementById("scanConfirmActionBtn").addEventListener("click", () => {
        document.getElementById("itemBarcode").value = code;
        document.getElementById("itemName").value = name;
        if (category) document.getElementById("itemCategory").value = category;
        closeScanModal();
        validateAddItemForm();
        document.getElementById("itemName").focus();
        flashSaveStatus(name ? `"${name}" ready to review — check the details and click Add item.` : `Barcode ${code} scanned — enter the name and click Add item.`);
      });
    });
  }

  document.getElementById("scanBtn").addEventListener("click", openScanModal);
  document.getElementById("closeScanBtn").addEventListener("click", closeScanModal);

  // ---------------- Receipt scanning ----------------
  // Reads a photographed/uploaded receipt entirely in the browser (via Tesseract.js OCR — no
  // server involved) and picks out item/price lines and a total with a simple heuristic. Receipt
  // formats vary too much to parse perfectly, so this always shows an editable review list —
  // nothing gets added to your inventory or spending log without you checking it first.
  function setReceiptStatus(msg, isError) {
    const el = document.getElementById("receiptStatusMsg");
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle("scan-error", !!isError);
  }

  function openReceiptModal() {
    document.getElementById("receiptModal").style.display = "flex";
    document.getElementById("receiptReviewWrap").innerHTML = "";
    document.getElementById("receiptFileInput").value = "";
    setReceiptStatus("Take a photo of your receipt, or choose one from your library. This runs entirely in your browser — nothing is uploaded anywhere.", false);
  }

  function closeReceiptModal() {
    document.getElementById("receiptModal").style.display = "none";
  }

  function titleCaseWords(s) {
    return s.replace(/\s+/g, " ").trim().split(" ").map(w =>
      w.length > 2 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toUpperCase()
    ).join(" ");
  }

  // Looks for lines ending in a price (e.g. "GROUND BEEF 2LB   7.98"). Lines mentioning
  // tax/subtotal/payment are skipped as non-purchasable; lines mentioning "total" are treated
  // as candidates for the receipt's grand total instead of a line item.
  function parseReceiptLines(text) {
    const lines = (text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    // Allows an optional single trailing letter after the price (many US receipts append a
    // tax-code flag like "F" for food-exempt or "T" for taxable, e.g. "BREAD  2.99 F").
    const priceRe = /\$?\s*(\d{1,4}\.\d{2})\s*[A-Za-z]?\s*$/;
    const totalKeywordRe = /\b(total|balance due|amount due|grand total)\b/i;
    const skipKeywordRe = /\b(subtotal|sub total|tax|change|cash|credit|debit|visa|mastercard|amex|card|tender|discount|savings|coupon)\b/i;

    const items = [];
    let total = null;

    lines.forEach(line => {
      const m = line.match(priceRe);
      if (!m) return;
      const price = parseFloat(m[1]);
      if (isNaN(price) || price <= 0) return;

      if (totalKeywordRe.test(line)) {
        if (!skipKeywordRe.test(line) || /grand total/i.test(line)) {
          if (total === null || price > total) total = price;
        }
        return;
      }
      if (skipKeywordRe.test(line)) return;

      const namePart = line.slice(0, m.index).replace(/[.\-\s]+$/, "").trim();
      if (!namePart || namePart.replace(/[^a-zA-Z]/g, "").length < 2) return;

      items.push({ name: titleCaseWords(namePart), price });
    });

    return { items, total };
  }

  function renderReceiptReview(items, total) {
    const wrap = document.getElementById("receiptReviewWrap");
    if (!wrap) return;

    if (items.length === 0 && total == null) {
      wrap.innerHTML = '<p class="empty-note">Couldn\'t make out any items or a total on that photo. Try a clearer, well-lit shot — or just log the total by hand above.</p>';
      return;
    }

    let html = "";
    if (items.length) {
      html += '<p class="sub" style="margin-top:0;">Check the items you want added to your inventory (qty 1 each, aisle "Other" by default) — edit the name or price first if needed.</p>';
      html += '<div id="receiptItemRows">';
      items.forEach((it, i) => {
        html += `
          <div class="row" style="margin-bottom:6px; flex-wrap:nowrap;" data-idx="${i}">
            <input type="checkbox" class="receipt-item-check" checked style="width:auto;">
            <input type="text" class="receipt-item-name" value="${escapeHtml(it.name)}" style="flex:1; min-width:0;">
            <input type="number" class="receipt-item-price" value="${it.price}" min="0" step="0.01" style="width:80px;">
          </div>
        `;
      });
      html += "</div>";
      html += '<button class="btn-primary" type="button" id="addReceiptItemsBtn" style="margin-top:8px;">Add checked items to inventory</button>';
    }

    if (total != null) {
      html += `
        <div class="row" style="margin-top:16px; align-items:center;">
          <label class="field">Receipt total
            <input type="number" id="receiptTotalInput" min="0" step="0.01" value="${total}" style="width:100px;">
          </label>
          <button class="btn-secondary" type="button" id="logReceiptTotalBtn" style="margin-top:20px;">Log total to spending</button>
        </div>
      `;
    }

    wrap.innerHTML = html;

    const addBtn = document.getElementById("addReceiptItemsBtn");
    if (addBtn) addBtn.addEventListener("click", () => {
      const data = currentPantryData();
      if (!data) { alert("Choose a storage location in \"Add an item\" first, then add these items."); return; }
      const rows = document.querySelectorAll("#receiptItemRows .row");
      let count = 0;
      rows.forEach(row => {
        if (!row.querySelector(".receipt-item-check").checked) return;
        const name = row.querySelector(".receipt-item-name").value.trim();
        const price = parseFloat(row.querySelector(".receipt-item-price").value) || 0;
        if (!name) return;
        data.items.push({
          id: uid(), name, category: "Other", qty: 1, unit: "", threshold: 1, expiry: "",
          barcode: null, staple: false, restockDays: null, lastRestocked: null,
          price: price || null
        });
        if (price > 0) state.costLog.push({ id: uid(), date: new Date().toISOString().slice(0, 10), amount: price, note: name });
        count++;
      });
      if (count === 0) { alert("No items checked."); return; }
      logActivity("receipt-scan", `Added ${count} item${count === 1 ? "" : "s"} from a scanned receipt to ${escapeHtml(state.currentPantry)}`);
      saveState();
      renderAll();
      closeReceiptModal();
      alert(`Added ${count} item${count === 1 ? "" : "s"} to ${state.currentPantry}.`);
    });

    const logTotalBtn = document.getElementById("logReceiptTotalBtn");
    if (logTotalBtn) logTotalBtn.addEventListener("click", () => {
      const amount = parseFloat(document.getElementById("receiptTotalInput").value);
      if (!amount || amount <= 0) { alert("Enter a valid total."); return; }
      state.costLog.push({ id: uid(), date: new Date().toISOString().slice(0, 10), amount, note: "Receipt scan" });
      logActivity("spending", `Logged $${amount.toFixed(2)} from a scanned receipt`);
      saveState();
      renderSpending();
      closeReceiptModal();
      alert(`Logged $${amount.toFixed(2)} to spending.`);
    });
  }

  function handleReceiptFile(file) {
    if (!file) return;
    if (typeof Tesseract === "undefined") {
      setReceiptStatus("The receipt reader couldn't load (no internet connection?). You can still log a total by hand on the Spending tab.", true);
      return;
    }
    setReceiptStatus("Reading receipt… this can take up to 30 seconds, especially the first time.", false);
    document.getElementById("receiptReviewWrap").innerHTML = "";

    Tesseract.recognize(file, "eng")
      .then(({ data }) => {
        const { items, total } = parseReceiptLines(data && data.text);
        setReceiptStatus(
          items.length || total != null
            ? "Here's what we could read — check it over before adding anything."
            : "Couldn't make out much on that photo.",
          false
        );
        renderReceiptReview(items, total);
      })
      .catch(err => {
        setReceiptStatus("Couldn't read that image: " + (err && err.message ? err.message : err), true);
      });
  }

  const scanReceiptBtn = document.getElementById("scanReceiptBtn");
  if (scanReceiptBtn) scanReceiptBtn.addEventListener("click", openReceiptModal);
  const closeReceiptBtn = document.getElementById("closeReceiptBtn");
  if (closeReceiptBtn) closeReceiptBtn.addEventListener("click", closeReceiptModal);
  const receiptFileInput = document.getElementById("receiptFileInput");
  if (receiptFileInput) receiptFileInput.addEventListener("change", e => handleReceiptFile(e.target.files[0]));

  // ---------------- Recipe upload / OCR autofill ----------------
  // Reads a photographed/uploaded recipe with the same on-device OCR used for receipts, then
  // fills in the "Add a recipe" form directly — that form already serves as the review step,
  // so there's no separate checklist; just double-check what landed before saving.
  const RECIPE_UNIT_WORDS = [
    "cups", "cup", "tablespoons", "tablespoon", "tbsp", "teaspoons", "teaspoon", "tsp",
    "ounces", "ounce", "oz", "pounds", "pound", "lbs", "lb", "grams", "gram", "g",
    "kilograms", "kilogram", "kg", "milliliters", "milliliter", "ml", "liters", "liter", "l",
    "cans", "can", "cloves", "clove", "slices", "slice", "pinches", "pinch", "dashes", "dash",
    "packages", "package", "pkg", "sticks", "stick", "boxes", "box", "bunches", "bunch",
    "heads", "head", "stalks", "stalk"
  ];

  function fractionToDecimal(raw) {
    const s = (raw == null ? "" : String(raw)).trim();
    if (!s) return null;
    const mixed = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
    if (mixed) {
      const whole = parseFloat(mixed[1]), num = parseFloat(mixed[2]), den = parseFloat(mixed[3]);
      return den ? whole + num / den : whole;
    }
    const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (frac) {
      const num = parseFloat(frac[1]), den = parseFloat(frac[2]);
      return den ? num / den : null;
    }
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  // Parses one ingredient line, e.g. "1 1/2 cups Chopped onion" -> {name, qty, unit}.
  function parseIngredientLine(rawLine) {
    const line = (rawLine || "").replace(/^[-*••●‣]+\s*/, "").trim();
    if (!line) return null;

    let rest = line;
    let qty = null;
    const qtyMatch = rest.match(/^(\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:\.\d+)?)\s*/);
    if (qtyMatch) {
      qty = fractionToDecimal(qtyMatch[1]);
      rest = rest.slice(qtyMatch[0].length).trim();
    }

    let unit = "";
    const unitRe = new RegExp("^(" + RECIPE_UNIT_WORDS.join("|") + ")\\.?\\s+", "i");
    const unitMatch = rest.match(unitRe);
    if (unitMatch) {
      unit = unitMatch[1].toLowerCase();
      rest = rest.slice(unitMatch[0].length).trim();
    }
    rest = rest.replace(/^of\s+/i, "").trim();

    const name = rest ? titleCaseWords(rest) : titleCaseWords(line);
    if (!name || name.replace(/[^a-zA-Z]/g, "").length < 2) return null;
    return { name, qty, unit };
  }

  // Best-effort split of freeform OCR text into a name, servings, ingredient lines, and notes.
  // Recipe layouts vary a lot from card to card and site to site, so this is a first draft only
  // — nothing is saved until you review and click "Save recipe" yourself.
  function parseRecipeText(text) {
    const rawLines = (text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (rawLines.length === 0) return { name: "", servings: null, ingredients: [], notes: "" };

    const ingredientsHeaderRe = /^ingredients\b/i;
    const instructionsHeaderRe = /^(instructions|directions|method|steps|preparation)\b/i;
    const servingsRe = /(\d+)\s*(?:servings?|people)\b|serves\s*:?\s*(\d+)/i;

    let name = "";
    let servings = null;
    let section = "name"; // name -> ingredients -> instructions
    const ingredientLines = [];
    const noteLines = [];

    rawLines.forEach(line => {
      if (ingredientsHeaderRe.test(line)) { section = "ingredients"; return; }
      if (instructionsHeaderRe.test(line)) { section = "instructions"; return; }

      const servMatch = line.match(servingsRe);
      if (servMatch && servings == null) {
        servings = parseInt(servMatch[1] || servMatch[2], 10) || null;
        if (line.replace(servingsRe, "").trim().length < 3) return; // the whole line was just the serving size
      }

      if (section === "name") {
        if (!name) { name = line; }
        else ingredientLines.push(line);
        return;
      }
      if (section === "ingredients") {
        // A long, sentence-like line is probably an instruction that drifted in without a
        // header — treat it as a note instead of a (nonsensical) ingredient.
        const wordCount = line.split(/\s+/).length;
        if (wordCount > 12 && /[.!]$/.test(line)) { noteLines.push(line); return; }
        ingredientLines.push(line);
        return;
      }
      noteLines.push(line);
    });

    const ingredients = ingredientLines
      .map(parseIngredientLine)
      .filter(Boolean)
      .map(ing => Object.assign({ category: guessCategoryFromTags([ing.name]) || "Other" }, ing));

    return {
      name: titleCaseWords(name || "Untitled recipe"),
      servings,
      ingredients,
      notes: noteLines.join(" ").slice(0, 500)
    };
  }

  function setRecipeUploadStatus(msg, isError) {
    const el = document.getElementById("recipeUploadStatusMsg");
    if (!el) return;
    el.textContent = msg || "";
    el.style.display = msg ? "" : "none";
    el.classList.toggle("scan-error", !!isError);
  }

  function applyParsedRecipeToForm(parsed) {
    editingRecipeId = null;
    document.getElementById("recipeName").value = parsed.name || "";
    document.getElementById("recipeServings").value = parsed.servings || "4";
    document.getElementById("recipeNotes").value = parsed.notes || "";
    const rows = document.getElementById("recipeIngredientRows");
    rows.innerHTML = "";
    if (parsed.ingredients.length === 0) {
      rows.appendChild(ingredientRowTemplate());
    } else {
      parsed.ingredients.forEach(ing => rows.appendChild(ingredientRowTemplate(ing)));
    }
    document.getElementById("saveRecipeBtn").textContent = "Save recipe";
    window.scrollTo({ top: document.getElementById("tab-recipes").offsetTop - 10, behavior: "smooth" });
  }

  function handleRecipeUploadFile(file) {
    if (!file) return;
    if (typeof Tesseract === "undefined") {
      setRecipeUploadStatus("The recipe reader couldn't load (no internet connection?). You can still fill in the form by hand below.", true);
      return;
    }
    setRecipeUploadStatus("Reading recipe… this can take up to 30 seconds, especially the first time.", false);

    Tesseract.recognize(file, "eng")
      .then(({ data }) => {
        const parsed = parseRecipeText(data && data.text);
        applyParsedRecipeToForm(parsed);
        setRecipeUploadStatus(
          parsed.ingredients.length
            ? `Filled in the form from ${parsed.ingredients.length} ingredient line${parsed.ingredients.length === 1 ? "" : "s"} we found — double-check everything, especially quantities, before saving.`
            : "Filled in what we could, but couldn't make out any ingredient lines — you'll need to add those by hand.",
          false
        );
      })
      .catch(err => {
        setRecipeUploadStatus("Couldn't read that image: " + (err && err.message ? err.message : err), true);
      });
  }

  const uploadRecipeBtn = document.getElementById("uploadRecipeBtn");
  if (uploadRecipeBtn) uploadRecipeBtn.addEventListener("click", () => {
    const input = document.getElementById("recipeFileInput");
    if (input) input.click();
  });
  const recipeFileInput = document.getElementById("recipeFileInput");
  if (recipeFileInput) recipeFileInput.addEventListener("change", e => {
    handleRecipeUploadFile(e.target.files[0]);
    e.target.value = "";
  });

  // Test-only hooks: let automated tests exercise things that are hard to trigger for real
  // (a camera scan, OCR on an actual image, the passage of time for a restock reminder, etc).
  // Harmless in normal use — nothing here is ever called unless a test explicitly invokes it.
  window.__pantryTestHooks = {
    handleScannedBarcode, guessCategoryFromTags,
    getState: () => state,
    renderAll, renderShoppingList, renderSpending, renderActivityLog, renderCookNow,
    stapleDueItems, parseReceiptLines, renderReceiptReview, renderSettingsForm,
    validateAddItemForm, currentPantryData,
    parseRecipeText, parseIngredientLine, fractionToDecimal,
    recipeReadiness, haveMap, expiringSoonAcrossLocations, shoppingListCount,
    recipesUsingNames, renderDashboard,
    logConsumption, weeklyUsageRate, suggestedBuyQty, shoppingSections,
    addLeftover, removeLeftover, activeLeftovers, urgentLeftovers, promptForLeftovers,
    computeNotifications, renderNotifications, dismissNotification, clearAllNotifications,
    autoFillWeek, mealSlotLabel, eatLeftoverFromSlot
  };

  // ---------------- Full render ----------------
  function renderAll() {
    applyTheme();
    renderPantrySelect();
    renderPrintScopeSelect();
    renderDashboard();
    renderInventory();
    renderQuickCount();
    renderRecipeList();
    renderCookNow();
    renderMealPlan();
    renderShoppingList();
    renderPantryItemNamesDatalist();
    renderSpending();
    renderActivityLog();
    renderSettingsForm();
    renderNotifications();
    applyDefaultsToItemForm();
    validateAddItemForm();
  }

  window.pantryApp = {
    adjustQty, removeItem, editRecipe, deleteRecipe, setMeal, markRecipeCooked,
    toggleAutoChecked, toggleExtraChecked, removeExtra, toggleStaple, markRestocked,
    removeCostEntry, goToTab, goToAddItem, goToScan, goToFindMeals,
    setInventoryFilter, cookRecipeNow, removeLeftover, eatLeftoverFromSlot, autoFillWeek,
    dismissNotification, clearAllNotifications
  };

  startAuthFlow();
})();
