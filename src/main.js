import { Buffer } from "buffer";
import "./style.css";
import {
  getCheckoutEvents,
  getCheckoutItem,
  getCheckoutItemsForEvent,
  recordConfirmedSale,
} from "./bazaarlySales.js";

globalThis.Buffer ??= Buffer;

const DEMO_SOL_AMOUNT = "0.01";
const form = document.querySelector("#payment-form");
const eventIdInput = document.querySelector("#event-id");
const itemsContainer = document.querySelector("#items-container");
const addItemButton = document.querySelector("#add-item");
const payButton = document.querySelector("#pay-button");
const paymentPanel = document.querySelector("#payment-panel");
const qrElement = document.querySelector("#qr-code");
const statusElement = document.querySelector("#status");
const resultPanel = document.querySelector("#result-panel");
const receiptDetails = document.querySelector("#receipt-details");
const explorerLink = document.querySelector("#explorer-link");
const accountingEntry = document.querySelector("#accounting-entry");
const errorElement = document.querySelector("#error");
const cartTotalElement = document.querySelector("#cart-total");
const checkoutContext = document.querySelector("#checkout-context");
const retrySaveButton = document.querySelector("#retry-save");

let confirmedPayment = null;
let isSaving = false;
let saleSaved = false;
let checkoutEvents = [];
let availableItems = [];
let eventLoad = 0;
let itemRowCounter = 0;

const money = (value) => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
}).format(value);

function rows() {
  return [...itemsContainer.querySelectorAll(".item-row")];
}

function getValidItems() {
  return rows().map((row) => {
    if (row.dataset.valid !== "true") return null;
    return {
      inventoryItemId: row.dataset.itemId,
      title: row.dataset.title,
      price: Number(row.dataset.price),
    };
  }).filter(Boolean);
}

function updateCartTotal() {
  const loadedItems = getValidItems();
  const totalCents = loadedItems.reduce((sum, item) => sum + Math.round(item.price * 100), 0);
  cartTotalElement.textContent = money(totalCents / 100);
  const count = loadedItems.length;
  document.querySelector("#item-count").textContent = `${count} ${count === 1 ? "item" : "items"}`;

  const hasPendingLookups = rows().some(row => row.dataset.loading === "true");
  const hasInvalidRows = rows().some(row => row.dataset.valid !== "true");
  payButton.disabled = saleSaved || isSaving || !eventIdInput.value ||
    loadedItems.length === 0 || hasPendingLookups || hasInvalidRows;
  addItemButton.disabled = saleSaved || isSaving || !eventIdInput.value || availableItems.length === 0;
}

function setCheckoutInputsDisabled(disabled) {
  eventIdInput.disabled = disabled;
  addItemButton.disabled = disabled;
  for (const row of rows()) {
    row.querySelector("[data-field='item-id']").disabled = disabled || availableItems.length === 0;
    row.querySelector(".remove-item").disabled = disabled;
  }
}

async function resolveItem(row) {
  const input = row.querySelector("[data-field='item-id']");
  const status = row.querySelector(".item-status");
  status.dataset.kind = "";
  const itemId = input.value;
  const eventId = eventIdInput.value;
  const lookup = (row.lookup ?? 0) + 1;
  row.lookup = lookup;
  row.dataset.valid = "false";
  delete row.dataset.itemId;
  delete row.dataset.price;
  delete row.dataset.title;

  if (!itemId) {
    row.dataset.loading = "false";
    status.textContent = "Choose an item to add it to your order.";
    updateCartTotal();
    return;
  }
  if (!eventId) {
    row.dataset.loading = "false";
    status.textContent = "Choose an event first.";
    updateCartTotal();
    return;
  }

  row.dataset.loading = "true";
  status.textContent = "Confirming item and price…";
  updateCartTotal();
  try {
    const item = await getCheckoutItem(eventId, itemId);
    if (row.lookup !== lookup) return;
    row.dataset.itemId = item.inventoryItemId;
    row.dataset.price = String(item.price);
    row.dataset.title = item.title;
    row.dataset.valid = "true";
    status.dataset.kind = "success";
    status.textContent = `${item.title} · ${money(item.price)}`;
    const preview = row.querySelector(".item-preview");
    preview.replaceChildren();
    if (item.imageUrl) {
      const image = document.createElement("img");
      image.src = item.imageUrl;
      image.alt = "";
      image.loading = "lazy";
      image.addEventListener("error", () => {
        preview.textContent = "No image";
      }, { once: true });
      preview.append(image);
    } else {
      preview.textContent = "No image";
    }
  } catch (error) {
    if (row.lookup !== lookup) return;
    status.dataset.kind = "error";
    status.textContent = error instanceof Error ? error.message : "Could not load this item.";
  } finally {
    if (row.lookup === lookup) {
      row.dataset.loading = "false";
      updateCartTotal();
    }
  }
}

function createItemRow(itemId = "", loading = false) {
  const row = document.createElement("div");
  row.className = "item-row";

  const preview = document.createElement("div");
  preview.className = "item-preview";
  preview.textContent = "Item photo";

  const fields = document.createElement("div");
  fields.className = "item-fields";
  const label = document.createElement("label");
  label.textContent = "Choose an item";
  const input = document.createElement("select");
  input.required = true;
  input.dataset.field = "item-id";
  input.add(new Option(loading ? "Loading available items…" : "Select an item", ""));
  for (const item of availableItems) {
    input.add(new Option(`${item.title} · ${money(item.price)}`, item.inventoryItemId));
  }
  input.value = availableItems.some(item => item.inventoryItemId === itemId) ? itemId : "";
  input.disabled = loading || availableItems.length === 0;
  label.htmlFor = `item-select-${++itemRowCounter}`;
  input.id = label.htmlFor;
  label.append(input);

  const status = document.createElement("p");
  status.className = "item-status";
  status.setAttribute("role", "status");
  status.textContent = loading
    ? "Loading items for this event…"
    : availableItems.length === 0
      ? "No approved items are currently available at this event."
      : "Choose an item to see it and its price.";
  if (itemId && !input.value && !loading) {
    status.textContent = "This item is no longer available at this event. Choose a replacement or remove it.";
    status.dataset.kind = "error";
  }

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "secondary-button remove-item";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => {
    row.remove();
    if (rows().length === 0) createItemRow();
    updateCartTotal();
  });

  fields.append(label, status);
  row.append(preview, fields, remove);
  itemsContainer.append(row);
  input.addEventListener("change", () => {
    preview.replaceChildren();
    preview.textContent = "Item photo";
    status.dataset.kind = "";
    void resolveItem(row);
  });
  if (itemId && input.value) void resolveItem(row);
  updateCartTotal();
}

async function loadItemsForEvent(eventId, selectedItemIds = []) {
  const currentLoad = ++eventLoad;
  availableItems = [];
  itemsContainer.replaceChildren();
  createItemRow("", true);
  errorElement.textContent = "";
  if (!eventId) {
    itemsContainer.replaceChildren();
    createItemRow();
    checkoutContext.textContent = "Choose an event to see its available items and current USD prices.";
    updateCartTotal();
    return;
  }
  checkoutContext.textContent = "Loading items available at this event…";
  updateCartTotal();

  try {
    const items = await getCheckoutItemsForEvent(eventId);
    if (currentLoad !== eventLoad) return;
    availableItems = items;
    itemsContainer.replaceChildren();
    if (selectedItemIds.length > 0) {
      selectedItemIds.forEach(itemId => createItemRow(itemId));
      const unavailableCount = selectedItemIds.filter(itemId => (
        !items.some(item => item.inventoryItemId === itemId)
      )).length;
      if (unavailableCount > 0) {
        errorElement.textContent = `${unavailableCount} item(s) passed from Bazaarly are no longer available. Choose a replacement or remove the empty item row.`;
      }
    } else {
      createItemRow();
    }
    checkoutContext.textContent = items.length > 0
      ? `${items.length} item${items.length === 1 ? "" : "s"} currently available. Item prices are loaded from Bazaarly inventory in USD.`
      : "There are no approved items available at this event right now.";
  } catch (error) {
    if (currentLoad !== eventLoad) return;
    itemsContainer.replaceChildren();
    createItemRow();
    errorElement.textContent = error instanceof Error
      ? `Could not load items for this event: ${error.message}`
      : "Could not load items for this event.";
    checkoutContext.textContent = "Try selecting the event again or contact the event organizer.";
  }
  updateCartTotal();
}

async function setItemsFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const requestedEventId = params.get("eventId") ?? "";
  const requestedItemIds = params.getAll("itemId");
  eventIdInput.replaceChildren(new Option("Choose an event", ""));
  eventIdInput.disabled = true;
  checkoutContext.textContent = "Loading upcoming Bazaarly events…";
  try {
    checkoutEvents = await getCheckoutEvents();
    for (const event of checkoutEvents) {
      const date = event.date ? new Date(event.date) : null;
      const dateLabel = date && !Number.isNaN(date.getTime())
        ? ` · ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
        : "";
      const option = new Option(`${event.name}${dateLabel}`, event.eventId);
      option.dataset.eventName = event.name;
      eventIdInput.add(option);
    }
    eventIdInput.disabled = false;

    if (requestedEventId && checkoutEvents.some(event => event.eventId === requestedEventId)) {
      eventIdInput.value = requestedEventId;
      await loadItemsForEvent(requestedEventId, requestedItemIds);
    } else {
      createItemRow();
      if (requestedEventId) {
        errorElement.textContent = "The event sent from Bazaarly is no longer available. Please choose an upcoming event.";
      }
      checkoutContext.textContent = checkoutEvents.length > 0
        ? "Choose an event to see its available items and current USD prices."
        : "There are no upcoming events available for checkout.";
    }
  } catch (error) {
    eventIdInput.disabled = false;
    createItemRow();
    errorElement.textContent = error instanceof Error
      ? `Could not load upcoming events: ${error.message}`
      : "Could not load upcoming events.";
    checkoutContext.textContent = "Refresh the page to try loading events again.";
  }
  updateCartTotal();
}

function displayReceipt(paymentResult, sale) {
  const fields = [
    ["Event", paymentResult.eventName],
    ["Items purchased", sale.items.map(item => `${item.title} · ${money(item.price)}`).join(", ")],
    ["Items sold", String(sale.itemCount)],
    ["Items subtotal", money(sale.grossRevenue)],
    ["Test payment", `${paymentResult.payment.amount_sol.toFixed(2)} SOL`],
    ["Status", "Confirmed on Solana Devnet"],
  ];
  receiptDetails.replaceChildren();
  for (const [label, value] of fields) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    receiptDetails.append(term, description);
  }
  accountingEntry.textContent =
    `Demo accounting entry: USD revenue ${money(sale.grossRevenue)}. ` +
    "The fixed 0.01 Devnet SOL amount is test payment only and is not converted to USD.";
  explorerLink.href = `https://explorer.solana.com/tx/${paymentResult.payment.signature}?cluster=devnet`;
  resultPanel.hidden = false;
  retrySaveButton.hidden = true;
}

async function saveConfirmedSale() {
  if (!confirmedPayment || isSaving) return;
  isSaving = true;
  retrySaveButton.disabled = true;
  errorElement.textContent = "";
  statusElement.textContent = "Payment confirmed. Saving sale to Bazaarly…";
  try {
    const sale = await recordConfirmedSale({
      eventId: confirmedPayment.eventId,
      itemIds: confirmedPayment.itemIds,
      payment: confirmedPayment.payment,
    });
    saleSaved = true;
    setCheckoutInputsDisabled(true);
    displayReceipt(confirmedPayment, sale);
    statusElement.textContent = "Payment confirmed and sale saved to Bazaarly.";
  } catch (error) {
    statusElement.textContent = "Payment confirmed, but Bazaarly could not save the sale.";
    errorElement.textContent =
      `${error instanceof Error ? error.message : "Unknown Firestore error"} ` +
      `Do not pay again. Transaction signature: ${confirmedPayment.payment.signature}.`;
    resultPanel.hidden = false;
    retrySaveButton.hidden = false;
  } finally {
    isSaving = false;
    retrySaveButton.disabled = false;
    updateCartTotal();
    payButton.textContent = saleSaved ? "Sale recorded" : confirmedPayment ? "Retry saving confirmed sale" : "Create Solana Pay QR";
  }
}

eventIdInput.addEventListener("change", () => {
  void loadItemsForEvent(eventIdInput.value);
});
addItemButton.addEventListener("click", () => createItemRow());
retrySaveButton.addEventListener("click", () => { void saveConfirmedSale(); });

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorElement.textContent = "";
  resultPanel.hidden = true;

  if (confirmedPayment) {
    await saveConfirmedSale();
    return;
  }

  const merchantWallet = import.meta.env.VITE_MERCHANT_WALLET;
  if (!merchantWallet || merchantWallet.includes("PASTE_")) {
    errorElement.textContent = "Add a valid VITE_MERCHANT_WALLET to your .env file first.";
    return;
  }

  const eventId = eventIdInput.value;
  const eventName = eventIdInput.selectedOptions[0]?.dataset.eventName ??
    eventIdInput.selectedOptions[0]?.textContent ??
    "Bazaarly event";
  const items = getValidItems();
  const allRowsValid = rows().length > 0 && rows().every(row => row.dataset.valid === "true");
  if (!eventId || !allRowsValid || items.length !== rows().length) {
    errorElement.textContent = "Load a valid upcoming event and every assigned inventory item before checkout.";
    return;
  }
  if (new Set(items.map(item => item.inventoryItemId)).size !== items.length) {
    errorElement.textContent = "The same item is selected more than once. Remove the duplicate before checkout.";
    return;
  }

  payButton.disabled = true;
  setCheckoutInputsDisabled(true);
  payButton.textContent = "Waiting for payment…";
  try {
    const { createSolanaPaymentRequest, renderPaymentQR, waitForSolanaPayment } =
      await import("./solanaPay.js");
    const orderId = `BAZAARLY-${crypto.randomUUID()}`;
    const request = createSolanaPaymentRequest({
      merchantWallet,
      solAmount: DEMO_SOL_AMOUNT,
      orderId,
    });
    renderPaymentQR(request.url, qrElement);
    paymentPanel.hidden = false;
    statusElement.textContent = "Waiting for a confirmed Devnet payment…";

    const signature = await waitForSolanaPayment(request);
    confirmedPayment = {
      eventId,
      eventName,
      itemIds: items.map(item => item.inventoryItemId),
      payment: {
        method: "solana_pay",
        network: request.network,
        status: "confirmed",
        amount_sol: Number(DEMO_SOL_AMOUNT),
        merchant_wallet: merchantWallet,
        reference: request.reference.toBase58(),
        signature,
        confirmed_at: new Date().toISOString(),
      },
    };
    await saveConfirmedSale();
  } catch (error) {
    statusElement.textContent = "Payment was not confirmed.";
    errorElement.textContent = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error("Solana Pay checkout error:", error);
  } finally {
    if (!confirmedPayment) setCheckoutInputsDisabled(false);
    updateCartTotal();
    if (!confirmedPayment) payButton.textContent = "Create Solana Pay QR";
  }
});

setItemsFromUrl();
