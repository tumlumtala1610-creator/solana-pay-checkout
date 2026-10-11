# Bazaarly Solana Pay checkout

This Vite app is the Devnet payment page launched from Bazaarly's kiosk.

## Local development

1. Install dependencies with `npm install`.
2. Set `VITE_MERCHANT_WALLET` in `.env` to the public key receiving Devnet test SOL.
3. Start Bazaarly and this app in separate terminals. The checkout app listens on `http://localhost:5174/`.
4. Set Bazaarly's `VITE_SOLANA_CHECKOUT_URL=http://localhost:5174/` in its `.env.local`.
5. Add approved inventory to an upcoming event in Bazaarly, then start Customer Display. Customers can select the event and available items from readable dropdowns.

The Bazaarly kiosk passes its Firestore event ID and inventory document IDs in the checkout URL so the payment page can preselect the event and items. Those IDs are not shown to customers. The page loads upcoming event names and approved items assigned to the selected event; each item shows its name, current USD price, and photo when available. Standalone use uses the same event and item dropdowns. Prices come from Firestore and cannot be manually changed.

## Demo payment and sales behavior

- Each checkout requests a fixed `0.01 SOL` on Solana Devnet. This test amount is not an exchange-rate conversion and does not determine USD revenue.
- The USD revenue amount comes from the Firestore inventory prices.
- After the Solana Pay transfer is confirmed, a Firestore transaction verifies the event and items, marks the items sold, increments `events/{eventId}.grossRevenue`, and creates a `sales/{transactionSignature}` record.
- The transaction signature is the sale document ID, making repeated persistence attempts idempotent.
- If payment confirms but Firestore cannot save the sale, the page shows the signature and allows retrying the Firestore write without initiating another payment.

This is a client-side hackathon demo, not a production payment system. Firestore security rules and server-side payment verification should be hardened before production use.
