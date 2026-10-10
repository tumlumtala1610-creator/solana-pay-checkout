# Solana Pay checkout demo

This is a small Vite demo for the event inventory app. It:

1. creates a unique Solana Pay transfer request;
2. renders the request as a QR code;
3. polls Solana Devnet for the unique checkout reference;
4. validates the recipient, amount, and reference;
5. returns a transaction signature and a JSON payment object.

## Run it

```bash
cp .env.example .env
npm install
npm run dev
```

Before starting, replace `PASTE_DEVNET_MERCHANT_PUBLIC_KEY_HERE` in `.env` with the public key of the wallet receiving the test payment.

The paying wallet must be configured for Solana Devnet and funded with test SOL. Scan the QR, approve the payment, and keep the page open while it waits for confirmation.

## Connect it to the team's checkout

The reusable functions are in `src/solanaPay.js`. The page also emits this browser event after validation:

```js
window.addEventListener("solana-payment-confirmed", async (event) => {
  const paymentResult = event.detail;

  // Save the sale, including paymentResult.payment.signature.
  // Decrease inventory only after this event fires.
});
```

Add the returned `payment` object to the normal sale record:

```json
{
  "event_id": "EVENT-001",
  "revenue": 30,
  "cogs": 14,
  "profit": 16,
  "payment": {
    "method": "solana_pay",
    "network": "devnet",
    "status": "confirmed",
    "amount_sol": 0.01,
    "merchant_wallet": "...",
    "reference": "...",
    "signature": "...",
    "confirmed_at": "..."
  }
}
```

For a production system, generate the amount and unique reference on a trusted server. This client-side version keeps the hackathon demo small and easy to integrate.
