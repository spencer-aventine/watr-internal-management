// src/app/inventory/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import {
  doc,
  getDoc,
  updateDoc,
  addDoc,
  Timestamp,
  collection,
  query,
  getDocs,
  orderBy,
  where,
  limit,
} from "firebase/firestore";

type Item = {
  id: string;
  sku: string;
  name: string;
  description?: string | null;
  itemType?: string;
  unitOfMeasure?: string;
  standardCost?: number;
  standardCostCurrency?: string;
  reorderLevel?: number | null;
  reorderQuantity?: number | null;
  lowStockThreshold?: number | null;
  usefulLifeMonths?: number | null;
  status?: "active" | "discontinued" | string;
  environment?: string | null;
  hubspotProductId?: string | null;
  xeroItemCode?: string | null;
  salesPrice?: number | null;
  // Stock quantity fields
  inventoryQty?: number | null;
  wipQty?: number | null;
  completedQty?: number | null;
  // New: multiple must-have product references (by itemId)
  mustHaveItemIds?: string[];
  nextUnitCounter?: number | null;
};

type FormState = {
  sku: string;
  name: string;
  description: string;
  itemType: string;
  unitOfMeasure: string;
  standardCost: string;
  standardCostCurrency: string;
  reorderLevel: string;
  reorderQuantity: string;
  lowStockThreshold: string;
  usefulLifeMonths: string;
  status: "active" | "discontinued";
  environment: string;
  hubspotProductId: string;
  xeroItemCode: string;
  // Stock quantity fields (as strings for inputs)
  inventoryQty: string;
  wipQty: string;
  completedQty: string;
};

type LinkedItem = {
  id: string;
  sku: string;
  name: string;
};

type LocationOption = {
  id: string;
  name: string;
};

type PurchaseStatus = "draft" | "paid" | "stock_received";

type ItemPurchase = {
  id: string;
  purchaseId: string;
  vendorName: string;
  reference?: string | null;
  purchaseDate?: Timestamp | null;
  createdAt?: Timestamp | null;
  totalAmount?: number | null;
  quantity: number;
  unitPrice?: number | null;
  status: PurchaseStatus;
};

type ItemUtilisation = {
  id: string;
  projectId: string;
  projectName: string;
  reference?: string | null;
  createdAt?: Timestamp | null;
  quantity: number;
};

type ItemUnit = {
  id: string;
  unitCode: string;
  locationId?: string | null;
  createdAt?: Timestamp | null;
};

const formatUnitLabel = (value?: string | null) => {
  if (!value) return "units";
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "ea") return "units";
  return value;
};

const formatPurchaseCurrency = (value?: number | null) => {
  if (value == null || Number.isNaN(value)) return "—";
  return `£${value.toFixed(2)}`;
};

const formatPurchaseDate = (timestamp?: Timestamp | null) => {
  if (!timestamp) return "—";
  try {
    return timestamp.toDate().toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
};

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [item, setItem] = useState<Item | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // All products, for the must-have dropdown
  const [allItems, setAllItems] = useState<LinkedItem[]>([]);
  // Selected must-have product IDs
  const [selectedMustHaveIds, setSelectedMustHaveIds] = useState<string[]>([]);
  const [recentPurchases, setRecentPurchases] = useState<ItemPurchase[]>([]);
  const [loadingPurchases, setLoadingPurchases] = useState(true);
  const [purchasesError, setPurchasesError] = useState<string | null>(null);
  const [recentUtilisations, setRecentUtilisations] = useState<ItemUtilisation[]>([]);
  const [loadingUtilisations, setLoadingUtilisations] = useState(true);
  const [utilisationsError, setUtilisationsError] = useState<string | null>(null);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [newLocationName, setNewLocationName] = useState("");
  const [addingLocation, setAddingLocation] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [units, setUnits] = useState<ItemUnit[]>([]);
  const [loadingUnits, setLoadingUnits] = useState(true);
  const [unitError, setUnitError] = useState<string | null>(null);
  const [unitMessage, setUnitMessage] = useState<string | null>(null);
  const [bulkAssignLocationId, setBulkAssignLocationId] = useState("");
  const [updatingUnits, setUpdatingUnits] = useState(false);

  useEffect(() => {
    const loadItem = async () => {
      if (!id) return;
      setLoading(true);
      setError(null);

      try {
        const ref = doc(db, "items", id);
        const itemsRef = collection(db, "items");

        // Load this item + all items for the must-have dropdown
        const [snap, allSnap] = await Promise.all([
          getDoc(ref),
          getDocs(query(itemsRef, orderBy("name"))),
        ]);

        if (!snap.exists()) {
          setError("Product not found.");
          setLoading(false);
          return;
        }

        const all: LinkedItem[] = allSnap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            sku: data.sku ?? "",
            name: data.name ?? "",
          };
        });
        setAllItems(all);

        const data = snap.data() as any;

        // Prefer array field; fall back to legacy string-based "mustHave"
        let mustHaveItemIds: string[] = Array.isArray(data.mustHaveItemIds)
          ? (data.mustHaveItemIds as string[])
          : [];

        if (!mustHaveItemIds.length && data.mustHave) {
          const legacy = String(data.mustHave).trim().toLowerCase();
          if (legacy) {
            mustHaveItemIds = all
              .filter(
                (i) =>
                  i.sku.toLowerCase() === legacy ||
                  i.name.toLowerCase() === legacy,
              )
              .map((i) => i.id);
          }
        }

        const loaded: Item = {
          id: snap.id,
          sku: data.sku ?? "",
          name: data.name ?? "",
          description: data.description ?? "",
          itemType: data.itemType ?? data.rawCsvItemType ?? "",
          unitOfMeasure: data.unitOfMeasure ?? "",
          standardCost:
            typeof data.standardCost === "number"
              ? data.standardCost
              : undefined,
          salesPrice:
            typeof data.salesPrice === "number" ? data.salesPrice : null,
          standardCostCurrency: data.standardCostCurrency ?? "GBP",
          reorderLevel:
            typeof data.reorderLevel === "number" ? data.reorderLevel : null,
          reorderQuantity:
            typeof data.reorderQuantity === "number"
              ? data.reorderQuantity
              : null,
          lowStockThreshold:
            typeof data.lowStockThreshold === "number"
              ? data.lowStockThreshold
              : null,
          usefulLifeMonths:
            typeof data.usefulLifeMonths === "number"
              ? data.usefulLifeMonths
              : null,
          status: data.status ?? "active",
          environment: data.saltFresh ?? data.environment ?? "",
          hubspotProductId: data.hubspotProductId ?? "",
          xeroItemCode: data.xeroItemCode ?? "",
          inventoryQty:
            typeof data.inventoryQty === "number" ? data.inventoryQty : null,
          wipQty: typeof data.wipQty === "number" ? data.wipQty : null,
          completedQty:
            typeof data.completedQty === "number"
              ? data.completedQty
              : null,
          mustHaveItemIds,
          nextUnitCounter:
            typeof data.nextUnitCounter === "number"
              ? data.nextUnitCounter
              : null,
        };

        setItem(loaded);
        setSelectedMustHaveIds(loaded.mustHaveItemIds ?? []);

        setForm({
          sku: loaded.sku,
          name: loaded.name,
          description: loaded.description ?? "",
          itemType: loaded.itemType ?? "component",
          unitOfMeasure: loaded.unitOfMeasure ?? "",
          standardCost:
            loaded.standardCost != null ? String(loaded.standardCost) : "",
          standardCostCurrency: loaded.standardCostCurrency ?? "GBP",
          reorderLevel:
            loaded.reorderLevel != null ? String(loaded.reorderLevel) : "",
          reorderQuantity:
            loaded.reorderQuantity != null
              ? String(loaded.reorderQuantity)
              : "",
          lowStockThreshold:
            loaded.lowStockThreshold != null
              ? String(loaded.lowStockThreshold)
              : "",
          usefulLifeMonths:
            loaded.usefulLifeMonths != null
              ? String(loaded.usefulLifeMonths)
              : "",
          status:
            loaded.status === "discontinued" ? "discontinued" : "active",
          environment: loaded.environment ?? "",
          hubspotProductId: loaded.hubspotProductId ?? "",
          xeroItemCode: loaded.xeroItemCode ?? "",
          inventoryQty:
            loaded.inventoryQty != null ? String(loaded.inventoryQty) : "",
          wipQty: loaded.wipQty != null ? String(loaded.wipQty) : "",
          completedQty:
            loaded.completedQty != null ? String(loaded.completedQty) : "",
        });
      } catch (err: any) {
        console.error("Error loading product", err);
        setError(err?.message ?? "Error loading product");
      } finally {
        setLoading(false);
      }
    };

    loadItem();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const fetchUtilisations = async () => {
      setLoadingUtilisations(true);
      setUtilisationsError(null);
      try {
        const projectsRef = collection(db, "projects");
        const snap = await getDocs(
          query(projectsRef, orderBy("createdAt", "desc"), limit(25)),
        );
        const rows: ItemUtilisation[] = [];

        snap.docs.forEach((docSnap) => {
          const data = docSnap.data() as any;
          const lineItems = Array.isArray(data.items) ? data.items : [];
          lineItems.forEach((line: any, idx: number) => {
            if (!line || line.itemId !== id) return;
            const qty =
              typeof line.qty === "number" ? line.qty : Number(line.qty);
            if (!Number.isFinite(qty) || qty <= 0) return;

            rows.push({
              id: `${docSnap.id}-${idx}`,
              projectId: docSnap.id,
              projectName: data.name ?? "Unnamed project",
              reference: data.hubspotDealId ?? null,
              createdAt: data.createdAt ?? null,
              quantity: qty,
            });
          });
        });

        if (!cancelled) {
          setRecentUtilisations(rows.slice(0, 10));
        }
      } catch (err: any) {
        console.error("Error loading utilisation history", err);
        if (!cancelled) {
          setUtilisationsError(
            err?.message ?? "Unable to load recent utilisation.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingUtilisations(false);
        }
      }
    };

    fetchUtilisations();

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    const loadLocations = async () => {
      try {
        const snapshot = await getDocs(
          query(collection(db, "locations"), orderBy("name")),
        );
        const opts: LocationOption[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as any;
          return {
            id: docSnap.id,
            name: data.name ?? "Unnamed location",
          };
        });
        setLocations(opts);
      } catch (err) {
        console.error("Error loading locations", err);
      }
    };

    loadLocations();
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const fetchPurchases = async () => {
      setLoadingPurchases(true);
      setPurchasesError(null);
      try {
        const purchasesRef = collection(db, "purchases");
        const targetedSnap = await getDocs(
          query(
            purchasesRef,
            where("lineItemIds", "array-contains", id),
            limit(25),
          ),
        );
        let docs = targetedSnap.docs;

        if (!docs.length) {
          const fallbackSnap = await getDocs(
            query(purchasesRef, orderBy("purchaseDate", "desc"), limit(25)),
          );
          docs = fallbackSnap.docs.filter((docSnap) => {
            const data = docSnap.data() as any;
            const lineItems = Array.isArray(data.lineItems)
              ? data.lineItems
              : [];
            return lineItems.some(
              (line: any) => line && line.itemId === id,
            );
          });
        }

        const rows: ItemPurchase[] = [];
        docs.forEach((docSnap) => {
          const data = docSnap.data() as any;
          const status = (data.status as PurchaseStatus) ?? "draft";
          if (status !== "stock_received") {
            return;
          }
          const lineItems = Array.isArray(data.lineItems)
            ? data.lineItems
            : [];
          const matching = lineItems.filter(
            (line: any) => line && line.itemId === id,
          );
          if (!matching.length) return;

          matching.forEach((line: any, index: number) => {
            const quantity =
              typeof line?.quantity === "number"
                ? line.quantity
                : Number(line?.quantity);
            if (!Number.isFinite(quantity) || quantity <= 0) {
              return;
            }
            const lineUnitPrice =
              typeof line?.unitPrice === "number"
                ? line.unitPrice
                : Number(line?.unitPrice);

            rows.push({
              id: `${docSnap.id}-${index}`,
              purchaseId: docSnap.id,
              vendorName: data.vendorName ?? "Unknown vendor",
              reference: data.reference ?? null,
              purchaseDate: data.purchaseDate ?? data.createdAt ?? null,
              createdAt: data.createdAt ?? null,
              totalAmount:
                typeof data.totalAmount === "number"
                  ? data.totalAmount
                  : null,
              quantity,
              unitPrice: Number.isFinite(lineUnitPrice)
                ? lineUnitPrice
                : null,
              status,
            });
          });
        });

        rows.sort((a, b) => {
          const aTime =
            a.purchaseDate instanceof Timestamp
              ? a.purchaseDate.toMillis()
              : 0;
          const bTime =
            b.purchaseDate instanceof Timestamp
              ? b.purchaseDate.toMillis()
              : 0;
          return bTime - aTime;
        });

        if (!cancelled) {
          setRecentPurchases(rows.slice(0, 10));
        }
      } catch (err: any) {
        console.error("Error loading purchases for item", err);
        if (!cancelled) {
          setPurchasesError(
            err?.message ??
              "Unable to load purchase history for this item.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingPurchases(false);
        }
      }
    };

    fetchPurchases();

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const fetchUnits = async () => {
      setLoadingUnits(true);
      setUnitError(null);
      try {
        const unitsRef = collection(db, "itemUnits");
        const snapshot = await getDocs(
          query(unitsRef, where("itemId", "==", id), orderBy("createdAt", "desc")),
        );
        if (cancelled) return;
        const rows: ItemUnit[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as any;
          return {
            id: docSnap.id,
            unitCode: data.unitCode ?? docSnap.id,
            locationId: data.locationId ?? null,
            createdAt: data.createdAt ?? null,
          };
        });
        setUnits(rows);
      } catch (err: any) {
        console.error("Error loading units", err);
        if (!cancelled) {
          setUnitError(err?.message ?? "Unable to load individual units.");
        }
      } finally {
        if (!cancelled) {
          setLoadingUnits(false);
        }
      }
    };

    fetchUnits();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleCreateLocation = async () => {
    const trimmed = newLocationName.trim();
    if (!trimmed) return;
    setAddingLocation(true);
    setLocationError(null);
    try {
      const now = Timestamp.now();
      const docRef = await addDoc(collection(db, "locations"), {
        name: trimmed,
        createdAt: now,
        updatedAt: now,
      });
      setLocations((prev) =>
        [...prev, { id: docRef.id, name: trimmed }].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      setNewLocationName("");
      setLocationMessage(`Added location “${trimmed}”.`);
    } catch (err: any) {
      console.error("Error creating location", err);
      setLocationError(err?.message ?? "Unable to add location.");
    } finally {
      setAddingLocation(false);
    }
  };

  const handleChange = (field: keyof FormState, value: string) => {
    if (!form) return;
    setForm({ ...form, [field]: value });
  };

  const handleMustHaveMultiChange = (
    e: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const options = Array.from(e.target.selectedOptions);
    setSelectedMustHaveIds(options.map((o) => o.value));
  };

  const refreshUnits = async () => {
    if (!id) return;
    try {
      const snapshot = await getDocs(
        query(
          collection(db, "itemUnits"),
          where("itemId", "==", id),
          orderBy("createdAt", "desc"),
        ),
      );
      const rows: ItemUnit[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as any;
        return {
          id: docSnap.id,
          unitCode: data.unitCode ?? docSnap.id,
          locationId: data.locationId ?? null,
          createdAt: data.createdAt ?? null,
        };
      });
      setUnits(rows);
    } catch (err) {
      console.error("Error refreshing units", err);
    }
  };

  const handleUnitLocationUpdate = async (
    unitId: string,
    locationId: string,
  ) => {
    setUnitError(null);
    setUnitMessage(null);
    try {
      const ref = doc(db, "itemUnits", unitId);
      await updateDoc(ref, {
        locationId: locationId || null,
        updatedAt: Timestamp.now(),
      });
      setUnits((prev) =>
        prev.map((unit) =>
          unit.id === unitId ? { ...unit, locationId: locationId || null } : unit,
        ),
      );
      setUnitMessage("Unit location updated.");
    } catch (err: any) {
      console.error("Error updating unit location", err);
      setUnitError(err?.message ?? "Unable to update unit location.");
    }
  };

  const handleAssignAllUnits = async () => {
    if (!bulkAssignLocationId) {
      setUnitError("Select a location to assign all units.");
      return;
    }
    if (!units.length) {
      setUnitError("No units to update yet.");
      return;
    }
    setUpdatingUnits(true);
    setUnitError(null);
    setUnitMessage(null);
    try {
      const updates = units.map((unit) =>
        updateDoc(doc(db, "itemUnits", unit.id), {
          locationId: bulkAssignLocationId,
          updatedAt: Timestamp.now(),
        }),
      );
      await Promise.all(updates);
      setUnits((prev) =>
        prev.map((unit) => ({
          ...unit,
          locationId: bulkAssignLocationId,
        })),
      );
      setUnitMessage("Assigned all units to the selected location.");
    } catch (err: any) {
      console.error("Error assigning units", err);
      setUnitError(err?.message ?? "Unable to assign units.");
    } finally {
      setUpdatingUnits(false);
    }
  };

  const stockMovements = useMemo(() => {
    const salesUnitPrice =
      typeof item?.salesPrice === "number" ? item.salesPrice : null;
    const events = [
      ...recentPurchases.map((purchase) => {
        const costPerUnit =
          typeof purchase.unitPrice === "number" ? purchase.unitPrice : null;
        return {
          id: `purchase-${purchase.id}`,
          type: "purchase" as const,
          timestamp: purchase.purchaseDate ?? purchase.createdAt ?? null,
          label: purchase.vendorName,
          reference: purchase.reference ?? null,
          qtyChange: purchase.quantity,
          link: `/purchasing/${purchase.purchaseId}`,
          costPerUnit,
          purchaseValue:
            costPerUnit != null ? costPerUnit * purchase.quantity : null,
          paidValue: null,
        };
      }),
      ...recentUtilisations.map((usage) => {
        const costPerUnit = salesUnitPrice;
        return {
          id: `utilisation-${usage.id}`,
          type: "utilisation" as const,
          timestamp: usage.createdAt ?? null,
          label: usage.projectName,
          reference: usage.reference ?? usage.projectId ?? null,
          qtyChange: -usage.quantity,
          link: `/projects/${usage.projectId}`,
          costPerUnit,
          purchaseValue: null,
          paidValue:
            costPerUnit != null ? costPerUnit * usage.quantity : null,
        };
      }),
    ];

    events.sort((a, b) => {
      const aTime =
        a.timestamp instanceof Timestamp ? a.timestamp.toMillis() : 0;
      const bTime =
        b.timestamp instanceof Timestamp ? b.timestamp.toMillis() : 0;
      return bTime - aTime;
    });

    const initialBalance =
      typeof item?.inventoryQty === "number" ? item.inventoryQty : 0;
    let running = initialBalance;

    return events.slice(0, 12).map((event) => {
      const balanceAfter = running;
      running -= event.qtyChange;
      return { ...event, balanceAfter };
    });
  }, [recentPurchases, recentUtilisations, item?.inventoryQty, item?.salesPrice]);
  const unitLabel = formatUnitLabel(item?.unitOfMeasure);
  const totalInventoryQty = (() => {
    if (form) {
      const parsed = Number(form.inventoryQty);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return typeof item?.inventoryQty === "number" ? item.inventoryQty : 0;
  })();
  const totalUnits = units.length;
  const assignedUnits = units.filter((unit) => unit.locationId).length;
  const unassignedUnits = totalUnits - assignedUnits;
  const locationsById = useMemo(() => {
    const map = new Map<string, string>();
    locations.forEach((loc) => map.set(loc.id, loc.name));
    return map;
  }, [locations]);
  const ledgerIsLoading = loadingPurchases || loadingUtilisations;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || !item) return;

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const ref = doc(db, "items", item.id);
      await updateDoc(ref, {
        sku: form.sku.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        itemType: form.itemType,
        unitOfMeasure: form.unitOfMeasure,
        standardCost: form.standardCost ? Number(form.standardCost) : null,
        standardCostCurrency: form.standardCostCurrency,
        reorderLevel: form.reorderLevel ? Number(form.reorderLevel) : null,
        reorderQuantity: form.reorderQuantity
          ? Number(form.reorderQuantity)
          : null,
        lowStockThreshold: form.lowStockThreshold
          ? Number(form.lowStockThreshold)
          : null,
        usefulLifeMonths: form.usefulLifeMonths
          ? Number(form.usefulLifeMonths)
          : null,
        status: form.status,
        saltFresh: form.environment || null,
        hubspotProductId: form.hubspotProductId || null,
        xeroItemCode: form.xeroItemCode || null,
        inventoryQty: form.inventoryQty ? Number(form.inventoryQty) : 0,
        wipQty: form.wipQty ? Number(form.wipQty) : 0,
        completedQty: form.completedQty ? Number(form.completedQty) : 0,
        mustHaveItemIds: selectedMustHaveIds,
        updatedAt: Timestamp.now(),
      });

      // Update local item state to reflect changes
      setItem((prev) =>
        prev
          ? {
              ...prev,
              sku: form.sku.trim(),
              name: form.name.trim(),
              description: form.description.trim() || null,
              itemType: form.itemType,
              unitOfMeasure: form.unitOfMeasure,
              standardCost: form.standardCost
                ? Number(form.standardCost)
                : undefined,
              standardCostCurrency: form.standardCostCurrency,
              reorderLevel: form.reorderLevel
                ? Number(form.reorderLevel)
                : null,
              reorderQuantity: form.reorderQuantity
                ? Number(form.reorderQuantity)
                : null,
              lowStockThreshold: form.lowStockThreshold
                ? Number(form.lowStockThreshold)
                : null,
              usefulLifeMonths: form.usefulLifeMonths
                ? Number(form.usefulLifeMonths)
                : null,
              status: form.status,
              environment: form.environment || null,
              hubspotProductId: form.hubspotProductId || null,
              xeroItemCode: form.xeroItemCode || null,
              inventoryQty: form.inventoryQty
                ? Number(form.inventoryQty)
                : 0,
              wipQty: form.wipQty ? Number(form.wipQty) : 0,
              completedQty: form.completedQty
                ? Number(form.completedQty)
                : 0,
              mustHaveItemIds: selectedMustHaveIds,
            }
          : prev,
      );

      setMessage("Product updated.");
      setIsEditing(false);
    } catch (err: any) {
      console.error("Error saving product", err);
      setError(err?.message ?? "Error saving product");
    } finally {
      setSaving(false);
    }
  };

  const renderMustHaveView = () => {
    if (!selectedMustHaveIds.length) return <div>—</div>;

    return (
      <ul className="ims-tag-list">
        {selectedMustHaveIds.map((id) => {
          const linked = allItems.find((i) => i.id === id);
          if (!linked) return null;
          return (
            <li key={id}>
              <Link
                href={`/inventory/${linked.id}`}
                className="ims-table-link"
              >
                {linked.name}{" "}
                <span style={{ color: "#6b7280", fontSize: "0.8rem" }}>
                  ({linked.sku})
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <main className="ims-content">
      {loading ? (
        <p>Loading product…</p>
      ) : error ? (
        <p className="ims-form-error">{error}</p>
      ) : !item || !form ? (
        <p className="ims-form-error">Product not found.</p>
      ) : (
        <>
          <div className="ims-page-header ims-page-header--with-actions">
            <div>
              <h1 className="ims-page-title">
                {item.name}{" "}
                <span style={{ fontWeight: 400, fontSize: "0.9rem" }}>
                  ({item.sku})
                </span>
              </h1>
              <p className="ims-page-subtitle">
                View and edit product details. Changes will be saved to
                Firestore and reflected across IMS.
              </p>
            </div>
            <div className="ims-page-actions">
              <button
                type="button"
                className="ims-secondary-button"
                onClick={() => router.push("/inventory")}
              >
                ← Back
              </button>
              {!isEditing && (
                <button
                  className="ims-primary-button"
                  type="button"
                  onClick={() => setIsEditing(true)}
                >
                  Edit
                </button>
              )}
            </div>
          </div>

          {(message || error) && (
            <div
              className={
                "ims-alert " +
                (error ? "ims-alert--error" : "ims-alert--info")
              }
            >
              {error || message}
            </div>
          )}

          <form className="ims-form-stack" onSubmit={handleSave}>
            <section className="ims-form-section card">
              <h2 className="ims-form-section-title">Basic details</h2>
              <p className="ims-form-section-subtitle">
                Core identifiers used in inventory, projects and assets.
              </p>

              <div className="ims-field">
                <label className="ims-field-label" htmlFor="sku">
                  SKU / Part code
                </label>
                {isEditing ? (
                  <input
                    id="sku"
                    className="ims-field-input"
                    value={form.sku}
                    onChange={(e) => handleChange("sku", e.target.value)}
                  />
                ) : (
                  <div>{item.sku}</div>
                )}
              </div>

              <div className="ims-field">
                <label className="ims-field-label" htmlFor="name">
                  Name
                </label>
                {isEditing ? (
                  <input
                    id="name"
                    className="ims-field-input"
                    value={form.name}
                    onChange={(e) => handleChange("name", e.target.value)}
                  />
                ) : (
                  <div>{item.name}</div>
                )}
              </div>

              <div className="ims-field">
                <label className="ims-field-label" htmlFor="description">
                  Description
                </label>
                {isEditing ? (
                  <textarea
                    id="description"
                    className="ims-field-input ims-field-textarea"
                    rows={3}
                    value={form.description}
                    onChange={(e) =>
                      handleChange("description", e.target.value)
                    }
                  />
                ) : (
                  <div>{item.description || "—"}</div>
                )}
              </div>

              <div className="ims-field-row">
                <div className="ims-field">
                  <label className="ims-field-label" htmlFor="itemType">
                    Item type
                  </label>
                  {isEditing ? (
                    <select
                      id="itemType"
                      className="ims-field-input"
                      value={form.itemType}
                      onChange={(e) =>
                        handleChange("itemType", e.target.value)
                      }
                    >
                      <option value="">Select type…</option>
                      <option value="product">Product</option>
                      <option value="sub assembly">Sub Assembly</option>
                      <option value="component">Component</option>
                    </select>
                  ) : (
                    <div>{item.itemType || "—"}</div>
                  )}
                </div>

                <div className="ims-field">
                  <label
                    className="ims-field-label"
                    htmlFor="unitOfMeasure"
                  >
                    Unit of measure
                  </label>
                  {isEditing ? (
                    <input
                      id="unitOfMeasure"
                      className="ims-field-input"
                      value={form.unitOfMeasure}
                      onChange={(e) =>
                        handleChange("unitOfMeasure", e.target.value)
                      }
                    />
                  ) : (
                    <div>{formatUnitLabel(item.unitOfMeasure)}</div>
                  )}
                </div>
              </div>
            </section>

            <div className="ims-form-grid">
              <section className="ims-form-section card">
                <h2 className="ims-form-section-title">Costing</h2>
                <p className="ims-form-section-subtitle">
                  Standard cost and environment flags.
                </p>

              <div className="ims-field-row">
                <div className="ims-field">
                  <label className="ims-field-label" htmlFor="standardCost">
                    Standard cost
                  </label>
                  {isEditing ? (
                    <input
                      id="standardCost"
                      type="number"
                      min="0"
                      step="0.01"
                      className="ims-field-input"
                      value={form.standardCost}
                      onChange={(e) =>
                        handleChange("standardCost", e.target.value)
                      }
                    />
                  ) : (
                    <div>
                      {item.standardCost != null
                        ? `£${item.standardCost.toFixed(2)}`
                        : "—"}
                    </div>
                  )}
                </div>
                <div className="ims-field">
                  <label
                    className="ims-field-label"
                    htmlFor="standardCostCurrency"
                  >
                    Currency
                  </label>
                  {isEditing ? (
                    <select
                      id="standardCostCurrency"
                      className="ims-field-input"
                      value={form.standardCostCurrency}
                      onChange={(e) =>
                        handleChange("standardCostCurrency", e.target.value)
                      }
                    >
                      <option value="GBP">GBP</option>
                      <option value="EUR">EUR</option>
                      <option value="USD">USD</option>
                    </select>
                  ) : (
                    <div>{item.standardCostCurrency || "GBP"}</div>
                  )}
                </div>
              </div>

              <div className="ims-field-row">
                <div className="ims-field">
                  <label className="ims-field-label" htmlFor="environment">
                    Environment (Salt/Fresh)
                  </label>
                  {isEditing ? (
                    <input
                      id="environment"
                      className="ims-field-input"
                      value={form.environment}
                      onChange={(e) =>
                        handleChange("environment", e.target.value)
                      }
                    />
                  ) : (
                    <div>{item.environment || "—"}</div>
                  )}
                </div>

                <div className="ims-field">
                  <label className="ims-field-label" htmlFor="mustHaveMulti">
                    Must have products
                  </label>
                  {isEditing ? (
                    <>
                      <select
                        id="mustHaveMulti"
                        className="ims-field-input"
                        multiple
                        value={selectedMustHaveIds}
                        onChange={handleMustHaveMultiChange}
                        size={Math.min(
                          8,
                          Math.max(4, selectedMustHaveIds.length || 4),
                        )}
                      >
                        {allItems.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.name} ({opt.sku})
                          </option>
                        ))}
                      </select>
                      <p className="ims-field-help">
                        Choose one or more products that must always be included
                        with this item. Use Ctrl/Cmd + click to select multiple.
                      </p>
                    </>
                  ) : (
                    renderMustHaveView()
                  )}
                </div>
              </div>
              </section>

              <section className="ims-form-section card">
                <h2 className="ims-form-section-title">
                  Replenishment & lifecycle
                </h2>
                <p className="ims-form-section-subtitle">
                  Reorder thresholds, useful life, stock levels and integration
                  IDs.
                </p>

                <div className="ims-field-row">
                  <div className="ims-field">
                    <label className="ims-field-label" htmlFor="inventoryQty">
                      Inventory stock
                    </label>
                    {isEditing ? (
                      <input
                        id="inventoryQty"
                        type="number"
                        min="0"
                        className="ims-field-input"
                        value={form.inventoryQty}
                        onChange={(e) =>
                          handleChange("inventoryQty", e.target.value)
                        }
                      />
                    ) : (
                      <div>{item.inventoryQty ?? 0}</div>
                    )}
                  </div>

                  <div className="ims-field">
                    <label className="ims-field-label" htmlFor="wipQty">
                      WIP stock
                    </label>
                    {isEditing ? (
                      <input
                        id="wipQty"
                        type="number"
                        min="0"
                        className="ims-field-input"
                        value={form.wipQty}
                        onChange={(e) =>
                          handleChange("wipQty", e.target.value)
                        }
                      />
                    ) : (
                      <div>{item.wipQty ?? 0}</div>
                    )}
                  </div>
                </div>

                <div className="ims-field">
                  <label className="ims-field-label" htmlFor="completedQty">
                    Completed stock
                  </label>
                  {isEditing ? (
                    <input
                      id="completedQty"
                      type="number"
                      min="0"
                      className="ims-field-input"
                      value={form.completedQty}
                      onChange={(e) =>
                        handleChange("completedQty", e.target.value)
                      }
                    />
                  ) : (
                    <div>{item.completedQty ?? 0}</div>
                  )}
                </div>

                <hr className="ims-form-divider" />

                <div className="ims-field-row">
                  <div className="ims-field">
                    <label className="ims-field-label" htmlFor="reorderLevel">
                      Reorder level
                    </label>
                    {isEditing ? (
                      <input
                        id="reorderLevel"
                        type="number"
                        min="0"
                        className="ims-field-input"
                        value={form.reorderLevel}
                        onChange={(e) =>
                          handleChange("reorderLevel", e.target.value)
                        }
                      />
                    ) : (
                      <div>
                        {item.reorderLevel != null ? item.reorderLevel : "—"}
                      </div>
                    )}
                  </div>

                <div className="ims-field">
                  <label className="ims-field-label" htmlFor="reorderQuantity">
                    Typical reorder quantity
                  </label>
                  {isEditing ? (
                      <input
                        id="reorderQuantity"
                        type="number"
                        min="0"
                        className="ims-field-input"
                        value={form.reorderQuantity}
                        onChange={(e) =>
                          handleChange("reorderQuantity", e.target.value)
                        }
                      />
                    ) : (
                      <div>
                        {item.reorderQuantity != null
                          ? item.reorderQuantity
                          : "—"}
                    </div>
                  )}
                </div>
                <div className="ims-field">
                  <label
                    className="ims-field-label"
                    htmlFor="lowStockThreshold"
                  >
                    Low stock threshold
                  </label>
                  {isEditing ? (
                    <input
                      id="lowStockThreshold"
                      type="number"
                      min="0"
                      className="ims-field-input"
                      value={form.lowStockThreshold}
                      onChange={(e) =>
                        handleChange("lowStockThreshold", e.target.value)
                      }
                    />
                  ) : (
                    <div>
                      {item.lowStockThreshold != null
                        ? item.lowStockThreshold
                        : "—"}
                    </div>
                  )}
                </div>
              </div>

              <div className="ims-field-row">
                <div className="ims-field">
                    <label className="ims-field-label" htmlFor="usefulLifeMonths">
                      Useful life (months)
                    </label>
                    {isEditing ? (
                      <input
                        id="usefulLifeMonths"
                        type="number"
                        min="0"
                        className="ims-field-input"
                        value={form.usefulLifeMonths}
                        onChange={(e) =>
                          handleChange("usefulLifeMonths", e.target.value)
                        }
                      />
                    ) : (
                      <div>
                        {item.usefulLifeMonths != null
                          ? item.usefulLifeMonths
                          : "—"}
                      </div>
                    )}
                  </div>

                  <div className="ims-field">
                    <label className="ims-field-label" htmlFor="status">
                      Status
                    </label>
                    {isEditing ? (
                      <select
                        id="status"
                        className="ims-field-input"
                        value={form.status}
                        onChange={(e) =>
                          handleChange(
                            "status",
                            e.target.value as "active" | "discontinued",
                          )
                        }
                      >
                        <option value="active">Active</option>
                        <option value="discontinued">Discontinued</option>
                      </select>
                    ) : (
                      <span
                        className={
                          "ims-status-tag " +
                          (item.status === "discontinued"
                            ? "ims-status-tag--inactive"
                            : "ims-status-tag--active")
                        }
                      >
                        {item.status ?? "active"}
                      </span>
                    )}
                  </div>
                </div>

                <div className="ims-field">
                  <label className="ims-field-label" htmlFor="hubspotProductId">
                    HubSpot product ID
                  </label>
                  {isEditing ? (
                    <input
                      id="hubspotProductId"
                      className="ims-field-input"
                      value={form.hubspotProductId}
                      onChange={(e) =>
                        handleChange("hubspotProductId", e.target.value)
                      }
                    />
                  ) : (
                    <div>{item.hubspotProductId || "—"}</div>
                  )}
                </div>

                <div className="ims-field">
                  <label className="ims-field-label" htmlFor="xeroItemCode">
                    Xero item code
                  </label>
                  {isEditing ? (
                    <input
                      id="xeroItemCode"
                      className="ims-field-input"
                      value={form.xeroItemCode}
                      onChange={(e) =>
                        handleChange("xeroItemCode", e.target.value)
                      }
                    />
                  ) : (
                    <div>{item.xeroItemCode || "—"}</div>
                  )}
                </div>

                {isEditing && (
                  <div
                    style={{
                      marginTop: "0.75rem",
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: "0.5rem",
                    }}
                  >
                    <button
                      type="button"
                      className="ims-secondary-button"
                      onClick={() => {
                        setIsEditing(false);
                        setMessage(null);
                        setError(null);
                        router.refresh();
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="ims-primary-button"
                      disabled={saving}
                    >
                      {saving ? "Saving…" : "Save changes"}
                    </button>
                  </div>
                )}
              </section>
            </div>
          </form>

          <section className="card ims-table-card" style={{ marginTop: "1.5rem" }}>
            <div className="ims-table-header">
              <div>
                <h2 className="ims-form-section-title">Individual units</h2>
                <p className="ims-form-section-subtitle">
                  Every unit has a unique ID; assign or change its location to
                  keep stock traceable.
                </p>
              </div>
              <div className="ims-page-actions">
                <button
                  type="button"
                  className="ims-secondary-button"
                  onClick={refreshUnits}
                  disabled={loadingUnits}
                >
                  Refresh
                </button>
              </div>
            </div>

            <div className="ims-field">
              <label className="ims-field-label">Inventory summary</label>
              <div>
                Inventory quantity: {totalInventoryQty} {unitLabel} • Units
                tracked: {totalUnits}
              </div>
              <div className="ims-field-help">
                {assignedUnits} assigned to locations, {unassignedUnits}{" "}
                unassigned (default location: Unassigned).
              </div>
              {totalUnits < totalInventoryQty && (
                <div className="ims-alert ims-alert--info" style={{ marginTop: "0.5rem" }}>
                  Create {totalInventoryQty - totalUnits} more units to match the
                  recorded inventory.
                </div>
              )}
            </div>

            {(locationError || locationMessage) && (
              <div
                className={
                  "ims-alert " +
                  (locationError ? "ims-alert--error" : "ims-alert--info")
                }
                style={{ marginTop: "1rem" }}
              >
                {locationError || locationMessage}
              </div>
            )}

            <div className="ims-field-row" style={{ marginTop: "1rem", gap: "1rem" }}>
              <div className="ims-field" style={{ flex: 1, minWidth: "240px" }}>
                <label className="ims-field-label" htmlFor="newLocationName">
                  Add a new location
                </label>
                <input
                  id="newLocationName"
                  type="text"
                  className="ims-field-input"
                  placeholder="e.g. Warehouse A / Shelf 3"
                  value={newLocationName}
                  onChange={(e) => setNewLocationName(e.target.value)}
                />
                <p className="ims-field-help">
                  Locations are shared across products. Create one before
                  assigning units to it.
                </p>
              </div>
              <div className="ims-field" style={{ width: "200px" }}>
                <label className="ims-field-label" aria-hidden="true">
                  &nbsp;
                </label>
                <button
                  type="button"
                  className="ims-secondary-button"
                  onClick={handleCreateLocation}
                  disabled={addingLocation}
                  style={{ width: "100%" }}
                >
                  {addingLocation ? "Saving…" : "Add location"}
                </button>
              </div>
            </div>

            {(unitError || unitMessage) && (
              <div
                className={
                  "ims-alert " +
                  (unitError ? "ims-alert--error" : "ims-alert--info")
                }
                style={{ margin: "1rem 0" }}
              >
                {unitError || unitMessage}
              </div>
            )}

            <div
              className="ims-field-row"
              style={{
                gap: "1rem",
                flexWrap: "wrap",
                marginTop: "0.75rem",
                alignItems: "flex-end",
              }}
            >
              <div className="ims-field" style={{ minWidth: "220px" }}>
                <label className="ims-field-label" htmlFor="bulkAssignLocationId">
                  Assign all units to location
                </label>
                <select
                  id="bulkAssignLocationId"
                  className="ims-field-input"
                  value={bulkAssignLocationId}
                  onChange={(e) => setBulkAssignLocationId(e.target.value)}
                >
                  <option value="">Select location…</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ims-field">
                <button
                  type="button"
                  className="ims-secondary-button"
                  onClick={handleAssignAllUnits}
                  disabled={updatingUnits}
                >
                  {updatingUnits ? "Assigning…" : "Assign all"}
                </button>
              </div>
            </div>

            {loadingUnits ? (
              <p className="ims-table-empty">Loading units…</p>
            ) : units.length === 0 ? (
              <p className="ims-table-empty">
                No individual units yet. Create them to generate unique IDs.
              </p>
            ) : (
              <div className="ims-table-wrapper" style={{ marginTop: "1rem" }}>
                <table className="ims-table">
                  <thead>
                    <tr>
                      <th>Unit ID</th>
                      <th>Location</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {units.map((unit) => (
                      <tr key={unit.id}>
                        <td>{unit.unitCode}</td>
                        <td>
                          <select
                            className="ims-field-input"
                            value={unit.locationId ?? ""}
                            onChange={(e) =>
                              handleUnitLocationUpdate(
                                unit.id,
                                e.target.value,
                              )
                            }
                          >
                            <option value="">Unassigned</option>
                            {locations.map((loc) => (
                              <option key={loc.id} value={loc.id}>
                                {loc.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>{formatPurchaseDate(unit.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section
            className="card ims-table-card"
            style={{ marginTop: "1.5rem" }}
          >
            <div className="ims-table-header">
              <div>
                <h2 className="ims-form-section-title">
                  Recent stock movements
                </h2>
                <p className="ims-form-section-subtitle">
                  Purchases (green) add stock, utilisation (red) removes it. The
                  running balance mirrors on-hand inventory like a ledger.
                </p>
              </div>
              <div>
                <Link
                  href="/purchasing/history"
                  className="ims-secondary-button"
                >
                  View purchase history
                </Link>
              </div>
            </div>

            {purchasesError && (
              <div className="ims-alert ims-alert--error">
                {purchasesError}
              </div>
            )}
            {utilisationsError && (
              <div className="ims-alert ims-alert--error">
                {utilisationsError}
              </div>
            )}

            {ledgerIsLoading ? (
              <p className="ims-table-empty">Loading stock movements…</p>
            ) : stockMovements.length === 0 ? (
              <p className="ims-table-empty">
                No recent purchases or utilisation logged for this product.
              </p>
            ) : (
              <div className="ims-table-wrapper">
                <table className="ims-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Entry</th>
                      <th>Reference</th>
                      <th>Change</th>
                      <th>Cost / unit</th>
                      <th>Purchase value</th>
                      <th>Paid value</th>
                      <th>Balance</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {stockMovements.map((movement) => (
                      <tr key={movement.id}>
                        <td>{formatPurchaseDate(movement.timestamp)}</td>
                        <td>
                          <div style={{ fontWeight: 600 }}>
                            {movement.label}
                          </div>
                          <div className="ims-table-subtle">
                            {movement.type === "purchase"
                              ? "Purchase"
                              : "Utilisation"}
                          </div>
                        </td>
                        <td>{movement.reference || "—"}</td>
                        <td>
                          <span
                            style={{
                              color:
                                movement.type === "purchase"
                                  ? "#047857"
                                  : "#b91c1c",
                              fontWeight: 600,
                            }}
                          >
                            {movement.type === "purchase" ? "+" : "-"}
                            {Math.abs(movement.qtyChange)} {unitLabel}
                          </span>
                        </td>
                        <td>
                          {movement.costPerUnit != null
                            ? formatPurchaseCurrency(movement.costPerUnit)
                            : "—"}
                        </td>
                        <td>
                          {movement.purchaseValue != null
                            ? formatPurchaseCurrency(movement.purchaseValue)
                            : "—"}
                        </td>
                        <td>
                          {movement.paidValue != null
                            ? formatPurchaseCurrency(movement.paidValue)
                            : "—"}
                        </td>
                        <td>
                          <span style={{ fontWeight: 600 }}>
                            {movement.balanceAfter} {unitLabel}
                          </span>
                        </td>
                        <td>
                          <Link
                            href={movement.link}
                            className="ims-table-link"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
