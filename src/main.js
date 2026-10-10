import { Buffer } from "buffer";
import "./style.css";
import { getCheckoutItem, recordConfirmedSale } from "./bazaarlySales.js";

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

  const hasPendingLookups = rows().some(row => row.dataset.loading === "true");
  const hasInvalidRows = rows().some(row => row.dataset.valid !== "true");
  payButton.disabled = saleSaved || isSaving || !eventIdInput.value.trim() ||
    loadedItems.length === 0 || hasPendingLookups || hasInvalidRows;
}

function setCheckoutInputsDisabled(disabled) {
  eventIdInput.disabled = disabled;
  addItemButton.disabled = disabled;
  for (const row of rows()) {
    row.querySelector("[data-field='item-id']").disabled = disabled;
    row.querySelector(".remove-item").disabled = disabled;
  }
}

function invalidateItemsForEventChange() {
  for (const row of rows()) {
    row.dataset.valid = "false";
    row.dataset.loading = "true";
    row.querySelector(".item-status").textContent = "Verifying item for selected event…";
  }
  updateCartTotal();
}

async function resolveItem(row) {
  const input = row.querySelector("[data-field='item-id']");
  const status = row.querySelector(".item-status");
  const itemId = input.value.trim();
  const eventId = eventIdInput.value.trim();
  const lookup = (row.lookup ?? 0) + 1;
  row.lookup = lookup;
  row.dataset.valid = "false";
  delete row.dataset.itemId;
  delete row.dataset.price;
  delete row.dataset.title;

  if (!itemId) {
    row.dataset.loading = "false";
    status.textContent = "Enter an inventory ID.";
    updateCartTotal();
    return;
  }
  if (!eventId) {
    row.dataset.loading = "false";
    status.textContent = "Enter or select an event ID first.";
    updateCartTotal();
    return;
  }

  row.dataset.loading = "true";
  status.textContent = "Looking up item…";
  updateCartTotal();
  try {
    const item = await getCheckoutItem(eventId, itemId);
    if (row.lookup !== lookup) return;
    row.dataset.itemId = item.inventoryItemId;
    row.dataset.price = String(item.price);
    row.dataset.title = item.title;
    row.dataset.valid = "true";
    status.textContent = `${item.title} · ${money(item.price)}`;
  } catch (error) {
    if (row.lookup !== lookup) return;
    status.textContent = error instanceof Error ? error.message : "Could not load this item.";
  } finally {
    if (row.lookup === lookup) {
      row.dataset.loading = "false";
      updateCartTotal();
    }
  }
}

function createItemRow(itemId = "") {
  const row = document.createElement("div");
  row.className = "item-row";

  const label = document.createElement("label");
  label.textContent = "Bazaarly inventory item ID";
  const input = document.createElement("input");
  input.type = "text";
  input.autocomplete = "off";
  input.placeholder = "Paste item ID";
  input.required = true;
  input.dataset.field = "item-id";
  input.value = itemId;
  label.append(input);

  const status = document.createElement("p");
  status.className = "item-status";
  status.setAttribute("role", "status");
  status.textContent = itemId ? "Looking up item…" : "Enter an item ID to load its USD price.";

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "secondary-button remove-item";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => {
    row.remove();
    if (rows().length === 0) createItemRow();
    updateCartTotal();
  });

  row.append(label, status, remove);
  itemsContainer.append(row);
  input.addEventListener("input", () => {
    window.clearTimeout(row.lookupTimer);
    row.lookupTimer = window.setTimeout(() => { void resolveItem(row); }, 350);
  });
  input.addEventListener("change", () => { void resolveItem(row); });
  if (itemId) void resolveItem(row);
  updateCartTotal();
}

function setItemsFromUrl() {
  const params = new URLSearchParams(window.location.search);
  eventIdInput.value = params.get("eventId") ?? "";
  const itemIds = params.getAll("itemId");
  if (itemIds.length > 0) {
    itemIds.forEach(createItemRow);
  } else {
    createItemRow();
  }
  checkoutContext.textContent = eventIdInput.value
    ? "Event and selected item IDs were passed from Bazaarly. Prices are loaded directly from Firestore."
    : "Enter the event ID and inventory item IDs from the Bazaarly dashboard.";
}

function displayReceipt(paymentResult, sale) {
  const fields = [
    ["Event ID", sale.eventId],
    ["Items sold", String(sale.itemCount)],
    ["Revenue (USD)", money(sale.grossRevenue)],
    ["Test payment", `${paymentResult.payment.amount_sol.toFixed(2)} SOL`],
    ["Status", "Confirmed on Solana Devnet"],
    ["Transaction signature", paymentResult.payment.signature],
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
  for (const row of rows()) void resolveItem(row);
  updateCartTotal();
});
eventIdInput.addEventListener("input", () => {
  invalidateItemsForEventChange();
  window.clearTimeout(eventIdInput.lookupTimer);
  eventIdInput.lookupTimer = window.setTimeout(() => {
    for (const row of rows()) void resolveItem(row);
  }, 350);
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

  const eventId = eventIdInput.value.trim();
  const items = getValidItems();
  const allRowsValid = rows().length > 0 && rows().every(row => row.dataset.valid === "true");
  if (!eventId || !allRowsValid || items.length !== rows().length) {
    errorElement.textContent = "Load a valid upcoming event and every assigned inventory item before checkout.";
    return;
  }
  if (new Set(items.map(item => item.inventoryItemId)).size !== items.length) {
    errorElement.textContent = "Remove duplicate item IDs before checkout.";
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
