import { Buffer } from "buffer";
import "./style.css";

globalThis.Buffer ??= Buffer;

const LEDGER_KEY = "hacknc-sales-ledger-v1";
const form = document.querySelector("#payment-form");
const paymentPanel = document.querySelector("#payment-panel");
const qrElement = document.querySelector("#qr-code");
const statusElement = document.querySelector("#status");
const resultPanel = document.querySelector("#result-panel");
const receiptDetails = document.querySelector("#receipt-details");
const receiptLink = document.querySelector("#receipt-link");
const explorerLink = document.querySelector("#explorer-link");
const accountingEntry = document.querySelector("#accounting-entry");
const errorElement = document.querySelector("#error");
const ledgerBody = document.querySelector("#ledger-body");
const ledgerEmpty = document.querySelector("#ledger-empty");
const revenueTotal = document.querySelector("#revenue-total");
const itemsContainer = document.querySelector("#items-container");
const editItemsContainer = document.querySelector("#edit-items-container");
const editDialog = document.querySelector("#ledger-editor");
const editForm = document.querySelector("#ledger-edit-form");
let editingSignature = null;

const money = (value) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD",
}).format(Number(value) || 0);

const localDateTime = (value) => new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium", timeStyle: "medium",
}).format(new Date(value));

function getLedger() {
  try {
    const value = JSON.parse(localStorage.getItem(LEDGER_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function persistLedger(entries) {
  try {
    localStorage.setItem(LEDGER_KEY, JSON.stringify(entries));
    return true;
  } catch {
    errorElement.textContent = "Payment is confirmed, but this browser could not save the sales ledger.";
    return false;
  }
}

function parsedOrderId(orderId) {
  const match = String(orderId).match(/^EVENT-(\d+)-ORDER-(\d+)$/i);
  return match ? { event: Number(match[1]), order: Number(match[2]) } : null;
}

function nextOrderId(entries = getLedger()) {
  const latest = [...entries].sort((a, b) => new Date(b.confirmed_at) - new Date(a.confirmed_at));
  const mostRecent = latest.map((entry) => parsedOrderId(entry.order_id)).find(Boolean);
  if (!mostRecent) return "EVENT-001-ORDER-001";
  const highestForEvent = entries
    .map((entry) => parsedOrderId(entry.order_id))
    .filter((parts) => parts && parts.event === mostRecent.event)
    .reduce((highest, parts) => Math.max(highest, parts.order), mostRecent.order);
  return `EVENT-${String(mostRecent.event).padStart(3, "0")}-ORDER-${String(highestForEvent + 1).padStart(3, "0")}`;
}

function isDuplicateOrderId(orderId, exceptSignature = null) {
  return getLedger().some((entry) =>
    entry.signature !== exceptSignature && entry.order_id.trim().toLowerCase() === orderId.trim().toLowerCase()
  );
}

function getItems(container) {
  return [...container.querySelectorAll(".item-row")].map((row) => {
    const itemId = row.querySelector("select").value;
    const quantity = Number(row.querySelector("input[data-field='quantity']").value);
    const unitPrice = Number(row.querySelector("input[data-field='unit-price']").value);
    return { item_id: itemId, quantity, unit_price_usd: unitPrice, total_usd: Math.round(quantity * unitPrice * 100) / 100 };
  });
}

function itemsTotal(items) {
  return Math.round(items.reduce((sum, item) => sum + item.quantity * item.unit_price_usd, 0) * 100) / 100;
}

function createItemRow(container, item = {}, onChange = () => {}) {
  const row = document.createElement("div");
  row.className = "item-row";

  const idLabel = document.createElement("label");
  idLabel.textContent = "Item ID";
  const idSelect = document.createElement("select");
  for (let id = 1; id <= 1000; id += 1) {
    const option = document.createElement("option");
    option.value = String(id).padStart(2, "0");
    option.textContent = option.value;
    idSelect.append(option);
  }
  idSelect.value = String(item.item_id || "01").padStart(2, "0");
  idLabel.append(idSelect);

  const quantityLabel = document.createElement("label");
  quantityLabel.textContent = "Quantity";
  const quantityInput = document.createElement("input");
  quantityInput.type = "number";
  quantityInput.min = "1";
  quantityInput.step = "1";
  quantityInput.required = true;
  quantityInput.dataset.field = "quantity";
  quantityInput.value = String(item.quantity ?? 1);
  quantityLabel.append(quantityInput);

  const priceLabel = document.createElement("label");
  priceLabel.textContent = "Unit price (USD)";
  const priceInput = document.createElement("input");
  priceInput.type = "number";
  priceInput.min = "0";
  priceInput.step = "0.01";
  priceInput.required = true;
  priceInput.dataset.field = "unit-price";
  priceInput.value = String(item.unit_price_usd ?? 0);
  priceLabel.append(priceInput);

  const totalLabel = document.createElement("label");
  totalLabel.textContent = "Item total (USD)";
  const totalOutput = document.createElement("output");
  totalOutput.className = "item-total";
  totalLabel.append(totalOutput);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove-item secondary-button";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => {
    if (container.querySelectorAll(".item-row").length > 1) row.remove();
    refreshItemRows(container, onChange);
  });

  row.append(idLabel, quantityLabel, priceLabel, totalLabel, remove);
  container.append(row);
  for (const control of [idSelect, quantityInput, priceInput]) {
    control.addEventListener("input", () => refreshItemRows(container, onChange));
    control.addEventListener("change", () => refreshItemRows(container, onChange));
  }
  refreshItemRows(container, onChange);
}

function refreshItemRows(container, onChange = () => {}) {
  const rows = [...container.querySelectorAll(".item-row")];
  rows.forEach((row) => {
    const qty = Number(row.querySelector("input[data-field='quantity']").value) || 0;
    const unit = Number(row.querySelector("input[data-field='unit-price']").value) || 0;
    row.querySelector("output").textContent = money(qty * unit);
    row.querySelector(".remove-item").hidden = rows.length === 1;
  });
  onChange();
}

function updateCartTotal() {
  document.querySelector("#cart-total").textContent = money(itemsTotal(getItems(itemsContainer)));
}

function renderLedger() {
  const entries = getLedger();
  ledgerBody.replaceChildren();
  ledgerEmpty.hidden = entries.length > 0;

  for (const entry of entries) {
    const row = document.createElement("tr");
    const items = Array.isArray(entry.items) ? entry.items : [];
    const itemSummary = items.length
      ? items.map((item) => `${item.item_id} × ${item.quantity} @ ${money(item.unit_price_usd)}`).join("; ")
      : "—";
    const cells = [
      localDateTime(entry.confirmed_at),
      entry.order_id,
      itemSummary,
      money(entry.revenue_usd),
      `${entry.amount_sol} SOL`,
      entry.note || "—",
      `Dr Demo Payment Clearing ${money(entry.revenue_usd)} / Cr Sales Revenue ${money(entry.revenue_usd)}`,
    ];
    for (const value of cells) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    const actionCell = document.createElement("td");
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "secondary-button edit-ledger";
    editButton.textContent = "Edit";
    editButton.dataset.signature = entry.signature;
    actionCell.append(editButton);
    row.append(actionCell);
    ledgerBody.append(row);
  }

  const total = entries.reduce((sum, entry) => sum + Number(entry.revenue_usd || 0), 0);
  revenueTotal.textContent = `Total recorded revenue: ${money(total)}`;
}

function openLedgerEditor(signature) {
  const entry = getLedger().find((item) => item.signature === signature);
  if (!entry) return;
  editingSignature = signature;
  document.querySelector("#edit-order-id").value = entry.order_id;
  document.querySelector("#edit-note").value = entry.note || "";
  editItemsContainer.replaceChildren();
  const oldItems = Array.isArray(entry.items) && entry.items.length
    ? entry.items
    : [{ item_id: "01", quantity: 1, unit_price_usd: Number(entry.revenue_usd) || 0 }];
  oldItems.forEach((item) => createItemRow(editItemsContainer, item, updateEditTotal));
  document.querySelector("#edit-error").textContent = "";
  editDialog.showModal();
}

function updateEditTotal() {
  document.querySelector("#edit-total").textContent = money(itemsTotal(getItems(editItemsContainer)));
}

function renderReceipt(paymentResult, transactionUrl) {
  const itemLines = paymentResult.items.map((item) =>
    `${item.item_id} × ${item.quantity} @ ${money(item.unit_price_usd)} = ${money(item.total_usd)}`
  );
  const fields = [
    ["Order ID", paymentResult.order_id],
    ["Items", itemLines.join("; ")],
    ["Revenue (USD)", money(paymentResult.cart_total_usd)],
    ["Devnet test payment", `${paymentResult.payment.amount_sol.toFixed(2)} SOL`],
    ["Note", paymentResult.note || "—"],
    ["Status", "Confirmed on Solana Devnet"],
    ["Date and time", localDateTime(paymentResult.payment.confirmed_at)],
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
  accountingEntry.textContent = `Demo accounting entry: Dr Demo Payment Clearing ${money(paymentResult.cart_total_usd)}; Cr Sales Revenue ${money(paymentResult.cart_total_usd)}. COGS/profit are not calculated because inventory cost is not entered.`;

  const receiptHtml = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Receipt ${escapeHtml(paymentResult.order_id)}</title><style>body{font:16px system-ui,sans-serif;max-width:720px;margin:40px auto;padding:24px;color:#10251f}h1{color:#087f5b}.row{padding:12px 0;border-bottom:1px solid #d8e8e0}.label{font-weight:700;display:block;margin-bottom:4px}.value{overflow-wrap:anywhere}a{color:#086b9c}.note{color:#52665f}@media print{button{display:none}}</style><h1>Payment receipt</h1><p>Payment successfully received on Solana Devnet.</p>${fields.map(([label,value])=>`<div class="row"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span></div>`).join("")}<p class="note">Accounting entry: Dr Demo Payment Clearing ${escapeHtml(money(paymentResult.cart_total_usd))}; Cr Sales Revenue ${escapeHtml(money(paymentResult.cart_total_usd))}. Test SOL is recorded separately and is not converted to USD.</p><p><a href="${escapeHtml(transactionUrl)}" target="_blank" rel="noopener">View transaction on Solana Explorer</a></p><button onclick="window.print()">Print / Save receipt</button></html>`;
  if (receiptLink.dataset.blobUrl) URL.revokeObjectURL(receiptLink.dataset.blobUrl);
  const blobUrl = URL.createObjectURL(new Blob([receiptHtml], { type: "text/html" }));
  receiptLink.href = blobUrl;
  receiptLink.dataset.blobUrl = blobUrl;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function clearSaleForm() {
  document.querySelector("#checkout-note").value = "";
  document.querySelector("#sol-amount").value = "0.01";
  itemsContainer.replaceChildren();
  createItemRow(itemsContainer, {}, updateCartTotal);
  document.querySelector("#cart-total").textContent = money(0);
  document.querySelector("#order-id").value = nextOrderId();
}

errorElement.textContent = "";
form.dataset.checkoutReady = "true";
document.querySelector("#order-id").value = nextOrderId();
createItemRow(itemsContainer, {}, updateCartTotal);
renderLedger();

document.querySelector("#add-item").addEventListener("click", () => {
  createItemRow(itemsContainer, {}, updateCartTotal);
});
document.querySelector("#edit-add-item").addEventListener("click", () => {
  createItemRow(editItemsContainer, {}, updateEditTotal);
});
document.querySelector("#cancel-edit").addEventListener("click", () => editDialog.close());
ledgerBody.addEventListener("click", (event) => {
  const button = event.target.closest(".edit-ledger");
  if (button) openLedgerEditor(button.dataset.signature);
});

editForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const error = document.querySelector("#edit-error");
  const orderId = document.querySelector("#edit-order-id").value.trim();
  const items = getItems(editItemsContainer);
  const total = itemsTotal(items);
  if (isDuplicateOrderId(orderId, editingSignature)) {
    error.textContent = "That order ID is already in the sales ledger.";
    return;
  }
  if (!orderId || !items.length || items.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1 || item.unit_price_usd < 0) || total <= 0) {
    error.textContent = "Enter a unique order ID and at least one item with a positive total.";
    return;
  }
  const entries = getLedger().map((entry) => entry.signature === editingSignature
    ? { ...entry, order_id: orderId, note: document.querySelector("#edit-note").value.trim(), items, revenue_usd: total }
    : entry);
  if (persistLedger(entries)) {
    editDialog.close();
    renderLedger();
    document.querySelector("#order-id").value = nextOrderId(entries);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorElement.textContent = "";
  resultPanel.hidden = true;

  const merchantWallet = import.meta.env.VITE_MERCHANT_WALLET;
  if (!merchantWallet || merchantWallet.includes("PASTE_")) {
    errorElement.textContent = "Add a valid VITE_MERCHANT_WALLET to your .env file first.";
    return;
  }

  const orderId = document.querySelector("#order-id").value.trim();
  const items = getItems(itemsContainer);
  const cartTotalUsd = itemsTotal(items);
  const solAmount = Number(document.querySelector("#sol-amount").value);
  if (isDuplicateOrderId(orderId)) {
    errorElement.textContent = "That order ID is already in the sales ledger. Use the next order ID.";
    return;
  }
  if (!Number.isFinite(cartTotalUsd) || cartTotalUsd <= 0 || items.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1 || item.unit_price_usd < 0)) {
    errorElement.textContent = "Add at least one valid item and make sure the cart total is greater than $0.";
    return;
  }
  if (!Number.isFinite(solAmount) || solAmount < 0.01 || Math.abs(solAmount * 100 - Math.round(solAmount * 100)) > 1e-8) {
    errorElement.textContent = "Test SOL amount must be at least 0.01 and use 0.01 increments.";
    return;
  }

  try {
    const { createSolanaPaymentRequest, explorerUrl, renderPaymentQR, waitForSolanaPayment } = await import("./solanaPay.js");
    const request = createSolanaPaymentRequest({ merchantWallet, solAmount: solAmount.toFixed(2), orderId });
    renderPaymentQR(request.url, qrElement);
    paymentPanel.hidden = false;
    statusElement.textContent = "Waiting for a confirmed Devnet payment…";

    const signature = await waitForSolanaPayment(request);
    const confirmedAt = new Date().toISOString();
    const transactionUrl = explorerUrl(signature);
    const note = document.querySelector("#checkout-note").value.trim();
    const paymentResult = {
      order_id: orderId,
      cart_total_usd: cartTotalUsd,
      items,
      note,
      payment: {
        method: "solana_pay",
        network: request.network,
        status: "confirmed",
        amount_sol: solAmount,
        merchant_wallet: merchantWallet,
        reference: request.reference.toBase58(),
        signature,
        confirmed_at: confirmedAt,
      },
    };

    statusElement.textContent = "Payment successfully received!";
    explorerLink.href = transactionUrl;
    renderReceipt(paymentResult, transactionUrl);
    const entries = getLedger();
    if (!entries.some((entry) => entry.signature === signature)) {
      entries.unshift({
        order_id: orderId,
        revenue_usd: cartTotalUsd,
        amount_sol: solAmount,
        signature,
        confirmed_at: confirmedAt,
        note,
        items,
      });
      persistLedger(entries);
    }
    renderLedger();
    resultPanel.hidden = false;
    window.dispatchEvent(new CustomEvent("solana-payment-confirmed", { detail: paymentResult }));
    clearSaleForm();
  } catch (error) {
    statusElement.textContent = "Payment not confirmed";
    errorElement.textContent = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error("Solana Pay checkout error:", error);
  }
});
