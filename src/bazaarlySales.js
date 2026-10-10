import {
  doc, getDoc, increment, runTransaction,
} from "firebase/firestore";
import { db } from "./firebase.js";

export async function getCheckoutItem(eventId, itemId) {
  const [eventSnapshot, itemSnapshot] = await Promise.all([
    getDoc(doc(db, "events", eventId)),
    getDoc(doc(db, "inventory", itemId)),
  ]);

  if (!eventSnapshot.exists() || eventSnapshot.data().status !== "upcoming") {
    throw new Error("Select an upcoming event before adding items.");
  }
  if (!itemSnapshot.exists()) {
    throw new Error(`No Bazaarly inventory item exists with ID "${itemId}".`);
  }

  const item = itemSnapshot.data();
  if (item.status !== "approved" || item.eventId !== eventId) {
    throw new Error("That item is not available for sale at the selected event.");
  }
  if (typeof item.price !== "number" || !Number.isFinite(item.price) || Math.round(item.price * 100) <= 0) {
    throw new Error("That inventory item must have a USD price of at least $0.01.");
  }

  return {
    inventoryItemId: itemSnapshot.id,
    title: typeof item.title === "string" && item.title ? item.title : "Untitled item",
    price: Math.round(item.price * 100) / 100,
  };
}

export async function recordConfirmedSale({ eventId, itemIds, payment }) {
  if (!eventId || !Array.isArray(itemIds) || itemIds.length === 0) {
    throw new Error("A Bazaarly event and at least one inventory item are required.");
  }
  if (new Set(itemIds).size !== itemIds.length) {
    throw new Error("The checkout contains duplicate inventory item IDs.");
  }

  const eventRef = doc(db, "events", eventId);
  const saleRef = doc(db, "sales", payment.signature);
  const itemRefs = itemIds.map(itemId => doc(db, "inventory", itemId));

  return runTransaction(db, async transaction => {
    const saleSnapshot = await transaction.get(saleRef);
    if (saleSnapshot.exists()) {
      const sale = saleSnapshot.data();
      if (sale.eventId !== eventId) {
        throw new Error("This Solana transaction signature is already linked to another event.");
      }
      return sale;
    }

    const eventSnapshot = await transaction.get(eventRef);
    const itemSnapshots = await Promise.all(itemRefs.map(itemRef => transaction.get(itemRef)));
    if (!eventSnapshot.exists() || eventSnapshot.data().status !== "upcoming") {
      throw new Error("The event is no longer available for checkout.");
    }

    let totalCents = 0;
    const saleItems = itemSnapshots.map((itemSnapshot, index) => {
      if (!itemSnapshot.exists()) {
        throw new Error(`Inventory item "${itemIds[index]}" no longer exists.`);
      }
      const item = itemSnapshot.data();
      if (item.status !== "approved" || item.eventId !== eventId) {
        throw new Error(`Inventory item "${itemIds[index]}" is no longer available for this event.`);
      }
      if (typeof item.price !== "number" || !Number.isFinite(item.price) || Math.round(item.price * 100) <= 0) {
        throw new Error(`Inventory item "${itemIds[index]}" must have a USD price of at least $0.01.`);
      }

      const priceCents = Math.round(item.price * 100);
      if (priceCents <= 0 || !Number.isSafeInteger(priceCents) || !Number.isSafeInteger(totalCents + priceCents)) {
        throw new Error(`Inventory item "${itemIds[index]}" has an invalid USD price.`);
      }
      totalCents += priceCents;
      return {
        inventoryItemId: itemSnapshot.id,
        title: typeof item.title === "string" && item.title ? item.title : "Untitled item",
        price: priceCents / 100,
      };
    });
    const grossRevenue = totalCents / 100;
    const createdAt = new Date().toISOString();
    const sale = {
      eventId,
      items: saleItems,
      itemCount: saleItems.length,
      grossRevenue,
      createdAt,
      payment,
    };

    itemRefs.forEach(itemRef => transaction.update(itemRef, { status: "sold" }));
    transaction.update(eventRef, { grossRevenue: increment(grossRevenue) });
    transaction.set(saleRef, sale);
    return sale;
  });
}
