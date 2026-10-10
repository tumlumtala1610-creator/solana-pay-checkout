import BigNumber from "bignumber.js";
import { createQR, encodeURL, findReference, validateTransfer } from "@solana/pay";
import { clusterApiUrl, Connection, Keypair, PublicKey } from "@solana/web3.js";

const NETWORK = "devnet";
const connection = new Connection(clusterApiUrl(NETWORK), "confirmed");

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function createSolanaPaymentRequest({ merchantWallet, solAmount, orderId }) {
  const recipient = new PublicKey(merchantWallet);
  const amount = new BigNumber(solAmount);

  if (!amount.isFinite() || amount.isLessThanOrEqualTo(0)) {
    throw new Error("The SOL amount must be greater than zero.");
  }

  // One unique reference lets us find the payment for this exact checkout.
  const reference = Keypair.generate().publicKey;
  const label = "Event Inventory Checkout";
  const message = `Payment for ${orderId}`;
  const memo = orderId;

  const url = encodeURL({ recipient, amount, reference, label, message, memo });

  return { url, recipient, amount, reference, network: NETWORK, createdAt: Date.now() };
}

export function renderPaymentQR(url, element, size = 300) {
  element.replaceChildren();
  const qr = createQR(url, size, "white", "black");
  qr.append(element);
}

export async function waitForSolanaPayment({
  recipient,
  amount,
  reference,
  createdAt = Date.now(),
  timeoutMs = 5 * 60 * 1000,
  pollIntervalMs = 1500,
}) {
  const deadline = Date.now() + timeoutMs;
  const checkedSignatures = new Set();

  while (Date.now() < deadline) {
    // First use the Solana Pay reference, which is the most reliable match.
    try {
      const found = await findReference(connection, reference, {
        finality: "confirmed",
      });

      checkedSignatures.add(found.signature);
      await validateTransfer(
        connection,
        found.signature,
        { recipient, amount, reference },
        { commitment: "confirmed" },
      );

      return found.signature;
    } catch {
      // Some wallet flows submit the transfer without carrying the QR reference.
      // In that case, find a recent confirmed transfer to this checkout's
      // recipient and verify its exact amount before marking it paid.
    }

    try {
      const recent = await connection.getSignaturesForAddress(recipient, { limit: 20 }, "confirmed");
      for (const transaction of recent) {
        if (checkedSignatures.has(transaction.signature)) continue;
        checkedSignatures.add(transaction.signature);

        // Ignore payments that predate this QR request. Allow a small clock
        // margin because block timestamps have one-second precision.
        if (transaction.blockTime == null || transaction.blockTime < Math.floor(createdAt / 1000) - 5) {
          continue;
        }
        if (transaction.err) continue;

        try {
          await validateTransfer(
            connection,
            transaction.signature,
            { recipient, amount },
            { commitment: "confirmed" },
          );
          return transaction.signature;
        } catch {
          // Recent recipient activity that does not match this checkout's
          // exact recipient and amount is not a payment for this order.
        }
      }
    } catch {
      // Keep polling if the Devnet RPC is temporarily unavailable.
    }

    await wait(pollIntervalMs);
  }

  throw new Error("Payment was not found within five minutes.");
}

export function explorerUrl(signature) {
  return `https://explorer.solana.com/tx/${signature}?cluster=${NETWORK}`;
}
