import { normalizeItemType } from "@/lib/inventoryPaths";

export type ProjectItemCategory =
  | "products"
  | "subAssemblies"
  | "components"
  | "sensors"
  | "sensorExtras";

export const PROJECT_ITEM_CATEGORIES: ProjectItemCategory[] = [
  "products",
  "subAssemblies",
  "components",
  "sensors",
  "sensorExtras",
];

export const PROJECT_ITEM_LABELS: Record<ProjectItemCategory, string> = {
  products: "Product",
  subAssemblies: "Sub-assembly",
  components: "Component",
  sensors: "Sensor",
  sensorExtras: "Sensor extra",
};

export type ProjectItemLine = {
  itemId: string;
  itemName: string;
  qty: number;
  itemType: ProjectItemCategory;
  mustHaveItemId?: string | null;
  mustHaveItemName?: string | null;
  mustHaveQty?: number | null;
};

export type ProjectItemsByType = Record<ProjectItemCategory, ProjectItemLine[]>;

export const normalizeProjectCategory = (
  value?: string | null,
): ProjectItemCategory => {
  const normalized = normalizeItemType(value);
  if (
    normalized === "sub assembly" ||
    normalized === "sub assemblies" ||
    normalized === "subassembly"
  ) {
    return "subAssemblies";
  }
  if (normalized === "sensor" || normalized === "sensors") {
    return "sensors";
  }
  if (normalized === "sensor extra" || normalized === "sensor extras") {
    return "sensorExtras";
  }
  if (
    normalized === "product" ||
    normalized === "products" ||
    normalized === "unit" ||
    normalized === "finished good"
  ) {
    return "products";
  }
  return "components";
};

export const createEmptyItemsByType = (): ProjectItemsByType => ({
  products: [],
  subAssemblies: [],
  components: [],
  sensors: [],
  sensorExtras: [],
});

const mapProjectLine = (
  line: any,
  category: ProjectItemCategory,
): ProjectItemLine => {
  const qty = Number(line?.qty) || 0;
  const base: ProjectItemLine = {
    itemId: line?.itemId ?? "",
    itemName: line?.itemName ?? "",
    qty,
    itemType: category,
  };
  if (category === "products") {
    base.mustHaveItemId =
      typeof line?.mustHaveItemId === "string" ? line.mustHaveItemId : null;
    base.mustHaveItemName =
      typeof line?.mustHaveItemName === "string" ? line.mustHaveItemName : null;
    const mustQty =
      typeof line?.mustHaveQty === "number"
        ? line.mustHaveQty
        : Number(line?.mustHaveQty) || null;
    base.mustHaveQty =
      typeof mustQty === "number" && Number.isFinite(mustQty) && mustQty > 0
        ? mustQty
        : null;
  }
  return base;
};

export const parseProjectItems = (data: any): ProjectItemsByType => {
  const sections = createEmptyItemsByType();
  if (data && typeof data.itemsByType === "object" && data.itemsByType) {
    PROJECT_ITEM_CATEGORIES.forEach((category) => {
      const rawLines = data.itemsByType?.[category];
      if (Array.isArray(rawLines)) {
        sections[category] = rawLines
          .map((line) => mapProjectLine(line, category))
          .filter((line) => Boolean(line.itemId));
      }
    });
  } else if (Array.isArray(data?.items)) {
    data.items.forEach((line: any) => {
      const category = normalizeProjectCategory(
        line?.itemType ?? line?.type ?? line?.itemCategory ?? line?.category,
      );
      sections[category].push(mapProjectLine(line, category));
    });
  }
  return sections;
};

export const flattenProjectItems = (
  sections: ProjectItemsByType,
): ProjectItemLine[] => {
  return PROJECT_ITEM_CATEGORIES.flatMap((category) =>
    sections[category].map((line) => ({ ...line })),
  );
};

export const serializeProjectLine = (line: ProjectItemLine) => ({
  itemId: line.itemId,
  itemName: line.itemName,
  qty: line.qty,
  itemType: line.itemType,
  ...(line.mustHaveItemId ? { mustHaveItemId: line.mustHaveItemId } : {}),
  ...(line.mustHaveItemName ? { mustHaveItemName: line.mustHaveItemName } : {}),
  ...(typeof line.mustHaveQty === "number" && line.mustHaveQty > 0
    ? { mustHaveQty: line.mustHaveQty }
    : {}),
});
