// src/lib/warehouseLocations.ts
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "./firebase";

export const WAREHOUSE_LOCATION_DEFAULTS = ["Downstairs", "Upstairs", "Container"];

export type WarehouseLocationRow = {
  id: string | null;
  name: string;
  isDefault: boolean;
};

export const fetchWarehouseLocationDocs = async (): Promise<WarehouseLocationRow[]> => {
  try {
    const defaults: WarehouseLocationRow[] = WAREHOUSE_LOCATION_DEFAULTS.map(
      (name) => ({
        id: null,
        name,
        isDefault: true,
      }),
    );
    const seen = new Set(defaults.map((loc) => loc.name.toLowerCase()));

    const snap = await getDocs(
      query(collection(db, "warehouseLocations"), orderBy("name")),
    );
    const extras: WarehouseLocationRow[] = [];
    snap.forEach((docSnap) => {
      const rawName = (docSnap.data() as any)?.name;
      const name = typeof rawName === "string" ? rawName.trim() : "";
      if (!name) return;
      const key = name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        extras.push({
          id: docSnap.id,
          name,
          isDefault: false,
        });
      }
    });
    extras.sort((a, b) => a.name.localeCompare(b.name));
    return [...defaults, ...extras];
  } catch (err) {
    console.error("Error loading warehouse locations", err);
    return WAREHOUSE_LOCATION_DEFAULTS.map((name) => ({
      id: null,
      name,
      isDefault: true,
    }));
  }
};

export const fetchWarehouseLocations = async (): Promise<string[]> => {
  const rows = await fetchWarehouseLocationDocs();
  return rows.map((row) => row.name);
};
