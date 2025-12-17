import {
  addDoc,
  collection,
  doc,
  getDoc,
  limit,
  query,
  Timestamp,
  updateDoc,
  where,
  getDocs,
  increment,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { normalizeItemType } from "@/lib/inventoryPaths";

const parseNumber = (value: any): number | null => {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export const createOrUpdateProductTracking = async (
  project: { id: string; name: string },
  itemId: string,
  itemName: string,
  quantity: number,
  completedAt: Timestamp,
  itemCategory?: string,
) => {
  const itemSnap = await getDoc(doc(db, "items", itemId));
  if (!itemSnap.exists()) return;
  const data = itemSnap.data() as any;
  const normalizedType = normalizeItemType(
    itemCategory ?? data.itemType ?? data.rawCsvItemType ?? data.category ?? "",
  );
  const isSensorExtra =
    normalizedType === "sensor extra" || normalizedType === "sensor extras";

  const usefulLifeMonths =
    parseNumber(data.usefulLifeMonths ?? data.usefulLifeMonths) ?? null;

  const replacementFrequencyPerYear =
    parseNumber(data.annualReplacementFrequency ?? data.replacementFrequencyPerYear) ??
    null;

  if (!isSensorExtra) {
    if (!usefulLifeMonths || usefulLifeMonths <= 0) {
      return;
    }
  } else {
    if (!replacementFrequencyPerYear || replacementFrequencyPerYear <= 0) {
      return;
    }
  }

  const replaceDate = completedAt.toDate();
  if (isSensorExtra) {
    const intervalDays = Math.max(
      1,
      Math.round(365 / replacementFrequencyPerYear),
    );
    replaceDate.setDate(replaceDate.getDate() + intervalDays);
  } else if (usefulLifeMonths) {
    replaceDate.setMonth(replaceDate.getMonth() + usefulLifeMonths);
  }

  const trackingRef = collection(db, "productTracking");
  const existing = await getDocs(
    query(
      trackingRef,
      where("projectId", "==", project.id),
      where("itemId", "==", itemId),
      limit(1),
    ),
  );

  const payload = {
    projectId: project.id,
    projectName: project.name,
    itemId,
    itemName,
    itemType: normalizedType,
    quantity,
    usefulLifeMonths: isSensorExtra ? null : usefulLifeMonths,
    replacementFrequencyPerYear: isSensorExtra
      ? replacementFrequencyPerYear
      : null,
    trackingType: isSensorExtra ? "sensorExtra" : "usefulLife",
    completedAt,
    replaceBy: Timestamp.fromDate(replaceDate),
    updatedAt: completedAt,
    replenished: false,
    lastReplenishedAt: null,
  };

  if (existing.empty) {
    await addDoc(trackingRef, {
      ...payload,
      createdAt: completedAt,
      notes: [],
    });
  } else {
    await updateDoc(existing.docs[0].ref, payload);
  }
};

export const replenishTrackedProduct = async (
  recordId: string,
  nextReplaceDate: Timestamp,
) => {
  const recordRef = doc(db, "productTracking", recordId);
  const recordSnap = await getDoc(recordRef);
  if (!recordSnap.exists()) {
    throw new Error("Tracking record not found");
  }
  const record = recordSnap.data() as any;

  const itemSnap = await getDoc(doc(db, "items", record.itemId));
  if (!itemSnap.exists()) {
    throw new Error("Linked item not found");
  }
  const itemData = itemSnap.data() as any;
  const usefulLifeMonths =
    typeof itemData.usefulLifeMonths === "number"
      ? itemData.usefulLifeMonths
      : Number(itemData.usefulLifeMonths);
  if (!usefulLifeMonths || usefulLifeMonths <= 0) {
    throw new Error("Item has no useful life configured");
  }

  const now = Timestamp.now();

  const batch = writeBatch(db);
  batch.update(recordRef, {
    replenished: true,
    replenishedAt: now,
    lastReplenishedAt: now,
  });

  const itemRef = doc(db, "items", record.itemId);
  batch.update(itemRef, {
    inventoryQty: increment(record.quantity || 0),
    updatedAt: now,
  });

  await batch.commit();

  await addDoc(collection(db, "productTracking"), {
    projectId: record.projectId,
    projectName: record.projectName,
    itemId: record.itemId,
    itemName: record.itemName,
    itemType: record.itemType ?? null,
    quantity: record.quantity || 0,
    usefulLifeMonths,
    replacementFrequencyPerYear: record.replacementFrequencyPerYear ?? null,
    trackingType: record.trackingType ?? "usefulLife",
    completedAt: now,
    replaceBy: nextReplaceDate,
    createdAt: now,
    updatedAt: now,
    replenished: false,
    notes: [],
    lastReplenishedAt: null,
  });
};
