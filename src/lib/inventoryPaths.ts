export const normalizeItemType = (value?: string | null) => {
  if (!value) return "";
  return value.toString().trim().toLowerCase().replace(/[\s_-]+/g, " ");
};

export const getInventoryDetailPath = (
  itemId: string,
  itemType?: string | null,
) => {
  const type = normalizeItemType(itemType);
  if (type === "product" || type === "products") {
    return `/inventory/products/${itemId}`;
  }
  if (
    type === "sub assembly" ||
    type === "sub assemblies" ||
    type === "subassembly"
  ) {
    return `/inventory/sub-assemblies/${itemId}`;
  }
  return `/inventory/components/${itemId}`;
};
