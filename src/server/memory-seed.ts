import type { MemoryState } from "./memory-repository";

// Demo data for the in-memory backend. Quantities are thousandths of the base unit.
const g = (grams: number) => grams * 1000;

export function seedState(): MemoryState {
  const state: MemoryState = {
    users: [
      { id: "u-owner", name: "Owner", role: "OWNER", isActive: true, branchIds: [] },
      { id: "u-staff-main", name: "Aminah", role: "STAFF", isActive: true, branchIds: ["b-main"] },
      { id: "u-staff-mall", name: "Ben", role: "STAFF", isActive: true, branchIds: ["b-mall"] },
    ],
    branches: [
      { id: "b-main", name: "Main Branch", isActive: true, timezone: "Asia/Kuala_Lumpur" },
      { id: "b-mall", name: "Mall Branch", isActive: true, timezone: "Asia/Kuala_Lumpur" },
    ],
    categories: [
      { id: "c-rice", name: "Rice", nameZh: "饭类", displayOrder: 1, isActive: true },
      { id: "c-noodles", name: "Noodles", nameZh: "面类", displayOrder: 2, isActive: true },
      { id: "c-western", name: "Western", nameZh: "西餐", displayOrder: 3, isActive: true },
      { id: "c-drinks", name: "Drinks", nameZh: "饮料", displayOrder: 4, isActive: true },
    ],
    products: [
      { id: "p-chicken-rice", categoryId: "c-rice", name: "Chicken Rice", nameZh: "鸡饭", description: null, imageUrl: null, isActive: true },
      { id: "p-fried-chicken-rice", categoryId: "c-rice", name: "Fried Chicken Rice", nameZh: "炸鸡饭", description: null, imageUrl: null, isActive: true },
      { id: "p-fried-rice", categoryId: "c-rice", name: "Fried Rice", nameZh: "炒饭", description: null, imageUrl: null, isActive: true },
      { id: "p-nasi-lemak", categoryId: "c-rice", name: "Nasi Lemak", nameZh: "椰浆饭", description: null, imageUrl: null, isActive: true },
      { id: "p-fried-mee", categoryId: "c-noodles", name: "Fried Mee", nameZh: "炒面", description: null, imageUrl: null, isActive: true },
      { id: "p-grilled-chicken-chop", categoryId: "c-western", name: "Grilled Chicken Chop", nameZh: "香煎鸡排", description: null, imageUrl: null, isActive: true },
      { id: "p-teh-tarik", categoryId: "c-drinks", name: "Teh Tarik", nameZh: "拉茶", description: null, imageUrl: null, isActive: true },
      { id: "p-iced-lemon-tea", categoryId: "c-drinks", name: "Iced Lemon Tea", nameZh: "冰柠檬茶", description: "Canned", imageUrl: null, isActive: true },
    ],
    branchProducts: [],
    ingredients: [
      { id: "i-chicken", name: "Chicken", baseUnit: "g", lowStockThreshold: g(500) },
      { id: "i-rice", name: "Rice", baseUnit: "g", lowStockThreshold: g(1000) },
      { id: "i-egg", name: "Egg", baseUnit: "pcs", lowStockThreshold: g(6) },
      { id: "i-sambal", name: "Sambal", baseUnit: "g", lowStockThreshold: g(200) },
      { id: "i-noodles", name: "Yellow Noodles", baseUnit: "g", lowStockThreshold: g(500) },
      { id: "i-oil", name: "Cooking Oil", baseUnit: "ml", lowStockThreshold: g(500) },
      { id: "i-tea", name: "Tea Powder", baseUnit: "g", lowStockThreshold: g(100) },
      { id: "i-milk", name: "Condensed Milk", baseUnit: "ml", lowStockThreshold: g(300) },
    ],
    recipes: [],
    balances: new Map(),
    movements: [],
    orders: [],
    idempotency: new Map(),
    orderCounters: new Map(),
    auditLogs: [],
  };

  const prices: [string, number][] = [
    ["p-chicken-rice", 800],
    ["p-fried-chicken-rice", 1000],
    ["p-fried-rice", 800],
    ["p-nasi-lemak", 700],
    ["p-fried-mee", 750],
    ["p-teh-tarik", 250],
    ["p-iced-lemon-tea", 300],
    ["p-grilled-chicken-chop", 1390],
  ];

  const recipe: [string, string, number][] = [
    ["p-chicken-rice", "i-chicken", g(120)],
    ["p-chicken-rice", "i-rice", g(180)],
    ["p-fried-chicken-rice", "i-chicken", g(180)],
    ["p-fried-chicken-rice", "i-rice", g(180)],
    ["p-fried-chicken-rice", "i-oil", g(20)],
    ["p-fried-rice", "i-rice", g(200)],
    ["p-fried-rice", "i-egg", g(1)],
    ["p-fried-rice", "i-oil", g(15)],
    ["p-nasi-lemak", "i-rice", g(150)],
    ["p-nasi-lemak", "i-egg", g(1)],
    ["p-nasi-lemak", "i-sambal", g(30)],
    ["p-fried-mee", "i-noodles", g(200)],
    ["p-fried-mee", "i-egg", g(1)],
    ["p-fried-mee", "i-oil", g(15)],
    ["p-teh-tarik", "i-tea", g(10)],
    ["p-teh-tarik", "i-milk", g(30)],
    ["p-grilled-chicken-chop", "i-chicken", g(200)],
    ["p-grilled-chicken-chop", "i-oil", g(15)],
    // Iced Lemon Tea is sold canned: no recipe, no estimate.
  ];

  const opening: [string, number][] = [
    ["i-chicken", g(1200)],
    ["i-rice", g(5000)],
    ["i-egg", g(30)],
    ["i-sambal", g(1000)],
    ["i-noodles", g(2000)],
    ["i-oil", g(3000)],
    ["i-tea", g(500)],
    ["i-milk", g(1000)],
  ];

  const createdAt = new Date().toISOString();
  for (const branch of state.branches) {
    for (const [productId, priceSen] of prices) {
      state.branchProducts.push({ branchId: branch.id, productId, priceSen, isAvailable: true });
    }
    for (const [productId, ingredientId, quantityPerServing] of recipe) {
      state.recipes.push({ branchId: branch.id, productId, ingredientId, quantityPerServing });
    }
    for (const [ingredientId, quantity] of opening) {
      state.balances.set(`${branch.id}:${ingredientId}`, quantity);
      state.movements.push({
        id: `m-open-${branch.id}-${ingredientId}`,
        branchId: branch.id,
        ingredientId,
        movementType: "OPENING",
        quantityDelta: quantity,
        balanceAfter: quantity,
        referenceType: null,
        referenceId: null,
        createdBy: "u-owner",
        createdAt,
      });
    }
  }

  return state;
}
