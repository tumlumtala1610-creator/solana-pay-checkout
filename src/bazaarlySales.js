import {
  collection, doc, getDoc, getDocs, increment, query, runTransaction, where,
} from "firebase/firestore";
import { db } from "./firebase.js";

export async function getCheckoutEvents() {
  const snapshot = await getDocs(query(
    collection(db, "events"),
    where("status", "==", "upcoming"),
  ));
  return snapshot.docs
    .map(eventSnapshot => {
      const event = eventSnapshot.data();
      return {
        eventId: eventSnapshot.id,
        name: typeof event.name === "string" && event.name.trim() ? event.name.trim() : "Untitled event",
        date: typeof event.date === "string" ? event.date : "",
      };
    })
    .sort((left, right) => {
      const leftDate = Date.parse(left.date);
      const rightDate = Date.parse(right.date);
      return (Number.isNaN(leftDate) ? Number.MAX_SAFE_INTEGER : leftDate) -
        (Number.isNaN(rightDate) ? Number.MAX_SAFE_INTEGER : rightDate);
    });
}

export async function getCheckoutItemsForEvent(eventId) {
  if (!eventId) return [];
  const snapshot = await getDocs(query(
    collection(db, "inventory"),
    where("eventId", "==", eventId),
  ));
  return snapshot.docs.flatMap(itemSnapshot => {
    const item = itemSnapshot.data();
    if (item.status !== "approved") return [];
    if (typeof item.price !== "number" || !Number.isFinite(item.price) || Math.round(item.price * 100) <= 0) {
      return [];
    }
    return [{
      inventoryItemId: itemSnapshot.id,
      title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : "Untitled item",
      price: Math.round(item.price * 100) / 100,
      imageUrl: typeof item.imageUrl === "string" ? item.imageUrl : "",
    }];
  }).sort((left, right) => left.title.localeCompare(right.title));
}

export async function getCheckoutItem(eventId, itemId) {
  const [eventSnapshot, itemSnapshot] = await Promise.all([
    getDoc(doc(db, "events", eventId)),
    getDoc(doc(db, "inventory", itemId)),
  ]);

  if (!eventSnapshot.exists() || eventSnapshot.data().status !== "upcoming") {
    throw new Error("Select an upcoming event before adding items.");
  }
  if (!itemSnapshot.exists()) {
    throw new Error("That inventory item is no longer available.");
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
    imageUrl: typeof item.imageUrl === "string" ? item.imageUrl : "",
  };
}

export async function recordConfirmedSale({ eventId, itemIds, payment }) {
  if (!eventId || !Array.isArray(itemIds) || itemIds.length === 0) {
    throw new Error("A Bazaarly event and at least one inventory item are required.");
  }
  if (new Set(itemIds).size !== itemIds.length) {
    throw new Error("The same item cannot be added to an order more than once.");
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
        throw new Error("An item in this order is no longer available.");
      }
      const item = itemSnapshot.data();
      if (item.status !== "approved" || item.eventId !== eventId) {
        throw new Error("An item in this order is no longer available at this event.");
      }
      if (typeof item.price !== "number" || !Number.isFinite(item.price) || Math.round(item.price * 100) <= 0) {
        throw new Error("An item in this order no longer has a valid USD price.");
      }

      const priceCents = Math.round(item.price * 100);
      if (priceCents <= 0 || !Number.isSafeInteger(priceCents) || !Number.isSafeInteger(totalCents + priceCents)) {
        throw new Error("An item in this order has an invalid USD price.");
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
