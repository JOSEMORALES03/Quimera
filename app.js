(() => {
  "use strict";

  const CART_KEY = "quimera-cart-v3";
  const config = window.QUIMERA_SUPABASE_CONFIG || {};
  const backendReady = Boolean(config.url && config.anonKey && window.supabase);
  const supabase = backendReady
    ? window.supabase.createClient(config.url, config.anonKey)
    : null;
  const demoProducts = [
    { id: "demo-1", name: "Limpiador multiusos", category: "Limpieza", price: 18500, stock: 18, description: "Limpieza práctica para distintas superficies." },
    { id: "demo-2", name: "Jabón líquido", category: "Hogar", price: 12000, stock: 24, description: "Una opción rendidora para el uso diario." },
    { id: "demo-3", name: "Desengrasante", category: "Limpieza", price: 24000, stock: 12, description: "Ideal para la limpieza de cocina y taller." },
    { id: "demo-4", name: "Detergente concentrado", category: "Hogar", price: 31500, stock: 16, description: "Rendimiento concentrado para tus tareas." },
    { id: "demo-5", name: "Cloro doméstico", category: "Limpieza", price: 9500, stock: 20, description: "Producto de limpieza de uso doméstico." },
    { id: "demo-6", name: "Alcohol antiséptico", category: "Cuidado", price: 16000, stock: 9, description: "Presentación práctica para el hogar." }
  ];
  const data = {
    settings: { storeName: "Quimera", phone: "", address: "", bankName: "", accountHolder: "", accountNumber: "" },
    products: backendReady ? [] : demoProducts,
    orders: [],
    cart: readCart()
  };
  const POUNDS_TO_KILOGRAMS = 0.45359237;
  const colors = ["#d9b891", "#8db59a", "#d1a878", "#9aaec0", "#bdd0b4", "#c5a6bd"];
  let activeCategory = "Todos";
  const orderFilterTypes = ["delivery", "review"];
  let activeOrderFilters = new Set(orderFilterTypes);
  let activeScheduleOrderId = null;
  let scheduleCalendarMonth = new Date();
  let pendingTrackingReceipt = null;
  let editingProductId = null;
  let currentUser = null;
  let productChannel = null;
  let realtimeRefreshTimer = null;
  let orderAlertBlockedNotified = false;
  let catalogSearch = "";
  let trackingCredentials = null;
  let trackingPollTimer = null;
  let trackingPollInProgress = false;
  const recoveryWhatsAppLinks = new Map();
  let toastTimer;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function readCart() {
    try {
      const saved = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch (error) {
      console.error("No se pudo leer el carrito guardado.", error);
      return [];
    }

  }

  function saveScheduleDraft() {
    if (activeScheduleOrderId === null) return;
    const draft = { date: $("#schedule-date").value, time: $("#schedule-time").value };
    try {
      localStorage.setItem(`quimera-schedule-draft-${activeScheduleOrderId}`, JSON.stringify(draft));
      $("#schedule-draft-note").textContent = "Borrador guardado en este dispositivo. Puedes volver y guardarlo después.";
    } catch (error) {
      console.error("No se pudo guardar el borrador de programación.", error);
      $("#schedule-draft-note").textContent = "Mantén este panel abierto para conservar los datos antes de guardar.";
    }
  }

  function saveCart() {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(data.cart));
    } catch (error) {
      console.error("No se pudo guardar el carrito.", error);
      showToast("No se pudo guardar el carrito en este dispositivo.");
    }
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function money(value) {
    return new Intl.NumberFormat("es-CO", {
      style: "currency", currency: "COP", currencyDisplay: "code", maximumFractionDigits: 0
    }).format(Number(value) || 0);
  }

  function createUploadId() {
    const cryptoApi = window.crypto;
    if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
    if (typeof cryptoApi?.getRandomValues === "function") {
      const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    if (!toast.open) toast.show();
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove("show");
      if (toast.open) toast.close();
    }, 4000);
  }

  function backendError(error, action) {
    console.error(`${action}:`, error);
    return error?.message || `No se pudo ${action}. Revisa la conexión con Supabase.`;
  }

  function normalizeCustomerPhone(countryDialCode, localNumber) {
    const dialCode = String(countryDialCode || "").replace(/\D/g, "");
    const localDigits = String(localNumber || "").replace(/\D/g, "").replace(/^0+/, "");
    const phone = `+${dialCode}${localDigits}`;
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      throw new Error("Revisa el país y el número de teléfono. Deben sumar entre 8 y 15 dígitos.");
    }
    return phone;
  }

  function initializePhoneCountrySelector(formSelector) {
    const select = $(`${formSelector} select[name="countryDialCode"]`);
    const flag = document.createElement("img");
    flag.className = "phone-country-flag";
    flag.alt = "";
    flag.setAttribute("aria-hidden", "true");
    select.before(flag);

    const updateFlag = () => {
      const option = select.selectedOptions[0];
      const countryCode = option.textContent.slice(0, 2).toLowerCase();
      if (!/^[a-z]{2}$/.test(countryCode)) {
        throw new Error(`No se pudo identificar la bandera de ${option.textContent}.`);
      }
      flag.src = `flag-${countryCode}.png`;
      flag.alt = `Bandera ${option.textContent.slice(0, 2)}`;
    };

    select.addEventListener("change", updateFlag);
    updateFlag();
  }

  function whatsappRecoveryUrl(phone, message) {
    const original = String(phone || "").trim();
    let digits = original.replace(/\D/g, "");
    if (!original.startsWith("+") && digits.length === 10) digits = `57${digits}`;
    if (!/^[1-9]\d{7,14}$/.test(digits)) {
      throw new Error("El número del pedido no tiene un formato internacional válido.");
    }
    return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
  }

  function requireBackend() {
    if (supabase) return true;
    showToast("Primero configura la conexión con Supabase.");
    return false;
  }

  function mapSettings(row) {
    return {
      storeName: row?.store_name || "Quimera",
      phone: row?.phone || "",
      address: row?.address || "",
      bankName: row?.bank_name || "",
      accountHolder: row?.account_holder || "",
      accountNumber: row?.account_number || ""
    };
  }

  async function loadPublicStore() {
    if (!supabase) {
      $("#setup-notice").hidden = false;
      renderStore();
      return;
    }
    $("#setup-notice").hidden = true;
    const [settingsResult, productsResult] = await Promise.all([
      supabase.from("store_settings").select("store_name,phone,address,bank_name,account_holder,account_number").eq("id", true).maybeSingle(),
      supabase.from("products").select("id,name,category,price,stock,stock_amount,inventory_unit,description,unit_amount,unit_label").eq("active", true).order("name")
    ]);
    if (settingsResult.error) throw settingsResult.error;
    if (productsResult.error) throw productsResult.error;
    data.settings = mapSettings(settingsResult.data);
    data.products = productsResult.data || [];
    renderStore();
  }

  async function ensureSellerOwnership(user) {
    const { data: owner, error: ownerError } = await supabase
      .from("store_owners").select("owner_id").eq("id", true).maybeSingle();
    if (ownerError) throw ownerError;
    if (!owner || owner.owner_id !== user.id) {
      throw new Error("Esta cuenta no tiene acceso al panel de esta tienda.");
    }
  }

  async function loadSellerData(user) {
    await ensureSellerOwnership(user);
    subscribeToProductChanges();
    const results = await Promise.all([
      supabase.from("store_settings").select("*").eq("id", true).single(),
      supabase.from("products").select("id,name,category,price,stock,stock_amount,initial_stock_amount,inventory_unit,description,unit_amount,unit_label,active").order("name"),
      supabase.from("orders")
        .select("id,customer_name,phone,address,delivery_notes,total,delivery_fee,status,paid,paid_at,income_hidden,delivered_list_hidden,recent_hidden,receipt_path,pin_recovery_requested_at,pin_recovery_resolved_at,customer_received_at,seller_delivered_at,delivery_date,delivery_time,delivered_at,created_at,order_items(id,product_id,product_name,product_presentation,quantity,unit_price,line_total)")
        .order("created_at", { ascending: false })
    ]);
    const failure = results.find(result => result.error);
    if (failure?.error) throw failure.error;
    data.settings = mapSettings(results[0].data);
    data.products = results[1].data || [];
    data.orders = await Promise.all((results[2].data || []).map(async order => {
      let receiptUrl = "";
      if (order.receipt_path) {
        const { data: signed, error } = await supabase.storage.from("receipts").createSignedUrl(order.receipt_path, 300);
        if (error) console.error("No se pudo generar el enlace temporal del comprobante.", error);
        receiptUrl = signed?.signedUrl || "";
      }
      return {
        id: order.id,
        customer: order.customer_name,
        phone: order.phone,
        address: order.address,
        deliveryNotes: order.delivery_notes || "",
        total: Number(order.total),
        deliveryFee: Number(order.delivery_fee) || 0,
        status: order.status === "awaiting_customer_confirmation" ? "accepted" : order.status,
        paid: order.paid,
        incomeHidden: order.income_hidden === true,
        deliveredListHidden: order.delivered_list_hidden === true,
        recentHidden: order.recent_hidden === true,
        receiptUrl,
        receiptPath: order.receipt_path || "",
        pinRecoveryPending: Boolean(order.pin_recovery_requested_at && !order.pin_recovery_resolved_at),
        customerReceived: Boolean(order.customer_received_at),
        sellerDelivered: Boolean(order.seller_delivered_at),
        deliveryDate: order.delivery_date || "",
        deliveryTime: order.delivery_time || "",
        deliveredAt: order.delivered_at || (order.status === "delivered" ? order.created_at : ""),
        createdAt: order.created_at,
        paidAt: order.paid_at || "",
        items: (order.order_items || []).map(item => ({
          name: item.product_name,
          quantity: item.quantity,
          price: Number(item.unit_price),
          lineTotal: Number(item.line_total),
          presentation: item.product_presentation
        }))
      };
    }));
    renderStore();
    renderDashboard();
  }

  function subscribeToProductChanges() {
    if (!supabase || productChannel || !currentUser) return;
    productChannel = supabase.channel("store-inventory-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, scheduleRealtimeRefresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, payload => {
        scheduleRealtimeRefresh();
        if (currentUser) {
          playNewOrderAlert();
          const order = payload.new;
          showSellerNotification(
            "Nuevo pedido",
            `Pedido #${order.id} de ${order.customer_name}. Total: ${money(Number(order.total))}.`,
            `order-${order.id}`
          );
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, payload => {
        scheduleRealtimeRefresh();
        if (!currentUser || !payload.new.receipt_path) return;
        const order = data.orders.find(entry => Number(entry.id) === Number(payload.new.id));
        if (order && order.receiptPath !== payload.new.receipt_path) {
          showSellerNotification(
            "Comprobante de transferencia recibido",
            `El pedido #${payload.new.id} tiene un nuevo comprobante para revisar.`,
            `receipt-${payload.new.id}`
          );
        }
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "orders" }, scheduleRealtimeRefresh)
      .subscribe(status => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error(`Supabase Realtime no pudo suscribirse a productos y pedidos: ${status}`);
        }
      });
  }

  function showSellerNotification(title, body, tag) {
      if (!currentUser || !notificationApiAvailable() || Notification.permission !== "granted") return;
      navigator.serviceWorker.ready
        .then(registration => registration.showNotification(title, {
          body,
          icon: "./quimera-icon-192.png",
          badge: "./quimera-icon-192.png",
          tag,
          data: { url: "./" }
        }))
        .catch(error => console.error("No se pudo mostrar la notificación de Quimera.", error));
  }

  function notificationApiAvailable() {
      return ("Notification" in window) && ("serviceWorker" in navigator) && isSecureAppOrigin();
  }

  function notificationUnavailableMessage() {
      if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        return "En el móvil, 127.0.0.1 apunta al propio teléfono. Abre la versión publicada por HTTPS para activar avisos.";
      }
      return "Abre Quimera por HTTPS o desde http://localhost o http://127.0.0.1. No funciona abriendo index.html como archivo.";
  }

  function isSecureAppOrigin() {
      const hostname = location.hostname.replace(/^\[|\]$/g, "").toLowerCase();
      const isLocalOrigin = location.protocol === "http:" &&
        ["localhost", "127.0.0.1", "::1"].includes(hostname);
      return window.isSecureContext && (location.protocol === "https:" || isLocalOrigin);
  }

  function syncNotificationButton() {
      const button = $("#enable-notifications");
      if (!notificationApiAvailable()) {
        button.textContent = "Avisos no disponibles";
        button.disabled = false;
        button.title = "Pulsa para ver los requisitos de seguridad de las notificaciones.";
      } else if (Notification.permission === "granted") {
        button.textContent = "Avisos activados";
        button.disabled = true;
        button.title = "Este dispositivo ya permite las notificaciones de Quimera.";
      } else if (Notification.permission === "denied") {
        button.textContent = "Permiso bloqueado";
        button.disabled = false;
        button.title = "Activa las notificaciones de Quimera en la configuración del navegador.";
      } else {
        button.textContent = "Activar avisos";
        button.disabled = false;
        button.title = "Permite avisos de pedidos y comprobantes en este dispositivo.";
      }
  }

  async function enableSellerNotifications() {
      if (!notificationApiAvailable()) {
        showToast(notificationUnavailableMessage());
        return;
      }
      if (Notification.permission === "denied") {
        showToast("El permiso está bloqueado. Activa las notificaciones de Quimera en la configuración del navegador.");
        return;
      }
      try {
        const permission = Notification.permission === "granted"
          ? "granted"
          : await Notification.requestPermission();
        if (permission !== "granted") {
          showToast("No se activaron las notificaciones. Puedes permitirlas desde la configuración del navegador.");
          return;
        }
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification("Avisos activados", {
          body: "Recibirás avisos de pedidos y comprobantes mientras Quimera esté abierta.",
          icon: "./quimera-icon-192.png",
          badge: "./quimera-icon-192.png",
          tag: "quimera-notifications-enabled"
        });
        showToast("Avisos activados para pedidos nuevos y comprobantes recibidos.");
      } catch (error) {
        console.error("No se pudieron activar las notificaciones de Quimera.", error);
        showToast("No se pudieron activar las notificaciones. Revisa los permisos del navegador.");
      } finally {
        syncNotificationButton();
      }
  }

  function playNewOrderAlert() {
    const alert = $("#new-order-alert");
    alert.currentTime = 0;
    const playback = alert.play();
    if (!playback) return;
    playback.catch(error => {
      if (error.name === "NotAllowedError") {
        if (!orderAlertBlockedNotified) {
          orderAlertBlockedNotified = true;
          showToast("El navegador bloqueó el sonido. Activa el audio de la página e inténtalo de nuevo.");
        }
        return;
      }
      console.error("No se pudo reproducir la notificación de nuevo pedido.", error);
    });
  }

  function scheduleRealtimeRefresh() {
    clearTimeout(realtimeRefreshTimer);
    realtimeRefreshTimer = setTimeout(() => {
      if (currentUser) refreshSellerOrders();
    }, 250);
  }

  async function refreshSellerOrders() {
    if (currentUser && !$("#dashboard-view").hidden) {
      try {
        await loadSellerData(currentUser);
      } catch (error) {
        showToast(backendError(error, "actualizar los pedidos"));
      }
    }
  }

  function switchView(view) {
    if (view === "dashboard" && !currentUser) {
      closeMenu();
      if (!requireBackend()) return;
      $("#login-error").textContent = "";
      $("#seller-login-dialog").showModal();
      return;
    }
    const dashboard = view === "dashboard";
    $("#store-view").hidden = dashboard;
    $("#dashboard-view").hidden = !dashboard;
    $("#sign-out-button").hidden = !dashboard;
    if (dashboard) renderDashboard();
    else renderStore();
    closeMenu();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function switchTab(tab) {
    const activeTab = tab === "requests" ? "orders" : tab;
    $$(".dash-panel").forEach(panel => panel.classList.toggle("active", panel.id === `panel-${activeTab}`));
    $$(".side-link, .mobile-tab").forEach(button => button.classList.toggle("active", button.dataset.tab === activeTab));
  }

  function showOrdersView(filter = "delivery") {
    activeOrderFilters = new Set([filter === "review" ? "review" : "delivery"]);
    syncOrderFilters();
    renderOrders();
    switchTab("orders");
  }

  function syncOrderFilters() {
    $$("[data-order-filter]").forEach(input => {
      input.checked = activeOrderFilters.has(input.dataset.orderFilter);
    });
  }

  function closeMenu() {
    $("#main-menu").hidden = true;
    $("#menu-toggle").setAttribute("aria-expanded", "false");
    $("#menu-toggle").setAttribute("aria-label", "Abrir menú");
  }

  function renderStore() {
    renderFilters();
    renderProducts();
    renderCart();
    $("#product-count").textContent = `${data.products.length} productos`;
    $("#store-footer-contact").textContent = data.settings.phone
      ? `Atención personalizada · ${data.settings.phone}`
      : "Atención personalizada · Escríbenos para consultas";
    $("#checkout-button").disabled = !supabase || data.cart.length === 0 || cartHasInvalidQuantity() ||
      Boolean($("[data-cart-measured-quantity][aria-invalid='true']"));
    document.title = `${data.settings.storeName || "Quimera"} — Productos y suministros`;
  }

  function presentationLabel(product) {
    const unit = product.unit_label || "unidad";
    const amount = Number(product.unit_amount) || 1;
    return unit === "unidad" ? "1 unidad" : `${amount} ${unit}`;
  }

  function inventoryUnitFor(label) {
    if (label === "ml" || label === "l") return "l";
    if (["g", "kg", "lb"].includes(label)) return "kg";
    return "unidad";
  }

  function presentationInventoryAmount(product) {
    const amount = Number(product.unit_amount) || 1;
    switch (product.unit_label || "unidad") {
      case "ml": return amount / 1000;
      case "l": return amount;
      case "g": return amount / 1000;
      case "kg": return amount;
      case "lb": return amount * POUNDS_TO_KILOGRAMS;
      default: return 1;
    }
  }

  function isVariableQuantityProduct(product) {
    return ["ml", "l", "g", "kg", "lb"].includes(product.unit_label);
  }

  function pricePerSaleUnit(product) {
    const price = Number(product.price) || 0;
    const amount = Number(product.unit_amount) || 1;
    return isVariableQuantityProduct(product) && amount > 1 ? price / amount : price;
  }

  function unitPriceLabel(product) {
    if (!isVariableQuantityProduct(product)) return money(product.price);
    const rate = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 4 })
      .format(pricePerSaleUnit(product));
    return `COP ${rate} / 1 ${product.unit_label}`;
  }

  function availableSaleAmount(product) {
    if (!isVariableQuantityProduct(product)) return availablePresentations(product);
    const amountPerSaleUnit = presentationInventoryAmount({
      unit_label: product.unit_label,
      unit_amount: 1
    });
    if (amountPerSaleUnit <= 0) return 0;
    return Math.floor((inventoryAmount(product) / amountPerSaleUnit + 1e-9) * 1000) / 1000;
  }

  function isProductOutOfStock(product) {
    return isVariableQuantityProduct(product)
      ? availableSaleAmount(product) <= 0
      : availablePresentations(product) <= 0;
  }

  function orderItemQuantityLabel(item) {
    if (["ml", "l", "g", "kg", "lb"].includes(item.presentation)) {
      return `${Number(item.quantity).toLocaleString("es-CO", { maximumFractionDigits: 3 })} ${item.presentation}`;
    }
    return `${item.presentation ? `(${item.presentation}) ` : ""}× ${Number(item.quantity)}`;
  }

  function cartLineTotal(product, quantity) {
    return Math.round(pricePerSaleUnit(product) * Number(quantity));
  }

  function orderItemLineTotal(item) {
    return Number(item.lineTotal ?? item.line_total ?? Number(item.unit_price) * Number(item.quantity));
  }

  function cartHasInvalidQuantity() {
    return data.cart.some(item => {
      const product = data.products.find(entry => String(entry.id) === String(item.id));
      const quantity = Number(item.quantity);
      return !product || !Number.isFinite(quantity) || quantity <= 0 ||
        quantity > (isVariableQuantityProduct(product) ? availableSaleAmount(product) : availablePresentations(product)) ||
        (isVariableQuantityProduct(product) && Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 1e-8) ||
        (!isVariableQuantityProduct(product) && !Number.isInteger(quantity));
    });
  }

  function formattedSaleAmount(amount) {
    return Number(amount).toLocaleString("es-CO", { maximumFractionDigits: 3 });
  }

  function inventoryAmount(product) {
    const stored = Number(product.stock_amount);
    if (Number.isFinite(stored)) return stored;
    return Number(product.stock || 0) * presentationInventoryAmount(product);
  }

  function inventoryUnit(product) {
    return product.inventory_unit || inventoryUnitFor(product.unit_label || "unidad");
  }

  function inventoryDisplayUnit(productOrLabel) {
    const unitLabel = typeof productOrLabel === "string" ? productOrLabel : productOrLabel.unit_label;
    return unitLabel === "lb"
      ? "lb"
      : typeof productOrLabel === "string" ? inventoryUnitFor(unitLabel) : inventoryUnit(productOrLabel);
  }

  function inventoryAmountToStorage(amount, unitLabel) {
    const value = Number(amount);
    return unitLabel === "lb" ? value * POUNDS_TO_KILOGRAMS : value;
  }

  function inventoryAmountFromStorage(amount, unitLabel) {
    const value = Number(amount);
    return Number((unitLabel === "lb" ? value / POUNDS_TO_KILOGRAMS : value).toFixed(9));
  }

  function inventoryDisplayAmount(product) {
    return inventoryAmountFromStorage(inventoryAmount(product), product.unit_label);
  }

  function availablePresentations(product) {
    const amountPerPresentation = presentationInventoryAmount(product);
    return amountPerPresentation > 0
      ? Math.floor((inventoryAmount(product) + amountPerPresentation * 1e-9) / amountPerPresentation)
      : 0;
  }

  function formattedInventoryAmount(product) {
    const displayAmount = inventoryDisplayAmount(product);
    const amount = displayAmount.toFixed(9).replace(/\.?0+$/, "");
    const unit = inventoryDisplayUnit(product);
    const unitLabel = unit === "l"
      ? Number(amount) === 1 ? "litro" : "litros"
      : unit === "kg" ? "kilogramos"
        : unit === "lb" ? Number(amount) === 1 ? "libra" : "libras"
          : Number(amount) === 1 ? "unidad" : "unidades";
    return `${Number(amount || 0).toLocaleString("es-CO", { maximumFractionDigits: 9 })} ${unitLabel}`;
  }

  function formatTime12(value) {
    const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
    if (!match) return String(value || "");
    const hour = Number(match[1]);
    const suffix = hour >= 12 ? "p. m." : "a. m.";
    return `${hour % 12 || 12}:${match[2]} ${suffix}`;
  }

  function customerStockLabel(product) {
    if (isVariableQuantityProduct(product)) {
      const units = {
        ml: "ml",
        l: "litros",
        g: "g",
        kg: "kg",
        lb: "libras"
      };
      return `Hay ${formattedSaleAmount(availableSaleAmount(product))} ${units[product.unit_label]}`;
    }
    const unit = inventoryUnit(product);
    if (unit === "unidad") {
      const count = Math.floor(inventoryAmount(product));
      return `Hay ${count} ${count === 1 ? "unidad" : "unidades"}`;
    }
    if (unit === "l") {
      const milliliters = Number((inventoryAmount(product) * 1000).toFixed(3));
      return `Hay ${formattedSaleAmount(milliliters)} ml`;
    }
    const amount = Number(inventoryAmount(product).toFixed(9));
    return `Hay ${amount.toLocaleString("es-CO", { maximumFractionDigits: 9 })} kilogramos`;
  }

  function getStockPayload(amount, unitLabel, unitAmount) {
    const inventoryUnit = inventoryUnitFor(unitLabel);
    const amountPerPresentation = presentationInventoryAmount({ unit_label: unitLabel, unit_amount: unitAmount });
    const stockAmount = Number(amount);
    const stock = amountPerPresentation > 0 ? Math.floor((stockAmount + amountPerPresentation * 1e-9) / amountPerPresentation) : 0;
    return {
      stock_amount: stockAmount,
      initial_stock_amount: stockAmount,
      inventory_unit: inventoryUnit,
      stock: isVariableQuantityProduct({ unit_label: unitLabel }) && stockAmount > 0 ? Math.max(1, stock) : stock
    };
  }

  function updateInventoryUnitHint(unitLabel) {
    $("#stock-amount-unit").textContent = inventoryDisplayUnit(unitLabel);
    $("#stock-amount-help").textContent = unitLabel === "unidad"
      ? "Las existencias se controlan por unidades."
      : unitLabel === "ml" || unitLabel === "l"
        ? "Las existencias se controlan en litros; la tienda mostrará la disponibilidad en la unidad de venta."
        : unitLabel === "lb"
          ? "Las existencias se controlan en libras; la tienda mostrará la disponibilidad en libras."
        : "Las existencias se controlan en kilos; la tienda mostrará la disponibilidad en la unidad de venta.";
  }

  function updateProductPricingHint(unitLabel) {
    const measured = isVariableQuantityProduct({ unit_label: unitLabel });
    const priceInput = $("#product-form").elements.price;
    $("#product-price-label").textContent = measured ? `Precio por 1 ${unitLabel} (COP)` : "Precio por presentación (COP)";
    priceInput.min = measured ? "0.0001" : "1";
    priceInput.step = measured ? "0.0001" : "1";
    priceInput.placeholder = measured ? "10" : "1000";
    $("#presentation-preview").textContent = measured
      ? `Ingresa cuánto cuesta 1 ${unitLabel} (ejemplo: COP 10 por 1 ${unitLabel}). El cliente elige la cantidad.`
      : "Define el contenido que recibe el cliente por cada compra.";
  }

  function renderFilters() {
    const categories = ["Todos", ...new Set(data.products.map(product => product.category).filter(Boolean))];
    if (!categories.includes(activeCategory)) activeCategory = "Todos";
    $("#category-filters").innerHTML = categories.map(category =>
      `<button class="filter-chip ${category === activeCategory ? "selected" : ""}" type="button" data-category="${escapeHTML(category)}">${escapeHTML(category)}</button>`
    ).join("");
  }

  function renderProducts() {
    const search = catalogSearch.trim().toLocaleLowerCase("es");
    const products = data.products.filter(product => product.active !== false &&
      (activeCategory === "Todos" || product.category === activeCategory) &&
      (!search || `${product.name} ${product.category} ${product.description || ""} ${presentationLabel(product)} ${product.unit_label || ""}`
        .toLocaleLowerCase("es").includes(search)));
    $("#product-grid").innerHTML = products.length ? products.map((product, index) => {
      const available = availableSaleAmount(product);
      const outOfStock = isProductOutOfStock(product);
      const measured = isVariableQuantityProduct(product);
      const countableUnit = product.unit_label === "unidad";
      const purchaseControl = measured
        ? `<div class="measured-purchase"><label>Cantidad (${escapeHTML(product.unit_label)})<input type="number" min="0.001" step="0.001" max="${available}" value="${Math.min(1, available)}" data-measured-quantity="${escapeHTML(product.id)}" aria-label="Cantidad en ${escapeHTML(product.unit_label)} de ${escapeHTML(product.name)}"></label><div class="measured-purchase-total"><span data-measured-total="${escapeHTML(product.id)}">${money(cartLineTotal(product, Math.min(1, available)))}</span><button type="button" class="add-button" data-add-measured="${escapeHTML(product.id)}" aria-label="Agregar ${escapeHTML(product.name)}" ${outOfStock ? "disabled" : ""}>+</button></div></div>`
        : countableUnit
          ? `<div class="unit-purchase"><span class="unit-purchase-label">Cantidad</span><div class="unit-purchase-controls"><button type="button" data-unit-step="-1" data-id="${escapeHTML(product.id)}" aria-label="Restar una unidad de ${escapeHTML(product.name)}" ${outOfStock || available <= 1 ? "disabled" : ""}>−</button><input type="number" min="1" step="1" max="${available}" value="1" data-unit-quantity="${escapeHTML(product.id)}" aria-label="Cantidad de ${escapeHTML(product.name)}" ${outOfStock ? "disabled" : ""}><button type="button" data-unit-step="1" data-id="${escapeHTML(product.id)}" aria-label="Sumar una unidad de ${escapeHTML(product.name)}" ${available <= 1 ? "disabled" : ""}>+</button><button type="button" class="unit-add-button" data-add-unit="${escapeHTML(product.id)}" ${outOfStock ? "disabled" : ""}>Agregar</button></div></div>`
        : "";
      return `<article class="product-card">
        <div class="product-image" style="background:${colors[index % colors.length]}">
          <div class="product-illustration" style="background:${colors[(index + 2) % colors.length]}"><span class="illustration-label">${escapeHTML((product.category || "QUIMERA").slice(0, 10).toUpperCase())}</span></div>
        </div>
        <div class="product-info">
          <p class="product-category">${escapeHTML(product.category)}</p><h3>${escapeHTML(product.name)}</h3>
          <p class="product-description">${escapeHTML(product.description || "Producto disponible en nuestra tienda.")}</p>
          ${measured
            ? `<div class="product-unit-price">${escapeHTML(unitPriceLabel(product))}</div>${purchaseControl}`
            : countableUnit
              ? `<div class="product-bottom"><span class="product-price">${money(product.price)} <small>/ unidad</small></span></div>${purchaseControl}`
              : `<div class="product-bottom"><span class="product-price">${money(product.price)} <small>/ ${escapeHTML(presentationLabel(product))}</small></span><button type="button" class="add-button" data-add="${escapeHTML(product.id)}" aria-label="Agregar ${escapeHTML(product.name)}" ${outOfStock ? "disabled" : ""}>+</button></div>`}
          ${outOfStock ? '<div class="stock-hint">Agotado</div>' : `<div class="stock-hint">${escapeHTML(customerStockLabel(product))}</div>`}
        </div>
      </article>`;
    }).join("") : `<div class="empty-orders">${catalogSearch ? "No encontramos productos con esa búsqueda." : "Aún no hay productos publicados."}</div>`;
  }

  function renderCart() {
    data.cart = data.cart.filter(item => data.products.some(product => String(product.id) === String(item.id)));
    const count = data.cart.length;
    const total = data.cart.reduce((sum, item) => {
      const product = data.products.find(entry => String(entry.id) === String(item.id));
      return sum + (product ? cartLineTotal(product, item.quantity) : 0);
    }, 0);
    $("#cart-count").textContent = count;
    $("#cart-total").textContent = money(total);
    $("#checkout-total").textContent = money(total);
    $("#checkout-button").disabled = !supabase || count === 0 || cartHasInvalidQuantity();
    $("#empty-cart").hidden = count > 0;
    $("#cart-items").innerHTML = data.cart.map(item => {
      const product = data.products.find(entry => String(entry.id) === String(item.id));
      if (!product) return "";
      const measured = isVariableQuantityProduct(product);
      const quantityControl = measured
        ? `<label class="cart-measured-quantity">Cantidad (${escapeHTML(product.unit_label)})<input type="number" min="0.001" step="0.001" max="${availableSaleAmount(product)}" value="${item.quantity}" data-cart-measured-quantity data-id="${escapeHTML(item.id)}" aria-invalid="${Number(item.quantity) > availableSaleAmount(product) || Math.abs(Number(item.quantity) * 1000 - Math.round(Number(item.quantity) * 1000)) > 1e-8 ? "true" : "false"}" aria-label="Cantidad en ${escapeHTML(product.unit_label)} de ${escapeHTML(product.name)}"></label>`
        : `<div class="quantity-control"><span class="quantity-label">Cantidad</span><button type="button" data-quantity="-1" data-id="${escapeHTML(item.id)}" aria-label="Quitar una presentación de ${escapeHTML(product.name)}">−</button><span class="quantity-value">${item.quantity}</span><button type="button" data-quantity="1" data-id="${escapeHTML(item.id)}" aria-label="Agregar una presentación de ${escapeHTML(product.name)}">+</button></div>`;
      return `<div class="cart-item" data-cart-item="${escapeHTML(item.id)}"><span class="cart-item-name">${escapeHTML(product.name)}<small class="cart-presentation">${measured ? escapeHTML(unitPriceLabel(product)) : `${escapeHTML(presentationLabel(product))} por presentación`}</small></span><span class="cart-item-price">${money(cartLineTotal(product, item.quantity))}</span>${quantityControl}<button type="button" data-remove="${escapeHTML(item.id)}" class="link-button cart-remove">Quitar</button></div>`;
    }).join("");
    saveCart();
  }

  function addToCart(id, amount = 1) {
    const product = data.products.find(entry => String(entry.id) === String(id));
    if (!product) return;
    const cartItem = data.cart.find(item => String(item.id) === String(product.id));
    const addition = Number(amount);
    const quantity = Number(cartItem?.quantity || 0) + addition;
    if (!Number.isInteger(addition) || addition === 0 || quantity > availablePresentations(product)) {
      showToast(`Solo hay ${availablePresentations(product)} ${availablePresentations(product) === 1 ? "unidad" : "unidades"} disponibles.`);
      return;
    }
    if (quantity <= 0) {
      data.cart = data.cart.filter(item => String(item.id) !== String(product.id));
      renderCart();
      return;
    }
    if (cartItem) cartItem.quantity = quantity;
    else data.cart.push({ id: product.id, quantity });
    renderCart();
    showToast(`${product.name} agregado al pedido.`);
  }

  function addMeasuredToCart(id) {
    const product = data.products.find(entry => String(entry.id) === String(id));
    const input = $(`[data-measured-quantity="${CSS.escape(String(id))}"]`);
    const quantity = Number(input?.value);
    if (!product || !input || !isVariableQuantityProduct(product)) return;
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > availableSaleAmount(product)) {
      input.setAttribute("aria-invalid", "true");
      showToast(`Ingresa una cantidad válida; hay ${formattedSaleAmount(availableSaleAmount(product))} ${product.unit_label} disponibles.`);
      return;
    }
    const existing = data.cart.find(item => String(item.id) === String(id));
    if (Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 1e-8) {
      input.setAttribute("aria-invalid", "true");
      showToast(`La cantidad debe usar hasta tres decimales de ${product.unit_label}.`);
      return;
    }
    const nextQuantity = Number(existing?.quantity || 0) + quantity;
    if (nextQuantity > availableSaleAmount(product)) {
      showToast(`Solo hay ${formattedSaleAmount(availableSaleAmount(product))} ${product.unit_label} disponibles.`);
      return;
    }
    input.removeAttribute("aria-invalid");
    if (existing) existing.quantity = nextQuantity;
    else data.cart.push({ id: product.id, quantity });
    renderCart();
    showToast(`${formattedSaleAmount(quantity)} ${product.unit_label} de ${product.name} agregado(s).`);
  }

  function updateCartTotals() {
    const total = data.cart.reduce((sum, item) => {
      const product = data.products.find(entry => String(entry.id) === String(item.id));
      return sum + (product ? cartLineTotal(product, item.quantity) : 0);
    }, 0);
    const hasInvalidQuantity = cartHasInvalidQuantity() ||
      Boolean($("[data-cart-measured-quantity][aria-invalid='true']"));
    $("#cart-total").textContent = money(total);
    $("#checkout-total").textContent = money(total);
    $("#checkout-button").disabled = !supabase || data.cart.length === 0 || hasInvalidQuantity;
  }

  function openCheckout() {
    if (!requireBackend() || !data.cart.length) return;
    if (cartHasInvalidQuantity()) {
      showToast("Revisa las cantidades del carrito; algunas superan el inventario disponible.");
      return;
    }
    $("#checkout-error").textContent = "";
    $("#checkout-form").reset();
    $("#checkout-dialog").showModal();
  }

  function renderDashboard() {
    renderMetrics();
    renderRecentOrders();
    renderLowStock();
    renderOrders();
    renderInventory();
    renderSettings();
  }

  function isPaid(order) {
    return order.paid === true;
  }

  function canCustomerCancel(order) {
    return Boolean(order && trackingCredentials && !trackingCredentials.phoneOnly &&
      trackingCredentials.pin && !isPaid(order) && !order.receipt_submitted &&
      ["pending", "awaiting_customer_confirmation", "accepted"].includes(order.status));
  }

  function renderMetrics() {
    const weekRange = getIncomeRange("week");
    const monthRange = getIncomeRange("month");
    const paidOrders = data.orders.filter(order =>
      isPaid(order) && order.status === "delivered" && !order.incomeHidden);
    const sumInRange = range => paidOrders.filter(order =>
      new Date(order.paidAt || order.createdAt) >= range.start &&
      new Date(order.paidAt || order.createdAt) < range.end)
      .reduce((sum, order) => sum + Number(order.total) + Number(order.deliveryFee || 0), 0);
    $("#weekly-income").textContent = money(sumInRange(weekRange));
    $("#monthly-income").textContent = money(sumInRange(monthRange));
    const openOrders = data.orders.filter(order => !["delivered", "cancelled"].includes(order.status)).length;
    $("#open-orders").textContent = openOrders;
    const pendingLabel = openOrders > 99 ? "99+" : String(openOrders);
    ["#pending-count", "#mobile-pending-count"].forEach(selector => {
      const badge = $(selector);
      badge.textContent = pendingLabel;
      badge.hidden = false;
      badge.setAttribute("aria-label", `${openOrders} ${openOrders === 1 ? "pedido pendiente" : "pedidos pendientes"}`);
    });
    const lowStockCount = getLowStockProducts().length;
    const lowStockLabel = lowStockCount > 99 ? "99+" : String(lowStockCount);
    ["#low-stock-count", "#mobile-low-stock-count"].forEach(selector => {
      const badge = $(selector);
      badge.textContent = lowStockLabel;
      badge.hidden = lowStockCount === 0;
      badge.setAttribute("aria-label", `${lowStockCount} ${lowStockCount === 1 ? "producto con stock bajo" : "productos con stock bajo"}`);
    });
    $("#inventory-total").textContent = data.products.length;
    renderIncomeReport();
  }

  function getIncomeRange(period, date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Bogota", year: "numeric", month: "numeric", day: "numeric", weekday: "short"
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const year = Number(values.year);
    const month = Number(values.month);
    const day = Number(values.day);
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(values.weekday);
    const startDate = new Date(Date.UTC(year, month - 1, day));
    if (period === "week") startDate.setUTCDate(startDate.getUTCDate() - ((weekday + 6) % 7));
    if (period === "month") startDate.setUTCDate(1);
    const endDate = new Date(startDate);
    if (period === "week") endDate.setUTCDate(endDate.getUTCDate() + 7);
    else if (period === "month") endDate.setUTCMonth(endDate.getUTCMonth() + 1);
    else endDate.setUTCDate(endDate.getUTCDate() + 1);
    const toBogotaInstant = value => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 5));
    return { start: toBogotaInstant(startDate), end: toBogotaInstant(endDate) };
  }

  function getIncomeOrders(period = $("#income-period").value) {
    const range = getIncomeRange(period);
    return data.orders.filter(order => isPaid(order) && order.status === "delivered" && !order.incomeHidden &&
      new Date(order.paidAt || order.createdAt) >= range.start && new Date(order.paidAt || order.createdAt) < range.end);
  }

  function renderIncomeReport() {
    const period = $("#income-period").value;
    const titles = { day: "Ingresos del día", week: "Ingresos de la semana", month: "Ingresos del mes" };
    const orders = getIncomeOrders(period);
    $("#income-period-title").textContent = titles[period];
    $("#income-total").textContent = money(orders.reduce((sum, order) =>
      sum + order.total + Number(order.deliveryFee || 0), 0));
    $("#income-orders").innerHTML = orders.length
      ? [...orders].sort((a, b) => new Date(b.paidAt || b.createdAt) - new Date(a.paidAt || a.createdAt)).map(order =>
        `<article class="income-order"><div><b>Pedido #${escapeHTML(order.id)} · ${escapeHTML(order.customer)}</b><small>Pagado: ${dateLabel(order.paidAt || order.createdAt)} · Entregado: ${dateLabel(order.deliveredAt || order.createdAt)}</small></div><strong>${money(Number(order.total) + Number(order.deliveryFee || 0))}</strong></article>`
      ).join("")
      : '<p class="empty-orders">No hay ingresos registrados en este periodo.</p>';
  }

  function exportIncomeReport() {
    const period = $("#income-period").value;
    const rows = getIncomeOrders(period)
      .sort((a, b) => new Date(a.paidAt || a.createdAt) - new Date(b.paidAt || b.createdAt))
      .map(order => [order.id, dateLabel(order.paidAt || order.createdAt), order.customer, order.phone,
        Number(order.total) + Number(order.deliveryFee || 0)]);
    downloadExcel(`ingresos-${period}-${dateInputValue(new Date())}.xls`,
      ["Pedido", "Fecha", "Cliente", "Teléfono", "Ingresos COP"], rows);
  }

  async function deletePeriodIncome(button) {
    const period = $("#income-period").value;
    const { start, end } = getIncomeRange(period);
    const delivered = getIncomeOrders(period);
    if (!delivered.length) {
      showToast("No hay pedidos entregados en este periodo para borrar.");
      return;
    }
    if (!window.confirm(`Se ocultarán los ingresos de ${delivered.length} pedidos de este periodo. Los pedidos seguirán en Entregados. ¿Continuar?`)) return;
    button.disabled = true;
    try {
      const { data: deleted, error } = await supabase.rpc("delete_delivered_income_period", {
        p_start: start.toISOString(),
        p_end: end.toISOString()
      });
      if (error) throw error;
      await loadSellerData(currentUser);
      showToast(`${Number(deleted) || 0} ingresos ocultados. Los pedidos siguen en Entregados.`);
    } catch (error) {
      showToast(backendError(error, "borrar los ingresos del periodo"));
    } finally {
      button.disabled = false;
    }
  }

  function downloadExcel(filename, headers, rows) {
    const escapeCell = value => `"${String(value ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
    const contents = [headers, ...rows].map(row => row.map(escapeCell).join(";")).join("\r\n");
    const blob = new Blob(["\uFEFF", contents], { type: "application/vnd.ms-excel;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  }

  function statusLabel(status) {
    if (status === "cancelled") return "Cancelado";
    if (status === "delivered") return "Entregado";
    if (status === "scheduled") return "Entrega por confirmar";
    if (status === "pending") return "Solicitud recibida";
    if (status === "accepted") return "Aceptado · pendiente de pago";
    if (status === "awaiting_customer_confirmation") return "Aceptado · pendiente de pago";
    return "Pago por revisar";
  }

  function statusClass(status) {
    return status === "delivered" || status === "accepted" || status === "scheduled"
      ? "status-delivered"
      : status === "awaiting_customer_confirmation" ? "status-delivered" : "status-pending";
  }

  function dateLabel(date) {
    return new Intl.DateTimeFormat("es-CO", {
      dateStyle: "medium", timeStyle: "short", hour12: true
    }).format(new Date(date));
  }

  function renderRecentOrders() {
    const recent = [...data.orders].filter(order => !order.recentHidden)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 4);
    $("#recent-orders").innerHTML = recent.length ? recent.map(order =>
      `<div class="recent-order"><div class="recent-order-heading"><b>${escapeHTML(order.customer)} · #${order.id}</b><strong>${money(order.total)}</strong></div><div class="recent-order-details"><small>${dateLabel(order.createdAt)}</small><span class="status-pill ${statusClass(order.status)}">${statusLabel(order.status)}</span><button class="recent-order-hide" type="button" data-hide-recent-order="${escapeHTML(order.id)}" aria-label="Ocultar pedido ${escapeHTML(order.id)} de los últimos pedidos">Ocultar</button></div></div>`
    ).join("") : '<div class="empty-orders">Tus nuevos pedidos aparecerán aquí.</div>';
  }

  function getLowStockProducts() {
    return data.products.filter(product => {
      const initialAmount = Number(product.initial_stock_amount);
      return Number.isFinite(initialAmount) && initialAmount > 0 &&
        inventoryAmount(product) < initialAmount * 0.2;
    }).sort((a, b) => inventoryAmount(a) / Number(a.initial_stock_amount) -
      inventoryAmount(b) / Number(b.initial_stock_amount));
  }

  function renderLowStock() {
    const lowStock = getLowStockProducts();
    $("#low-stock-list").innerHTML = lowStock.length ? lowStock.map(product => {
      const remainingPercent = Math.floor(inventoryAmount(product) / Number(product.initial_stock_amount) * 100);
      return `<div class="stock-row"><div><b>${escapeHTML(product.name)}</b><small>Queda ${remainingPercent}% del inventario de referencia</small></div><strong class="stock-qty">${escapeHTML(formattedInventoryAmount(product))}</strong></div>`;
    }).join("") : '<div class="empty-orders">No hay productos por debajo del 20% de su última reposición.</div>';
  }

  function isDeliveredToday(order) {
    if (!order.deliveredAt) return false;
    const bogotaDate = date => new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(date);
    return bogotaDate(new Date(order.deliveredAt)) === bogotaDate(new Date());
  }

  function orderFilterType(order) {
    if (order.status === "accepted" && !isPaid(order) && order.receiptPath) return "review";
    if (["pending", "awaiting_customer_confirmation", "accepted", "scheduled"].includes(order.status)) return "delivery";
    return null;
  }

  function renderOrders() {
    const deliveredToday = data.orders.filter(order =>
      order.status === "delivered" && !order.deliveredListHidden && isDeliveredToday(order)).length;
    const hasVisibleDelivered = data.orders.some(order =>
      order.status === "delivered" && !order.deliveredListHidden);
    $("#delivered-export-tools").hidden = !hasVisibleDelivered;
    $("#delete-delivered-today").hidden = deliveredToday === 0;
    $("#delete-delivered-today").textContent = `Quitar entregados de hoy de esta lista (${deliveredToday})`;
    const filtered = [...data.orders].filter(order =>
      activeOrderFilters.has(orderFilterType(order)) &&
      !(order.status === "delivered" && order.deliveredListHidden))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    $("#orders-summary").textContent = `${filtered.length} ${filtered.length === 1 ? "pedido" : "pedidos"}`;
    const emptyMessage = activeOrderFilters.size
      ? "No hay pedidos en los filtros seleccionados."
      : "Activa un filtro para mostrar los pedidos de ese estado.";
    $("#orders-list").innerHTML = renderOrderCards(filtered, emptyMessage);
  }

  function renderOrderCards(orders, emptyMessage) {
    return orders.length ? orders.map(order => {
      const lines = order.items.map(item => `${escapeHTML(item.name)} ${escapeHTML(orderItemQuantityLabel(item))} · ${money(orderItemLineTotal(item))}`).join("<br>");
      const receipt = order.receiptUrl
        ? `<span class="receipt-label">Comprobante de pago</span><button type="button" class="receipt-open-button" data-open-receipt="${escapeHTML(order.receiptUrl)}" aria-label="Abrir comprobante del pedido ${order.id}"><img class="receipt-thumb" src="${escapeHTML(order.receiptUrl)}" alt="Comprobante del pedido ${order.id}"><span>Ver comprobante</span></button>`
        : "";
      const newRequest = order.status === "pending";
      const needsReceiptReview = order.status === "accepted" && !isPaid(order) && Boolean(order.receiptPath);
      const awaitingReceipt = order.status === "accepted" && !isPaid(order) && !order.receiptPath;
      const canSchedule = isPaid(order) && ["accepted", "scheduled"].includes(order.status) && !order.sellerDelivered;
      const hasSchedule = Boolean(order.deliveryDate && order.deliveryTime);
      const recoveryLink = recoveryWhatsAppLinks.get(String(order.id));
      const recoveryActions = order.pinRecoveryPending
        ? `<div class="order-action-buttons recovery-actions"><p class="order-waiting-note">El cliente perdió el PIN y espera aprobación del vendedor.</p><button type="button" class="small-button primary" data-approve-pin-recovery="${order.id}">Aprobar y preparar WhatsApp</button></div>`
        : recoveryLink
          ? `<div class="order-action-buttons recovery-actions"><a class="small-button primary recovery-whatsapp-link" href="${escapeHTML(recoveryLink)}" target="_blank" rel="noopener noreferrer">Abrir WhatsApp para enviar el PIN</a></div>`
          : "";
      const actions = newRequest
        ? `<div class="order-action-buttons payment-review-actions"><button type="button" class="small-button primary" data-accept-order="${order.id}">Aceptar y programar entrega</button><span class="order-total">Productos: ${money(order.total)}</span></div>`
        : needsReceiptReview && !hasSchedule
          ? `<div class="order-action-buttons"><button type="button" class="small-button primary" data-open-schedule="${order.id}">Programar entrega antes de verificar el pago</button></div>`
        : needsReceiptReview
          ? `<div class="order-action-buttons"><button type="button" class="small-button primary" data-verify-payment="${order.id}">Confirmar comprobante y pago</button></div>`
        : awaitingReceipt
          ? hasSchedule
            ? '<p class="order-waiting-note">Horario confirmado. Esperando el comprobante de transferencia.</p>'
            : `<div class="order-action-buttons"><button type="button" class="small-button primary" data-open-schedule="${order.id}">Programar entrega antes del pago</button></div>`
        : canSchedule
          ? `<div class="order-action-buttons"><button type="button" class="small-button primary" data-open-schedule="${order.id}">${hasSchedule ? "Cambiar fecha y hora" : "Programar entrega"}</button>${hasSchedule ? `<button type="button" class="small-button" data-delivered="${order.id}">Marcar que entregué</button>` : ""}<span class="order-total">Total: ${money(order.total)}</span></div>`
        : order.status === "scheduled" && order.sellerDelivered && !order.customerReceived
          ? '<p class="order-waiting-note">Marcaste la entrega. Falta que el cliente confirme que la recibió.</p>'
          : "";
      const cancellation = !["delivered", "cancelled"].includes(order.status)
        ? `<button type="button" class="small-button cancel-order-button" data-cancel-order="${order.id}">Cancelar pedido</button>`
        : "";
      return `<article class="order-card">
        <div class="order-card-head"><div><p class="order-number">Pedido #${order.id}</p><span class="order-date">${dateLabel(order.createdAt)}</span></div><div class="order-status"><span class="status-pill ${statusClass(order.status)}">${needsReceiptReview ? "Pago por verificar" : order.status === "accepted" && isPaid(order) ? "Pago confirmado · pendiente de entrega" : statusLabel(order.status)}</span>${isPaid(order) ? '<span class="status-pill status-delivered">Pago verificado</span>' : ""}${order.status === "scheduled" && order.customerReceived ? '<span class="status-pill status-delivered">Cliente confirmó recepción</span>' : ""}</div></div>
        <div class="order-body"><div><div class="order-lines">${lines}<br><strong>Total productos: ${money(order.total)}</strong></div><div class="customer-meta">Cliente: <b>${escapeHTML(order.customer)}</b><br>Teléfono: ${escapeHTML(order.phone)}<br>Entrega: ${escapeHTML(order.address)}${order.deliveryNotes ? `<br>Indicaciones para el domiciliario: <b>${escapeHTML(order.deliveryNotes)}</b>` : ""}${order.deliveryDate ? `<br>Programada: <b>${escapeHTML(order.deliveryDate)} · ${escapeHTML(formatTime12(order.deliveryTime))}</b>` : ""}</div></div><div>${receipt}</div></div>
        ${actions || cancellation || recoveryActions ? `<div class="order-actions">${recoveryActions}${actions}${cancellation}</div>` : ""}
      </article>`;
    }).join("") : `<div class="empty-orders">${emptyMessage}</div>`;
  }

  function renderInventory(search = "") {
    const normalized = search.trim().toLocaleLowerCase("es");
    const products = data.products.filter(product =>
      `${product.name} ${product.category} ${product.description || ""} ${presentationLabel(product)}`
        .toLocaleLowerCase("es").includes(normalized));
    $("#inventory-caption").textContent = `${data.products.length} ${data.products.length === 1 ? "producto" : "productos"} en total`;
    $("#inventory-empty").hidden = products.length > 0;
    $("#inventory-table").innerHTML = products.map((product, index) => {
      const measured = isVariableQuantityProduct(product);
      const available = measured ? availableSaleAmount(product) : availablePresentations(product);
      const pricing = measured
        ? `<b>${escapeHTML(unitPriceLabel(product))}</b><small class="table-subline">Precio por unidad de venta</small>`
        : `<b>${money(product.price)}</b><small class="table-subline">${escapeHTML(presentationLabel(product))}</small>`;
      return `<tr>
      <td><span class="inventory-product"><span class="inventory-swatch" style="background:${colors[index % colors.length]}">◈</span>${escapeHTML(product.name)}</span></td>
      <td>${escapeHTML(product.category)}</td><td>${pricing}</td>
      <td><div class="stock-editor"><input type="number" min="0" step="any" value="${inventoryDisplayAmount(product)}" data-stock-input="${escapeHTML(product.id)}" aria-label="Inventario en ${inventoryDisplayUnit(product)} de ${escapeHTML(product.name)}"><span>${escapeHTML(formattedInventoryAmount(product))}</span><button class="small-button" type="button" data-save-stock="${escapeHTML(product.id)}">Guardar</button></div></td>
      <td><span class="stock-badge">${available <= 0 ? "Agotado" : "Disponible"}</span></td>
      <td><button class="delete-button" type="button" data-edit-product="${escapeHTML(product.id)}" aria-label="Editar ${escapeHTML(product.name)}">✎</button><button class="delete-button" type="button" data-delete-product="${escapeHTML(product.id)}" aria-label="Eliminar ${escapeHTML(product.name)}">×</button></td></tr>`;
    }).join("");
  }

  function renderSettings() {
    const form = $("#settings-form");
    Object.entries(data.settings).forEach(([name, value]) => {
      if (form.elements[name]) form.elements[name].value = value || "";
    });
  }

  async function updateOrder(id, values, successMessage) {
    const { error } = await supabase.from("orders").update(values).eq("id", id);
    if (error) throw error;
    await loadSellerData(currentUser);
    showToast(successMessage);
  }

  async function saveSchedule(id) {
    const order = data.orders.find(entry => Number(entry.id) === id);
    if (!order || !["pending", "accepted", "scheduled"].includes(order.status) ||
        (order.status === "scheduled" && (!isPaid(order) || order.sellerDelivered))) {
      showToast("Este pedido ya no está disponible para programar.");
      return;
    }
    if (!isPaid(order) && (!data.settings.bankName || !data.settings.accountHolder || !data.settings.accountNumber)) {
      $("#schedule-error").textContent = "Completa primero los datos bancarios en la sección Datos.";
      return;
    }
    const date = $("#schedule-date").value;
    const time = $("#schedule-time").value;
    if (!date || !time) {
      $("#schedule-error").textContent = "Selecciona la fecha y la hora para continuar.";
      return;
    }
    const submit = $("#schedule-save");
    submit.disabled = true;
    $("#schedule-error").textContent = "";
    try {
      const accepting = order.status === "pending";
      const status = accepting ? "accepted" : order.status;
      await updateOrder(id, { delivery_date: date, delivery_time: time, status },
        accepting ? "Pedido aceptado y horario de entrega confirmado." : "Horario de entrega actualizado.");
      try {
        localStorage.removeItem(`quimera-schedule-draft-${id}`);
      } catch (error) {
        console.error("No se pudo borrar el borrador de programación guardado.", error);
      }
      $("#schedule-dialog").close();
      showOrdersView(isPaid(order) ? "delivery" : "coordination");
    } catch (error) {
      $("#schedule-error").textContent = backendError(error, "guardar el horario");
    } finally {
      submit.disabled = false;
    }
  }

  function dateInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatScheduleDate(value) {
    if (!value) return "";
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("es-CO", { dateStyle: "full" }).format(new Date(year, month - 1, day));
  }

  function renderScheduleCalendar() {
    const monthLabel = new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric" }).format(scheduleCalendarMonth);
    $("#schedule-month-label").textContent = monthLabel.charAt(0).toLocaleUpperCase("es") + monthLabel.slice(1);
    const first = new Date(scheduleCalendarMonth.getFullYear(), scheduleCalendarMonth.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - offset);
    const minDate = dateInputValue(new Date());
    const selected = $("#schedule-date").value;
    $("#schedule-calendar-grid").innerHTML = Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      const value = dateInputValue(date);
      const outside = date.getMonth() !== scheduleCalendarMonth.getMonth();
      const disabled = value < minDate;
      return `<button type="button" class="calendar-day${outside ? " outside" : ""}${value === selected ? " selected" : ""}" data-schedule-day="${value}" ${disabled ? "disabled" : ""} aria-label="${escapeHTML(formatScheduleDate(value))}" ${value === selected ? 'aria-pressed="true"' : ""}>${date.getDate()}</button>`;
    }).join("");
    updateScheduleSelectedLabel();
  }

  function updateScheduleSelectedLabel() {
    const date = $("#schedule-date").value;
    const time = $("#schedule-time").value;
    $("#schedule-selected-label").textContent = date && time
      ? `${formatScheduleDate(date)} · ${formatTime12(time)}`
      : date ? `${formatScheduleDate(date)} · Elige una hora`
        : "Selecciona un día y una hora.";
  }

  function renderScheduleTimes(selectedTime) {
    const times = [];
    for (let minutes = 8 * 60; minutes <= 21 * 60; minutes += 30) {
      const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
      const minute = String(minutes % 60).padStart(2, "0");
      const value = `${hour}:${minute}`;
      times.push({ value, label: formatTime12(value) });
    }
    const normalizedSelected = String(selectedTime || "").slice(0, 5);
    if (normalizedSelected && !times.some(time => time.value === normalizedSelected)) {
      times.push({ value: normalizedSelected, label: formatTime12(normalizedSelected) });
    }
    times.sort((a, b) => a.value.localeCompare(b.value));
    $("#schedule-time").innerHTML = `<option value="">Selecciona la hora</option>${times.map(time =>
      `<option value="${time.value}" ${time.value === normalizedSelected ? "selected" : ""}>${time.label}</option>`).join("")}`;
  }

  function openScheduleDialog(id) {
    const order = data.orders.find(entry => Number(entry.id) === id);
    if (!order) return;
    if (!isPaid(order) && (!data.settings.bankName || !data.settings.accountHolder || !data.settings.accountNumber)) {
      showToast("Configura la cuenta bancaria en Datos antes de aceptar pedidos.");
      switchTab("settings");
      return;
    }
    activeScheduleOrderId = id;
    const accepting = order.status === "pending";
    let draft = null;
    try {
      draft = JSON.parse(localStorage.getItem(`quimera-schedule-draft-${id}`) || "null");
    } catch (error) {
      console.error("No se pudo leer el borrador de programación.", error);
    }
    $("#schedule-order-label").textContent = `Pedido #${order.id} · ${order.customer}`;
    $("#schedule-dialog .eyebrow").textContent = accepting ? "ACEPTAR PEDIDO" : "COORDINAR ENTREGA";
    $("#schedule-dialog h2").textContent = accepting ? "Confirma fecha y hora" : "Fecha y hora";
    $("#schedule-save").textContent = accepting ? "Aceptar y confirmar horario" : "Guardar programación";
    const today = dateInputValue(new Date());
    const savedDate = draft ? draft.date : order.deliveryDate;
    $("#schedule-date").value = savedDate && savedDate >= today ? savedDate : today;
    const selectedTime = draft ? draft.time : order.deliveryTime || "";
    renderScheduleTimes(selectedTime);
    const selectedDate = $("#schedule-date").value
      ? new Date(`${$("#schedule-date").value}T12:00:00`)
      : new Date();
    scheduleCalendarMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    $("#schedule-error").textContent = "";
    $("#schedule-draft-note").textContent = draft
      ? "Se recuperó el borrador guardado en este dispositivo."
      : accepting
        ? "Al guardar, aceptarás el pedido y el cliente podrá transferir después."
        : "La fecha y hora se conservan mientras preparas la entrega.";
    renderScheduleCalendar();
    $("#schedule-dialog").showModal();
  }

  async function authenticateSeller(form) {
    if (!requireBackend()) return;
    const fields = new FormData(form);
    $("#login-error").textContent = "";
    const submit = $('button[type="submit"]', form);
    submit.disabled = true;
    try {
      const { data: result, error } = await supabase.auth.signInWithPassword({
        email: String(fields.get("email")).trim(),
        password: String(fields.get("password"))
      });
      if (error) throw error;
      currentUser = result.user;
      await loadSellerData(currentUser);
      form.reset();
      $("#seller-login-dialog").close();
      switchView("dashboard");
      showToast("Sesión de vendedor iniciada.");
    } catch (error) {
      currentUser = null;
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) console.error("No se pudo cerrar la sesión tras un error de acceso.", signOutError);
      $("#login-error").textContent = backendError(error, "iniciar sesión");
    } finally {
      submit.disabled = false;
    }
  }

  async function signOutSeller() {
    if (!supabase || !currentUser) return;
    const { error } = await supabase.auth.signOut();
    if (error) {
      showToast(backendError(error, "cerrar la sesión"));
      return;
    }
    currentUser = null;
    recoveryWhatsAppLinks.clear();
    if (productChannel) {
      await supabase.removeChannel(productChannel);
      productChannel = null;
    }
    data.orders = [];
    switchView("store");
    try {
      await loadPublicStore();
      showToast("Sesión cerrada.");
    } catch (loadError) {
      showToast(backendError(loadError, "cargar la tienda"));
    }
  }

  async function submitOrder(form) {
    if (!supabase) {
      $("#checkout-error").textContent = "No se pudo conectar con la tienda.";
      return;
    }
    for (const item of data.cart) {
      const product = data.products.find(entry => String(entry.id) === String(item.id));
      const quantity = Number(item.quantity);
      if (!product || !Number.isFinite(quantity) || quantity <= 0 ||
          quantity > (isVariableQuantityProduct(product) ? availableSaleAmount(product) : availablePresentations(product)) ||
          (isVariableQuantityProduct(product) && Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 1e-8) ||
          (!isVariableQuantityProduct(product) && !Number.isInteger(quantity))) {
        $("#checkout-error").textContent = `Revisa la cantidad de ${product?.name || "uno de los productos"}; ya no hay suficiente inventario.`;
        renderCart();
        return;
      }
    }
    const fields = new FormData(form);
    const submit = $('button[type="submit"]', form);
    submit.disabled = true;
    $("#checkout-error").textContent = "";
    try {
      const items = data.cart.map(item => ({ product_id: item.id, quantity: item.quantity }));
      const { data: result, error } = await supabase.rpc("create_store_order", {
        p_customer_name: String(fields.get("customer")).trim(),
        p_customer_email: null,
        p_phone: normalizeCustomerPhone(fields.get("countryDialCode"), fields.get("phone")),
        p_address: String(fields.get("address")).trim(),
        p_delivery_notes: String(fields.get("deliveryNotes")).trim(),
        p_items: items,
        p_receipt_path: null
      });
      if (error) throw error;
      data.cart = [];
      saveCart();
      $("#checkout-dialog").close();
      $("#success-message").textContent = "Tu solicitud fue enviada. El vendedor la aceptará y programará la entrega; después podrás transferir y adjuntar el comprobante desde el seguimiento.";
      $("#success-tracking-code").innerHTML = `<strong>${escapeHTML(result.pin)}</strong><button type="button" class="copy-pin-button" data-copy-pin="${escapeHTML(result.pin)}" aria-label="Copiar PIN">▢</button>`;
      $("#success-tracking-code").dataset.pin = result.pin;
      $("#success-dialog").showModal();
      await loadPublicStore();
    } catch (error) {
      $("#checkout-error").textContent = backendError(error, "enviar el pedido");
    } finally {
      submit.disabled = false;
    }
  }

  function renderTracking(order) {
    const result = $("#tracking-result");
    if (!order) {
      result.hidden = true;
      result.innerHTML = "";
      return;
    }
    const status = order.status === "delivered" ? "Recibido"
      : order.status === "accepted" && order.paid ? "Pago confirmado · entrega pendiente"
        : statusLabel(order.status);
    const items = (order.items || []).map(item =>
    `<div class="tracking-line"><span>${escapeHTML(item.name)} ${escapeHTML(orderItemQuantityLabel(item))}</span><b>${money(orderItemLineTotal(item))}</b></div>`
    ).join("");
    const hasSchedule = Boolean(order.delivery_date && order.delivery_time);
    const paymentStep = order.status === "accepted" && !order.paid && hasSchedule
      ? `<div class="payment-step"><p class="payment-step-title">Entrega programada · ya puedes transferir</p><p class="payment-total">${money(order.total)}</p><div class="bank-info"><div class="bank-info-title">Datos para realizar la transferencia</div><div class="bank-info-grid"><span>Banco</span><b>${escapeHTML(order.bank_name || "")}</b><span>Titular</span><b>${escapeHTML(order.account_holder || "")}</b><span>Número de cuenta</span><b class="bank-account-number">${escapeHTML(order.account_number || "")}</b>${order.store_phone ? `<span>Contacto</span><b>${escapeHTML(order.store_phone)}</b>` : ""}</div></div>${order.receipt_submitted ? '<p class="payment-received-note">Comprobante recibido. El vendedor está verificando el pago.</p>' : '<label class="upload-label tracking-upload-label">Adjunta el comprobante de transferencia<input type="file" id="tracking-receipt" accept="image/jpeg,image/png,image/webp"><span class="upload-box"><span class="upload-icon">↑</span><span id="tracking-receipt-name"><b>Seleccionar imagen</b><small>JPG, PNG o WebP · Máximo 2 MB</small></span></span></label><button type="button" class="button button-dark full-button" data-submit-payment>Enviar comprobante</button>'}</div>`
      : "";
    const receivedConfirmation = order.status === "scheduled" && !order.customer_received
      ? '<p class="tracking-delivery">Cuando te llegue el pedido, por favor confirma su recepción para ayudarnos a cerrar y actualizar tu pedido.</p><button type="button" class="button button-dark full-button" data-confirm-received>Confirmar que recibí mi pedido</button>'
      : order.status === "scheduled" && order.customer_received
        ? '<p class="payment-received-note">Confirmaste que recibiste el pedido. Pasará a Entregados cuando el vendedor también confirme la entrega.</p>'
      : order.status === "delivered"
        ? '<p class="payment-received-note">El cliente y el vendedor confirmaron la entrega. ¡Gracias!</p>'
        : "";
    const statusMessage = order.status === "pending"
      ? "El vendedor revisará tu solicitud y confirmará la fecha y hora antes de que transfieras."
      : order.status === "cancelled"
        ? "Este pedido fue cancelado. Contacta al vendedor si necesitas ayuda."
        : order.status === "accepted" && !hasSchedule
          ? order.paid ? "Pago verificado. El vendedor está programando la entrega." : "El vendedor aceptó tu solicitud y está confirmando el horario."
          : order.status === "accepted" && !order.paid
            ? "El horario está confirmado. Transfiere el total de los productos y adjunta el comprobante para completar el pedido."
            : order.paid
              ? "Pago verificado. El pedido está en preparación para la entrega."
              : "";
    result.innerHTML = `<div class="tracking-head"><span class="status-pill ${statusClass(order.status)}">${status}</span><small>Pedido #${escapeHTML(order.id)}</small></div>
      ${statusMessage ? `<p class="tracking-delivery">${statusMessage}</p>` : ""}
      ${hasSchedule ? `<div class="tracking-schedule"><span class="schedule-field-icon" aria-hidden="true">▦</span><span><small>FECHA Y HORA APROXIMADA DE ENTREGA</small><b>${escapeHTML(formatScheduleDate(order.delivery_date))}</b><strong>${escapeHTML(formatTime12(order.delivery_time))}</strong><small class="schedule-arrival-note">La hora es aproximada; tu pedido podría llegar un poco antes o después.</small></span></div>` : ""}
      ${order.delivery_notes ? `<p class="tracking-delivery"><b>Tus indicaciones:</b> ${escapeHTML(order.delivery_notes)}</p>` : ""}
      <div class="tracking-lines">${items}</div><div class="tracking-total"><span>Total de productos</span><b>${money(order.total)}</b></div>${paymentStep}${receivedConfirmation}`;
    result.hidden = false;
  }

  async function fetchTrackedOrder(credentials) {
    const { data: order, error } = await supabase.rpc("track_store_order", {
      p_pin: credentials.pin,
      p_customer_email: null
    });
    if (error) throw error;
    return order;
  }

  async function fetchTrackedOrdersByPhone(phone) {
    const { data: orders, error } = await supabase.rpc("track_store_orders_by_phone", {
      p_customer_phone: phone
    });
    if (error) throw error;
    return Array.isArray(orders) ? orders : [];
  }

  function renderPhoneTracking(orders) {
    const result = $("#tracking-result");
    result.innerHTML = orders.length
      ? `<p class="tracking-delivery">Pedidos asociados a este celular. Para pagar, cancelar o confirmar recepción necesitas el PIN.</p>${orders.map(order => {
        const schedule = order.delivery_date && order.delivery_time
          ? `<div class="tracking-schedule"><span class="schedule-field-icon" aria-hidden="true">▦</span><span><small>FECHA Y HORA APROXIMADA DE ENTREGA</small><b>${escapeHTML(formatScheduleDate(order.delivery_date))}</b><strong>${escapeHTML(formatTime12(order.delivery_time))}</strong><small class="schedule-arrival-note">La hora es aproximada; tu pedido podría llegar un poco antes o después.</small></span></div>`
          : "";
        const status = order.status === "delivered" ? "Recibido"
          : order.status === "accepted" && order.paid ? "Pago confirmado · entrega pendiente"
            : statusLabel(order.status);
        const recoveryAction = trackingCredentials?.phoneOnly && order.id
          ? order.pin_recovery_pending
            ? '<p class="tracking-delivery recovery-pending-note">Solicitud enviada al vendedor. Te contactará por WhatsApp después de aprobarla.</p>'
            : order.pin_recovery_available === false
              ? '<p class="tracking-delivery">Ya se atendió una solicitud recientemente. Espera 15 minutos para volver a solicitar el PIN.</p>'
              : `<button type="button" class="button button-outline full-button recovery-button" data-request-pin-recovery="${escapeHTML(order.id)}">Solicitar PIN por WhatsApp</button>`
          : "";
        return `<article class="phone-tracking-order"><div class="tracking-head"><span class="status-pill ${statusClass(order.status)}">${status}</span><small>Pedido #${escapeHTML(order.id)}</small></div>${schedule}<div class="tracking-total"><span>Total de productos</span><b>${money(order.total)}</b></div>${recoveryAction}</article>`;
      }).join("")}`
      : "";
    result.hidden = !orders.length;
  }

  async function requestTrackedOrderPin(button) {
    if (!trackingCredentials?.phoneOnly || !trackingCredentials.phone) {
      $("#track-error").textContent = "Consulta primero tus pedidos con el celular registrado al comprar.";
      return;
    }

    button.disabled = true;
    $("#track-error").textContent = "";
    try {
      const { error } = await supabase.rpc("request_store_order_pin_recovery", {
        p_order_id: Number(button.dataset.requestPinRecovery),
        p_customer_phone: trackingCredentials.phone
      });
      if (error) throw error;
      await refreshTrackedOrder();
      showToast("Si los datos coinciden, el vendedor verá tu solicitud y te contactará por WhatsApp.");
    } catch (error) {
      $("#track-error").textContent = backendError(error, "solicitar ayuda para recuperar el PIN");
    } finally {
      button.disabled = false;
    }
  }

  async function approveTrackedOrderPinRecovery(button) {
    const orderId = Number(button.dataset.approvePinRecovery);
    const order = data.orders.find(entry => Number(entry.id) === orderId);
    if (!order?.pinRecoveryPending) {
      showToast("Esta solicitud ya fue atendida o no está disponible.");
      return;
    }

    let whatsappWindow = null;
    try {
      whatsappRecoveryUrl(order.phone, "");
      whatsappWindow = window.open("about:blank", "_blank");
      recoveryWhatsAppLinks.delete(String(orderId));
      button.disabled = true;
      const { data: result, error } = await supabase.rpc("approve_store_order_pin_recovery", {
        p_order_id: orderId
      });
      if (error) throw error;
      if (!result?.pin || !/^\d{12}$/.test(result.pin)) {
        throw new Error("Supabase no devolvió un PIN nuevo válido.");
      }

      const message = `Hola ${result.customer}, aprobamos tu solicitud de recuperación del PIN para el pedido #${orderId} de Quimera. Tu PIN nuevo es ${result.pin}. El PIN anterior ya no funciona.`;
      const whatsappUrl = whatsappRecoveryUrl(result.phone, message);
      if (whatsappWindow && !whatsappWindow.closed) {
        whatsappWindow.opener = null;
        whatsappWindow.location.href = whatsappUrl;
      } else {
        recoveryWhatsAppLinks.set(String(orderId), whatsappUrl);
      }
      await loadSellerData(currentUser);
      if (whatsappWindow && !whatsappWindow.closed) {
        showToast("PIN nuevo aprobado. Revisa y envía el mensaje en WhatsApp.");
      } else {
        showToast("PIN nuevo aprobado. Abre WhatsApp desde el botón del pedido para enviarlo.");
      }
    } catch (error) {
      if (whatsappWindow && !whatsappWindow.closed) whatsappWindow.close();
      showToast(backendError(error, "aprobar la recuperación del PIN"));
    } finally {
      button.disabled = false;
    }
  }

  async function submitTrackingPayment(button) {
    if (!pendingTrackingReceipt || !trackingCredentials) {
      showToast("Selecciona la imagen del comprobante antes de continuar.");
      return;
    }
    const extensionByType = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
    const extension = extensionByType[pendingTrackingReceipt.type];
    if (!extension) {
      showToast("El comprobante debe ser JPG, PNG o WebP.");
      return;
    }
    button.disabled = true;
    $("#track-error").textContent = "";
    try {
      const path = `incoming/${createUploadId()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from("receipts").upload(path, pendingTrackingReceipt, {
        cacheControl: "3600", upsert: false, contentType: pendingTrackingReceipt.type
      });
      if (uploadError) throw uploadError;
      const { data: submitted, error } = await supabase.rpc("submit_store_order_payment", {
        p_pin: trackingCredentials.pin,
        p_customer_email: null,
        p_receipt_path: path
      });
      if (error) throw error;
      if (!submitted) throw new Error("No se pudo adjuntar el comprobante a este pedido.");
      pendingTrackingReceipt = null;
      await refreshTrackedOrder();
      showToast("Comprobante enviado. El vendedor verificará tu pago.");
    } catch (error) {
      $("#track-error").textContent = backendError(error, "enviar el comprobante");
    } finally {
      button.disabled = false;
    }
  }

  async function refreshTrackedOrder() {
    if (!trackingCredentials || !$("#track-dialog").open || trackingPollInProgress) return;
    trackingPollInProgress = true;
    try {
      if (trackingCredentials.phoneOnly) {
        const orders = await fetchTrackedOrdersByPhone(trackingCredentials.phone);
        renderPhoneTracking(orders);
      } else {
        const order = await fetchTrackedOrder(trackingCredentials);
        if (!order) {
          trackingCredentials = null;
          clearInterval(trackingPollTimer);
          trackingPollTimer = null;
          $("#cancel-tracked-order").hidden = true;
          renderTracking(null);
          $("#track-error").textContent = "No encontramos este pedido. Vuelve a consultarlo con tu PIN.";
        } else if (!pendingTrackingReceipt) {
          $("#cancel-tracked-order").hidden = !canCustomerCancel(order);
          renderTracking(order);
        }
      }
    } catch (error) {
      $("#track-error").textContent = backendError(error, "actualizar el pedido");
    } finally {
      trackingPollInProgress = false;
    }
  }

  function startTrackingUpdates() {
    clearInterval(trackingPollTimer);
    trackingPollTimer = setInterval(refreshTrackedOrder, 5000);
  }

  async function trackOrder(form) {
    if (!requireBackend()) return;
    const fields = new FormData(form);
    $("#cancel-tracked-order").dataset.confirming = "";
    $("#cancel-tracked-order").textContent = "Cancelar pedido";
    clearInterval(trackingPollTimer);
    trackingPollTimer = null;
    trackingCredentials = null;
    pendingTrackingReceipt = null;
    renderTracking(null);
    $("#cancel-tracked-order").hidden = true;
    $("#track-error").textContent = "";
    const submit = $('button[type="submit"]', form);
    submit.disabled = true;
    try {
      const credentials = {
        pin: String(fields.get("pin")).trim()
      };
      if (!credentials.pin && !String(fields.get("phone")).trim()) {
        $("#track-error").textContent = "Escribe el PIN o el celular registrado al hacer el pedido.";
        return;
      }
      if (!credentials.pin) {
        credentials.phone = normalizeCustomerPhone(fields.get("countryDialCode"), fields.get("phone"));
        const orders = await fetchTrackedOrdersByPhone(credentials.phone);
        if (!orders.length) {
          $("#track-error").textContent = "No encontramos pedidos asociados a ese celular.";
          return;
        }
        trackingCredentials = { phone: credentials.phone, phoneOnly: true };
        $("#cancel-tracked-order").hidden = true;
        renderPhoneTracking(orders);
        startTrackingUpdates();
        return;
      }
      const order = await fetchTrackedOrder(credentials);
      if (!order) {
        trackingCredentials = null;
        $("#cancel-tracked-order").hidden = true;
        clearInterval(trackingPollTimer);
        renderTracking(null);
        $("#track-error").textContent = "No encontramos un pedido con ese PIN.";
        return;
      }
      trackingCredentials = credentials;
      pendingTrackingReceipt = null;
      $("#cancel-tracked-order").hidden = !canCustomerCancel(order);
      renderTracking(order);
      startTrackingUpdates();
    } catch (error) {
      $("#track-error").textContent = backendError(error, "consultar el pedido");
    } finally {
      submit.disabled = false;
    }
  }

  document.addEventListener("click", async event => {
    const target = event.target.closest("button, a");
    if (!target) return;
    if (target.dataset.copyPin) {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(target.dataset.copyPin);
        } else {
          const input = document.createElement("textarea");
          input.value = target.dataset.copyPin;
          input.style.position = "fixed";
          input.style.opacity = "0";
          document.body.append(input);
          input.select();
          const copied = document.execCommand("copy");
          input.remove();
          if (!copied) throw new Error("El navegador no permitió copiar el PIN.");
        }
        showToast("PIN copiado.");
      } catch (error) {
        console.error("No se pudo copiar el PIN.", error);
        showToast("No se pudo copiar. Mantén presionado el PIN para copiarlo.");
      }
    }
    if (target.dataset.requestPinRecovery) await requestTrackedOrderPin(target);
    if (target.dataset.approvePinRecovery) await approveTrackedOrderPinRecovery(target);
    if (target.id === "view-tracking-button") {
      const pin = $("#success-tracking-code").dataset.pin;
      $("#success-dialog").close();
      const form = $("#track-form");
      form.reset();
      form.elements.pin.value = pin;
      $("#track-error").textContent = "";
      $("#cancel-tracked-order").hidden = true;
      $("#track-dialog").showModal();
      await trackOrder(form);
    }
    if (target.dataset.view) {
      event.preventDefault();
      switchView(target.dataset.view);
    }
    if (target.id === "refresh-orders") {
      if (!currentUser) return;
      target.disabled = true;
      try {
        await loadSellerData(currentUser);
        showToast("Pedidos actualizados.");
      } catch (error) {
        showToast(backendError(error, "actualizar los pedidos"));
      } finally {
        target.disabled = false;
      }
    }
    if (target.dataset.tab) switchTab(target.dataset.tab);
    if (target.dataset.openReceipt) {
      $("#receipt-preview").src = target.dataset.openReceipt;
      $("#receipt-dialog").showModal();
    }
    if (target.dataset.menuAction === "products") {
      closeMenu();
      $("#store-view").hidden = false;
      $("#dashboard-view").hidden = true;
      $("#catalogo").scrollIntoView({ behavior: "smooth" });
    }
    if (target.dataset.menuAction === "track") {
      closeMenu();
      if (requireBackend()) {
        $("#track-error").textContent = "";
        renderTracking(null);
        $("#track-dialog").showModal();
      }
    }
    if (target.dataset.menuAction === "seller") switchView("dashboard");
    if (target.dataset.menuAction === "signout") await signOutSeller();
    if (target.id === "menu-toggle") {
      const menu = $("#main-menu");
      menu.hidden = !menu.hidden;
      target.setAttribute("aria-expanded", String(!menu.hidden));
      target.setAttribute("aria-label", menu.hidden ? "Abrir menú" : "Cerrar menú");
    }
    if (target.dataset.category) {
      activeCategory = target.dataset.category;
      renderFilters();
      renderProducts();
    }
    if (target.dataset.add) addToCart(target.dataset.add);
    if (target.dataset.addMeasured) addMeasuredToCart(target.dataset.addMeasured);
    if (target.dataset.unitStep) {
      const input = $(`[data-unit-quantity="${CSS.escape(String(target.dataset.id))}"]`);
      const product = data.products.find(entry => String(entry.id) === String(target.dataset.id));
      if (!input || !product) return;
      const available = availablePresentations(product);
      const current = Number(input.value) || 1;
      const next = Math.min(available, Math.max(1, current + Number(target.dataset.unitStep)));
      input.value = String(next);
      input.setAttribute("aria-invalid", "false");
      $(`[data-unit-step="-1"][data-id="${CSS.escape(String(product.id))}"]`).disabled = next <= 1;
      $(`[data-unit-step="1"][data-id="${CSS.escape(String(product.id))}"]`).disabled = next >= available;
    }
    if (target.dataset.addUnit) {
      const input = $(`[data-unit-quantity="${CSS.escape(String(target.dataset.addUnit))}"]`);
      const amount = Number(input?.value);
      const product = data.products.find(entry => String(entry.id) === String(target.dataset.addUnit));
      if (!product || !input || !Number.isInteger(amount) || amount < 1 || amount > availablePresentations(product)) {
        input?.setAttribute("aria-invalid", "true");
        showToast("Selecciona una cantidad de unidades disponible.");
        return;
      }
      addToCart(target.dataset.addUnit, amount);
    }
    if (target.hasAttribute("data-scroll-cart")) {
      if ($("#store-view").hidden) switchView("store");
      $("#shopping-cart").scrollIntoView({ behavior: "smooth", block: "center" });
      $("#shopping-cart").setAttribute("tabindex", "-1");
      $("#shopping-cart").focus({ preventScroll: true });
    }
    if (target.dataset.quantity) {
      const item = data.cart.find(entry => String(entry.id) === String(target.dataset.id));
      if (item) addToCart(item.id, Number(target.dataset.quantity));
    }
    if (target.dataset.remove) {
      data.cart = data.cart.filter(item => String(item.id) !== String(target.dataset.remove));
      renderCart();
    }
    if (target.id === "checkout-button") openCheckout();
    if (target.dataset.calendarMove) {
      scheduleCalendarMonth.setMonth(scheduleCalendarMonth.getMonth() + Number(target.dataset.calendarMove));
      renderScheduleCalendar();
    }
    if (target.dataset.scheduleDay) {
      $("#schedule-date").value = target.dataset.scheduleDay;
      renderScheduleCalendar();
      saveScheduleDraft();
    }
    if (target.id === "export-delivered") {
      const rows = data.orders.filter(order => order.status === "delivered" && !order.deliveredListHidden)
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        .map(order => [order.id, order.customer, order.phone, order.address,
          order.items.map(item => `${item.name} ${orderItemQuantityLabel(item)} · ${money(orderItemLineTotal(item))}`).join(" | "),
          order.total + order.deliveryFee, order.deliveryDate, formatTime12(order.deliveryTime), dateLabel(order.deliveredAt || order.createdAt)]);
      downloadExcel(`pedidos-entregados-${dateInputValue(new Date())}.xls`,
        ["Pedido", "Cliente", "Teléfono", "Dirección", "Productos", "Total COP", "Fecha entrega", "Hora entrega", "Fecha entregado"], rows);
    }
    if (target.id === "export-income") exportIncomeReport();
    if (target.id === "delete-income") await deletePeriodIncome(target);
    if (target.dataset.openSchedule) openScheduleDialog(Number(target.dataset.openSchedule));
    if (target.dataset.acceptOrder) {
      const orderId = Number(target.dataset.acceptOrder);
      const order = data.orders.find(entry => Number(entry.id) === orderId);
      if (!order || order.status !== "pending" || isPaid(order)) return;
      openScheduleDialog(orderId);
    }
    if (target.dataset.verifyPayment) {
      const orderId = Number(target.dataset.verifyPayment);
      const order = data.orders.find(entry => Number(entry.id) === orderId);
      if (!order || order.status !== "accepted" || isPaid(order) || !order.receiptPath) {
        showToast("Este pedido todavía no tiene un comprobante para verificar.");
        return;
      }
      target.disabled = true;
      try {
        if (!order.deliveryDate || !order.deliveryTime) {
          throw new Error("Este pedido todavía no tiene fecha y hora de entrega confirmadas.");
        }
        await updateOrder(orderId, { paid: true }, "Pago verificado. El pedido está listo para entregar.");
        showOrdersView("delivery");
      } catch (error) {
        showToast(backendError(error, "verificar el pago"));
      } finally {
        target.disabled = false;
      }
    }
    if (target.dataset.saveSchedule) await saveSchedule(Number(target.dataset.saveSchedule));
    if (target.dataset.delivered) {
      const order = data.orders.find(entry => Number(entry.id) === Number(target.dataset.delivered));
      if (!order || !["accepted", "scheduled"].includes(order.status) || !isPaid(order) || order.sellerDelivered || !order.deliveryDate || !order.deliveryTime) {
        showToast("Confirma el pago y guarda la fecha y hora antes de marcar la entrega.");
        return;
      }
      try {
        const now = new Date().toISOString();
        await updateOrder(Number(target.dataset.delivered), {
          seller_delivered_at: now,
          status: order.customerReceived ? "delivered" : "scheduled",
          delivered_at: order.customerReceived ? now : null
        }, order.customerReceived
          ? "Ambas partes confirmaron la entrega. Pedido archivado en Entregados."
          : "Marcaste la entrega. El pedido pasará a Entregados cuando el cliente confirme que lo recibió.");
        showOrdersView(order.customerReceived ? "delivered" : "delivery");
      } catch (error) {
        showToast(backendError(error, "actualizar el pedido"));
      }
    }
    if (target.dataset.cancelOrder) {
      const order = data.orders.find(entry => Number(entry.id) === Number(target.dataset.cancelOrder));
      if (!order || ["delivered", "cancelled"].includes(order.status) ||
          !window.confirm(`¿Cancelar y eliminar totalmente el pedido #${order.id}? Se devolverán sus cantidades al inventario.`)) return;
      target.disabled = true;
      try {
        const { data: cancelled, error } = await supabase.rpc("cancel_store_order", { p_order_id: order.id });
        if (error) throw error;
        if (!cancelled) throw new Error("El pedido ya no se puede cancelar.");
        await loadSellerData(currentUser);
        showToast("Pedido eliminado y cantidades devueltas al inventario.");
      } catch (error) {
        showToast(backendError(error, "cancelar el pedido"));
      } finally {
        target.disabled = false;
      }
    }
    if (target.hasAttribute("data-delete-delivered-today")) {
      if (!window.confirm("¿Quitar de la lista todos los pedidos entregados hoy? Sus ingresos y seguimiento se conservarán.")) return;
      target.disabled = true;
      try {
        const { data: deleted, error } = await supabase.rpc("delete_delivered_orders_today");
        if (error) throw error;
        await loadSellerData(currentUser);
        showOrdersView("delivered");
        showToast(`${Number(deleted) || 0} pedidos quitados de Entregados. Sus ingresos se conservaron.`);
      } catch (error) {
        showToast(backendError(error, "eliminar los pedidos entregados"));
      } finally {
        target.disabled = false;
      }
    }
    if (target.dataset.deleteProduct) {
      const product = data.products.find(entry => String(entry.id) === String(target.dataset.deleteProduct));
      if (product && window.confirm(`¿Eliminar "${product.name}" del catálogo?`)) {
        try {
          const { error } = await supabase.from("products").delete().eq("id", product.id);
          if (error) throw error;
          await loadSellerData(currentUser);
          showToast("Producto eliminado.");
        } catch (error) {
          showToast(backendError(error, "eliminar el producto"));
        }
      }
    }
    if (target.id === "toggle-product-form") {
      const form = $("#product-form");
      if (!form.hidden && editingProductId === null) form.hidden = true;
      else {
        editingProductId = null;
        form.reset();
        form.elements.unitAmount.value = "1";
        form.elements.unitAmount.readOnly = true;
        form.dataset.stockUnitLabel = form.elements.unitLabel.value;
        updateInventoryUnitHint(form.elements.unitLabel.value);
        updateProductPricingHint(form.elements.unitLabel.value);
        $("#product-form-kicker").textContent = "NUEVO PRODUCTO";
        $("#product-form-title").textContent = "Detalles del producto";
        $("#product-form-submit").textContent = "Guardar producto";
        form.hidden = false;
      }
    }
    if (target.dataset.editProduct) {
      const product = data.products.find(entry => String(entry.id) === String(target.dataset.editProduct));
      if (product) {
        editingProductId = product.id;
        const form = $("#product-form");
        form.elements.name.value = product.name;
        form.elements.category.value = product.category;
        form.elements.unitLabel.value = product.unit_label || "unidad";
        form.dataset.stockUnitLabel = form.elements.unitLabel.value;
        const measured = isVariableQuantityProduct(product);
        form.elements.unitAmount.value = measured ? "1" : Number(product.unit_amount) || 1;
        form.elements.unitAmount.readOnly = measured || form.elements.unitLabel.value === "unidad";
        updateInventoryUnitHint(form.elements.unitLabel.value);
        updateProductPricingHint(form.elements.unitLabel.value);
        form.elements.price.value = pricePerSaleUnit(product);
        form.elements.stockAmount.value = inventoryDisplayAmount(product);
        form.elements.description.value = product.description || "";
        $("#product-form-kicker").textContent = "EDITAR PRODUCTO";
        $("#product-form-title").textContent = product.name;
        $("#product-form-submit").textContent = "Guardar cambios";
        form.hidden = false;
        form.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
    if (target.dataset.saveStock) {
      const productId = target.dataset.saveStock;
      const stockInput = $$("[data-stock-input]").find(input => input.dataset.stockInput === productId);
      const productData = data.products.find(entry => String(entry.id) === productId);
      if (!stockInput || !productData) return;
      const stockAmount = inventoryAmountToStorage(Number(stockInput.value), productData.unit_label);
      if (!Number.isFinite(stockAmount) || stockAmount < 0) {
        showToast("Ingresa una cantidad de inventario igual o mayor que cero.");
        return;
      }
      target.disabled = true;
      try {
        const { error } = await supabase.from("products")
          .update({ ...getStockPayload(stockAmount, productData.unit_label, productData.unit_amount) })
          .eq("id", productId);
        if (error) throw error;
        await loadSellerData(currentUser);
        showToast("Inventario actualizado.");
      } catch (error) {
        showToast(backendError(error, "actualizar el inventario"));
      } finally {
        target.disabled = false;
      }
    }
    if (target.id === "close-product-form") {
      $("#product-form").hidden = true;
      editingProductId = null;
    }
    if (target.hasAttribute("data-close-dialog")) target.closest("dialog").close();
  });

  $("#product-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity() || !currentUser) return;
    const fields = new FormData(form);
    const product = {
      name: String(fields.get("name")).trim(),
      category: String(fields.get("category")).trim(),
      unit_amount: isVariableQuantityProduct({ unit_label: String(fields.get("unitLabel")) })
        ? 1
        : Number(fields.get("unitAmount")),
      unit_label: String(fields.get("unitLabel")),
      price: Number(fields.get("price")),
      ...getStockPayload(
        inventoryAmountToStorage(Number(fields.get("stockAmount")), String(fields.get("unitLabel"))),
        String(fields.get("unitLabel")),
        isVariableQuantityProduct({ unit_label: String(fields.get("unitLabel")) })
          ? 1
          : Number(fields.get("unitAmount"))
      ),
      description: String(fields.get("description")).trim(),
      active: true
    };
    const existing = data.products.find(entry => String(entry.id) === String(editingProductId));
    if (existing && inventoryUnit(existing) !== product.inventory_unit) {
      showToast("No puedes cambiar la base entre unidades, litros y kilos. Crea un producto nuevo para esa medida.");
      return;
    }
    const submit = $("#product-form-submit");
    submit.disabled = true;
    try {
      const result = editingProductId === null
        ? await supabase.from("products").insert(product)
        : await supabase.from("products").update(product).eq("id", editingProductId);
      if (result.error) throw result.error;
      editingProductId = null;
      form.reset();
      form.hidden = true;
      await loadSellerData(currentUser);
      showToast("Producto guardado en el catálogo.");
    } catch (error) {
      showToast(backendError(error, "guardar el producto"));
    } finally {
      submit.disabled = false;
    }
  });

  $("#settings-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity() || !currentUser) return;
    const fields = new FormData(form);
    const settings = {
      store_name: String(fields.get("storeName")).trim(),
      phone: String(fields.get("phone")).trim(),
      address: String(fields.get("address")).trim(),
      bank_name: String(fields.get("bankName")).trim(),
      account_holder: String(fields.get("accountHolder")).trim(),
      account_number: String(fields.get("accountNumber")).trim()
    };
    try {
      const { error } = await supabase.from("store_settings").update(settings).eq("id", true);
      if (error) throw error;
      await loadPublicStore();
      $("#settings-saved").textContent = "Cambios guardados";
      setTimeout(() => { $("#settings-saved").textContent = ""; }, 2500);
    } catch (error) {
      showToast(backendError(error, "guardar los datos de tienda"));
    }
  });

  $("#recent-orders").addEventListener("click", async event => {
    const button = event.target.closest("[data-hide-recent-order]");
    if (!button || !currentUser) return;
    button.disabled = true;
    try {
      const { error } = await supabase.from("orders")
        .update({ recent_hidden: true })
        .eq("id", button.dataset.hideRecentOrder);
      if (error) throw error;
      await loadSellerData(currentUser);
      showToast("Pedido ocultado de Últimos pedidos; sigue disponible en Pedidos.");
    } catch (error) {
      showToast(backendError(error, "ocultar el pedido reciente"));
    } finally {
      button.disabled = false;
    }
  });
  $("#enable-notifications").addEventListener("click", enableSellerNotifications);
  syncNotificationButton();
  $("#inventory-search").addEventListener("input", event => renderInventory(event.target.value));
  $("#order-filters").addEventListener("change", event => {
    const input = event.target.closest("[data-order-filter]");
    if (!input) return;
    if (input.checked) activeOrderFilters.add(input.dataset.orderFilter);
    else activeOrderFilters.delete(input.dataset.orderFilter);
    renderOrders();
  });
  $("#income-period").addEventListener("change", renderIncomeReport);
  $("#schedule-time").addEventListener("change", () => {
    updateScheduleSelectedLabel();
    saveScheduleDraft();
  });
  $("#product-form").elements.unitLabel.addEventListener("change", event => {
    const form = $("#product-form");
    const previousUnitLabel = form.dataset.stockUnitLabel || event.target.value;
    const nextUnitLabel = event.target.value;
    const stockInput = form.elements.stockAmount;
    if (stockInput.value && inventoryUnitFor(previousUnitLabel) === inventoryUnitFor(nextUnitLabel)) {
      const storedAmount = inventoryAmountToStorage(Number(stockInput.value), previousUnitLabel);
      stockInput.value = String(inventoryAmountFromStorage(storedAmount, nextUnitLabel));
    }
    form.dataset.stockUnitLabel = nextUnitLabel;
    const amountInput = $("#product-form").elements.unitAmount;
    updateInventoryUnitHint(nextUnitLabel);
    updateProductPricingHint(nextUnitLabel);
    if (["unidad", "ml", "l", "g", "kg", "lb"].includes(nextUnitLabel)) {
      amountInput.value = "1";
      amountInput.readOnly = true;
    } else {
      amountInput.readOnly = false;
      if (Number(amountInput.value) === 1) amountInput.value = "";
    }
  });
  document.addEventListener("input", event => {
    const target = event.target;
    if (target.matches("[data-measured-quantity]")) {
      const product = data.products.find(entry => String(entry.id) === String(target.dataset.measuredQuantity));
      if (!product) return;
      const quantity = Number(target.value);
      const valid = Number.isFinite(quantity) && quantity > 0 &&
        quantity <= availableSaleAmount(product) &&
        Math.abs(quantity * 1000 - Math.round(quantity * 1000)) <= 1e-8;
      target.setAttribute("aria-invalid", String(!valid));
      const total = $(`[data-measured-total="${CSS.escape(String(product.id))}"]`);
      const button = $(`[data-add-measured="${CSS.escape(String(product.id))}"]`);
      if (total) total.textContent = valid ? money(cartLineTotal(product, quantity)) : "Ingresa una cantidad válida";
      if (button) button.disabled = !valid;
      return;
    }
    if (target.matches("[data-unit-quantity]")) {
      const product = data.products.find(entry => String(entry.id) === String(target.dataset.unitQuantity));
      if (!product) return;
      const quantity = Number(target.value);
      const available = availablePresentations(product);
      const valid = Number.isInteger(quantity) && quantity >= 1 && quantity <= available;
      target.setAttribute("aria-invalid", String(!valid));
      const decrement = $(`[data-unit-step="-1"][data-id="${CSS.escape(String(product.id))}"]`);
      const increment = $(`[data-unit-step="1"][data-id="${CSS.escape(String(product.id))}"]`);
      const addButton = $(`[data-add-unit="${CSS.escape(String(product.id))}"]`);
      if (decrement) decrement.disabled = !valid || quantity <= 1;
      if (increment) increment.disabled = !valid || quantity >= available;
      if (addButton) addButton.disabled = !valid;
      return;
    }
    if (!target.matches("[data-cart-measured-quantity]")) return;
    const item = data.cart.find(entry => String(entry.id) === String(target.dataset.id));
    const product = data.products.find(entry => String(entry.id) === String(target.dataset.id));
    if (!item || !product) return;
    const quantity = Number(target.value);
    const valid = Number.isFinite(quantity) && quantity > 0 &&
      quantity <= availableSaleAmount(product) &&
      Math.abs(quantity * 1000 - Math.round(quantity * 1000)) <= 1e-8;
    target.setAttribute("aria-invalid", String(!valid));
    if (valid) {
      item.quantity = quantity;
      const price = target.closest(".cart-item")?.querySelector(".cart-item-price");
      if (price) price.textContent = money(cartLineTotal(product, quantity));
      saveCart();
    }
    updateCartTotals();
  });
  document.addEventListener("change", event => {
    const target = event.target;
    if (target.matches("[data-cart-measured-quantity][aria-invalid='true']")) {
      renderCart();
      showToast("Ingresa una cantidad válida y disponible.");
    }
  });
  $("#catalog-search").addEventListener("input", event => {
    catalogSearch = event.target.value;
    renderProducts();
  });
  initializePhoneCountrySelector("#checkout-form");
  initializePhoneCountrySelector("#track-form");

  $("#seller-login-form").addEventListener("submit", event => {
    event.preventDefault();
    if (event.currentTarget.reportValidity()) authenticateSeller(event.currentTarget);
  });
  $("#checkout-form").addEventListener("submit", event => {
    event.preventDefault();
    if (event.currentTarget.reportValidity()) submitOrder(event.currentTarget);
  });
  $("#track-form").addEventListener("submit", event => {
    event.preventDefault();
    if (event.currentTarget.reportValidity()) trackOrder(event.currentTarget);
  });

  $("#cancel-tracked-order").addEventListener("click", async event => {
    event.preventDefault();
    const button = event.currentTarget;
    let order;
    try {
      if (!trackingCredentials) throw new Error("Vuelve a consultar el pedido con su PIN.");
      order = await fetchTrackedOrder(trackingCredentials);
    } catch (error) {
      $("#track-error").textContent = backendError(error, "verificar el pedido");
      return;
    }
    if (!canCustomerCancel(order)) {
      button.hidden = true;
      button.dataset.confirming = "";
      button.textContent = "Cancelar pedido";
      $("#track-error").textContent = "Este pedido ya no se puede cancelar desde el seguimiento.";
      return;
    }
    if (button.dataset.confirming !== "true") {
      button.dataset.confirming = "true";
      button.textContent = "Sí, cancelar pedido";
      $("#track-error").textContent = "Vuelve a tocar “Sí, cancelar pedido” para confirmar. Esta acción no se puede deshacer.";
      return;
    }

    button.disabled = true;
    button.dataset.confirming = "";
    button.textContent = "Cancelando pedido…";
    $("#track-error").textContent = "";
    try {
      const { data: cancelled, error } = await supabase.rpc("cancel_customer_store_order", {
        p_pin: trackingCredentials.pin,
        p_customer_email: null
      });
      if (error) throw error;
      if (!cancelled) throw new Error("Supabase no canceló el pedido. Puede tener un comprobante enviado, estar pagado o haber cambiado de estado; vuelve a consultar el PIN.");
      clearInterval(trackingPollTimer);
      trackingPollTimer = null;
      trackingCredentials = null;
      pendingTrackingReceipt = null;
      renderTracking(null);
      button.hidden = true;
      $("#track-error").textContent = "Pedido cancelado. El inventario fue actualizado.";
      try {
        await loadPublicStore();
      } catch (error) {
        console.error("El pedido se canceló, pero no se pudo actualizar el catálogo.", error);
        showToast(backendError(error, "actualizar el catálogo"));
        return;
      }
      showToast("Pedido cancelado.");
    } catch (error) {
      $("#track-error").textContent = backendError(error, "cancelar el pedido");
    } finally {
      button.disabled = false;
      button.textContent = "Cancelar pedido";
    }
  });

  $("#track-dialog").addEventListener("close", () => {
    clearInterval(trackingPollTimer);
    trackingPollTimer = null;
    trackingCredentials = null;
    pendingTrackingReceipt = null;
    $("#cancel-tracked-order").hidden = true;
    $("#cancel-tracked-order").dataset.confirming = "";
    $("#cancel-tracked-order").textContent = "Cancelar pedido";
  });

  $("#schedule-form").addEventListener("submit", event => {
    event.preventDefault();
    if (activeScheduleOrderId !== null && event.currentTarget.reportValidity()) {
      saveSchedule(activeScheduleOrderId);
    }
  });
  $("#schedule-form").addEventListener("change", () => {
    updateScheduleSelectedLabel();
    saveScheduleDraft();
  });
  $("#schedule-dialog").addEventListener("close", () => {
    activeScheduleOrderId = null;
    $("#schedule-save").disabled = false;
  });

  $("#tracking-result").addEventListener("change", event => {
    if (event.target.id !== "tracking-receipt") return;
    const file = event.target.files?.[0] || null;
    $("#track-error").textContent = "";
    if (!file) {
      pendingTrackingReceipt = null;
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) {
      event.target.value = "";
      pendingTrackingReceipt = null;
      $("#track-error").textContent = file.size > 2 * 1024 * 1024
        ? "La imagen supera el límite de 2 MB."
        : "Usa una imagen JPG, PNG o WebP.";
      return;
    }
    pendingTrackingReceipt = file;
    $("#tracking-receipt-name").innerHTML = `<b>${escapeHTML(file.name)}</b><small>Listo para enviar</small>`;
  });

  $("#tracking-result").addEventListener("click", async event => {
    const button = event.target.closest("[data-submit-payment], [data-confirm-received]");
    if (!button || !trackingCredentials) return;
    if (button.hasAttribute("data-submit-payment")) {
      await submitTrackingPayment(button);
      return;
    }
    if (button.hasAttribute("data-confirm-received")) {
      if (trackingCredentials.phoneOnly) return;
      button.disabled = true;
      $("#track-error").textContent = "";
      try {
        const orderBeforeConfirmation = await fetchTrackedOrder(trackingCredentials);
        if (!orderBeforeConfirmation) throw new Error("No encontramos este pedido. Vuelve a consultarlo con tu PIN.");
        const { data: received, error } = await supabase.rpc("confirm_store_order_received", {
          p_pin: trackingCredentials.pin,
          p_customer_email: null
        });
        if (error) throw error;
        if (!received) throw new Error("No se pudo confirmar la recepción. Verifica que el pedido esté programado.");
        if (orderBeforeConfirmation.seller_delivered) {
          trackingCredentials = null;
          clearInterval(trackingPollTimer);
          trackingPollTimer = null;
          $("#cancel-tracked-order").hidden = true;
          $("#tracking-result").innerHTML = '<p class="payment-received-note">Tú y el vendedor confirmaron la entrega. ¡Gracias!</p>';
          $("#tracking-result").hidden = false;
          showToast("Entrega confirmada y archivada.");
        } else {
          await refreshTrackedOrder();
          showToast("Recepción confirmada. El pedido pasará a Entregados cuando el vendedor confirme la entrega.");
        }
      } catch (error) {
        $("#track-error").textContent = backendError(error, "confirmar la recepción");
        button.disabled = false;
      }
      return;
    }
  });

  $("#checkout-dialog").addEventListener("click", event => {
    if (event.target === $("#checkout-dialog")) $("#checkout-dialog").close();
  });
  $("#track-dialog").addEventListener("click", event => {
    if (event.target === $("#track-dialog")) $("#track-dialog").close();
  });
  $("#receipt-dialog").addEventListener("click", event => {
    if (event.target === $("#receipt-dialog")) $("#receipt-dialog").close();
  });
  $("#receipt-dialog").addEventListener("close", () => {
    $("#receipt-preview").removeAttribute("src");
  });
  $("#success-dialog").addEventListener("click", event => {
    if (event.target === $("#success-dialog")) $("#success-dialog").close();
  });
  document.addEventListener("click", event => {
    if (!event.target.closest("#main-menu, #menu-toggle")) closeMenu();
  });

  async function start() {
    if (!backendReady) {
      $("#setup-notice").hidden = false;
      renderStore();
      return;
    }
    try {
      const { data: sessionData, error } = await supabase.auth.getSession();
      if (error) throw error;
      currentUser = sessionData.session?.user || null;
      await loadPublicStore();
      if (currentUser) await loadSellerData(currentUser);
    } catch (error) {
      if (currentUser) {
        currentUser = null;
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) console.error("No se pudo cerrar una sesión sin acceso al panel.", signOutError);
      }
      $("#setup-notice").hidden = false;
      $("#setup-notice").textContent = `No se pudo conectar con Supabase: ${backendError(error, "cargar la tienda")}`;
      renderStore();
    }
  }

  start();
  if (backendReady) window.setInterval(refreshSellerOrders, 30000);

  const installAppButton = $("#install-app-button");
  let installPrompt = null;
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    installAppButton.hidden = false;
  });
  installAppButton.addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    installAppButton.hidden = true;
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    installAppButton.hidden = true;
  });

  if ("serviceWorker" in navigator && isSecureAppOrigin()) {
    navigator.serviceWorker.register("./service-worker.js")
      .catch(error => console.error("No se pudo registrar el modo instalable de Quimera.", error));
  }
})();
