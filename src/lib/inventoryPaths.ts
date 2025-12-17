export type InventoryDetailType =
  | "products"
  | "subAssemblies"
  | "components"
  | "sensors"
  | "sensorExtras";

export const normalizeItemType = (value?: string | null) => {
  if (!value) return "";
  return value.toString().trim().toLowerCase().replace(/[\s_-]+/g, " ");
};

const deriveDetailType = (
  itemType?: string | null,
  fallback?: string | null,
): InventoryDetailType => {
  const type = normalizeItemType(itemType);
  const fallbackType = normalizeItemType(fallback);
  const combined = type || fallbackType;

  if (
    combined === "product" ||
    combined === "products" ||
    combined === "unit" ||
    fallbackType === "unit" ||
    fallbackType === "product" ||
    fallbackType === "products"
  ) {
    return "products";
  }

  if (
    combined === "sub assembly" ||
    combined === "sub assemblies" ||
    combined === "subassembly"
  ) {
    return "subAssemblies";
  }

  if (
    combined === "sensor" ||
    combined === "sensors" ||
    fallbackType === "sensor" ||
    fallbackType === "sensors" ||
    combined === "data" ||
    fallbackType === "data"
  ) {
    return "sensors";
  }

  if (
    combined === "sensor extra" ||
    combined === "sensor extras" ||
    fallbackType === "sensor extra" ||
    fallbackType === "sensor extras"
  ) {
    return "sensorExtras";
  }

  return "components";
};

export const getInventoryDetailPath = (
  itemId: string,
  itemType?: string | null,
  fallbackType?: string | null,
) => {
  const type = deriveDetailType(itemType, fallbackType);
  switch (type) {
    case "products":
      return `/inventory/products/${itemId}`;
    case "subAssemblies":
      return `/inventory/sub-assemblies/${itemId}`;
    case "sensors":
      return `/inventory/sensors/${itemId}`;
    case "sensorExtras":
      return `/inventory/sensor-extras/${itemId}`;
    default:
      return `/inventory/components/${itemId}`;
  }
};
