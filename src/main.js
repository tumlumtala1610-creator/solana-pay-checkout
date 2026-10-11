import { Buffer } from "buffer";
import "./style.css";
import {
  getCheckoutEvents,
  getCheckoutItem,
  recordConfirmedSale,
} from "./bazaarlySales.js";

globalThis.Buffer ??= Buffer;

const DEMO_SOL_AMOUNT = "0.01";
const form = document.querySelector("#payment-form");
const itemsContainer = document.querySelector("#items-container");
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
const checkoutEventElement = document.querySelector("#checkout-event");
const retrySaveButton = document.querySelector("#retry-save");

let confirmedPayment = null;
let isSaving = false;
let saleSaved = false;
let eventId = "";
let eventName = "";

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
  payButton.disabled = saleSaved || isSaving || !eventId ||
    loadedItems.length === 0 || hasPendingLookups || hasInvalidRows;
}

// Looks up the price/details for one item passed in from Bazaarly.
async function resolveItem(row, itemId) {
  const status = row.querySelector(".item-status");
  const title = row.querySelector(".item-title");
  const price = row.querySelector(".item-price");
  row.dataset.valid = "false";
  row.dataset.loading = "true";
  status.dataset.kind = "";
  status.textContent = "Confirming item and price…";
  updateCartTotal();
  try {
    const item = await getCheckoutItem(eventId, itemId);
    row.dataset.itemId = item.inventoryItemId;
    row.dataset.price = String(item.price);
    row.dataset.title = item.title;
    row.dataset.valid = "true";
    status.dataset.kind = "success";
    status.textContent = "";
    title.textContent = item.title;
    price.textContent = money(item.price);
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
    status.dataset.kind = "error";
    status.textContent = error instanceof Error
      ? error.message
      : "This item is no longer available.";
    errorElement.textContent =
      "An item in your order could not be confirmed. Please return to Bazaarly and start checkout again.";
  } finally {
    row.dataset.loading = "false";
    updateCartTotal();
  }
}

// Read-only row: no select, no remove button.
function createItemRow(itemId) {
  const row = document.createElement("div");
  row.className = "item-row";

  const preview = document.createElement("div");
  preview.className = "item-preview";
  preview.textContent = "Item photo";

  const fields = document.createElement("div");
  fields.className = "item-fields";
  const title = document.createElement("p");
  title.className = "item-title";
  const status = document.createElement("p");
  status.className = "item-status";
  status.setAttribute("role", "status");
  fields.append(title, status);

  const price = document.createElement("p");
  price.className = "item-price";

  row.append(preview, fields, price);
  itemsContainer.append(row);
  void resolveItem(row, itemId);
}

// The event and items are fixed by the URL Bazaarly sends the customer to.
async function loadCheckoutFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const requestedEventId = params.get("eventId") ?? "";
  const requestedItemIds = params.getAll("itemId");

  if (!requestedEventId || requestedItemIds.length === 0) {
    errorElement.textContent =
      "No order was found. Please return to Bazaarly and start checkout again.";
    updateCartTotal();
    return;
  }

  checkoutContext.textContent = "Loading your order…";
  try {
    const checkoutEvents = await getCheckoutEvents();
    const event = checkoutEvents.find(e => e.eventId === requestedEventId);
    if (!event) {
      errorElement.textContent =
        "The event for this order is no longer available for checkout. Please return to Bazaarly.";
      checkoutContext.textContent = "";
      updateCartTotal();
      return;
    }
    eventId = event.eventId;
    eventName = event.name;
    checkoutEventElement.textContent = event.name;
    checkoutContext.textContent = "Item prices are loaded from Bazaarly inventory in USD.";
    requestedItemIds.forEach(itemId => createItemRow(itemId));
  } catch (error) {
    errorElement.textContent = error instanceof Error
      ? `Could not load your order: ${error.message}`
      : "Could not load your order.";
    checkoutContext.textContent = "Refresh the page to try again.";
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

  const items = getValidItems();
  const allRowsValid = rows().length > 0 && rows().every(row => row.dataset.valid === "true");
  if (!eventId || !allRowsValid || items.length !== rows().length) {
    errorElement.textContent = "Load a valid upcoming event and every assigned inventory item before checkout.";
    return;
  }
  if (new Set(items.map(item => item.inventoryItemId)).size !== items.length) {
    errorElement.textContent = "The same item is in this order more than once. Please return to Bazaarly and start checkout again.";
    return;
  }

  payButton.disabled = true;
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
    requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      paymentPanel.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    });

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
    updateCartTotal();
    if (!confirmedPayment) payButton.textContent = "Create Solana Pay QR";
  }
});

loadCheckoutFromUrl();