import { Timestamp, doc, writeBatch } from "firebase/firestore";
import { db } from "./firebase.js";

export const AUTHORS = [
  { id: "anya", name: "Аня" },
  { id: "lilia", name: "Лиля" },
  { id: "marina", name: "Марина" },
  { id: "olga", name: "Ольга" },
  { id: "svetlana", name: "Светлана" }
];

export const PRODUCTS = [
  { id: "marker-level-1", title: "Учусь с маркером. Уровень 1", priceKopecks: 50000, shares: { anya: 8000, lilia: 2000 } },
  { id: "marker-level-2", title: "Учусь с маркером. Уровень 2", priceKopecks: 55000, shares: { anya: 8000, lilia: 2000 } },
  { id: "story-angry", title: "Социальная история «Я злюсь»", priceKopecks: 39000, shares: { anya: 6000, marina: 4000 } },
  { id: "story-safe", title: "Социальная история «Я играю безопасно»", priceKopecks: 41000, shares: { anya: 6000, marina: 4000 } },
  { id: "lotto-emotions", title: "Лото «Эмоции»", priceKopecks: 45000, shares: { anya: 6000, olga: 4000 } },
  { id: "first-then", title: "Что сначала — что потом", priceKopecks: 42000, shares: { anya: 10000 } },
  { id: "weather-workbook", title: "Рабочая тетрадь «Погода»", priceKopecks: 32000, shares: { anya: 6000, svetlana: 4000 } },
  { id: "neuro-warmups", title: "Нейроразминки", priceKopecks: 48000, shares: { anya: 6000, svetlana: 4000 } },
  { id: "graphomotor", title: "Графомоторные дорожки", priceKopecks: 35000, shares: { anya: 10000 } },
  { id: "sound-r", title: "Автоматизация звука Р", priceKopecks: 45000, shares: { anya: 6000, olga: 4000 } }
];

function seededRandom(seed) {
  let value = seed % 2147483647;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

export function amountsFor(netKopecks, sharesBps) {
  const entries = Object.entries(sharesBps);
  let assigned = 0;
  return Object.fromEntries(entries.map(([authorId, shareBps], index) => {
    const amountKopecks = index === entries.length - 1
      ? netKopecks - assigned
      : Math.round(netKopecks * shareBps / 10000);
    assigned += amountKopecks;
    return [authorId, { shareBps, amountKopecks }];
  }));
}

const stamp = (value) => Timestamp.fromDate(new Date(value));

export async function seedDemoData(user) {
  const batch = writeBatch(db);
  const random = seededRandom(20260811);
  const authorNames = Object.fromEntries(AUTHORS.map((author) => [author.id, author.name]));
  const payoutGroups = {};
  const createdAt = Timestamp.now();

  batch.delete(doc(db, "products", "prepositions"));
  batch.delete(doc(db, "products", "weather"));
  batch.delete(doc(db, "settings", "system"));
  for (const legacyProductId of ["marker-level-1", "marker-level-2", "story-angry", "lotto-emotions", "first-then", "neuro-warmups", "graphomotor", "sound-r", "prepositions", "weather"]) {
    batch.delete(doc(db, "productSplits", `${legacyProductId}_2026-08-01`));
  }

  batch.set(doc(db, "settings", "main"), {
    taxRateBps: 400,
    payoutDay: 5,
    currency: "RUB",
    shopIntegrationStatus: "not_connected",
    telegramStatus: "planned"
  }, { merge: true });

  for (const author of AUTHORS) {
    batch.set(doc(db, "authors", author.id), {
      name: author.name,
      active: true,
      ...(author.id === "anya" ? { userId: user.uid } : {})
    }, { merge: true });
  }

  for (const product of PRODUCTS) {
    const ruleId = `${product.id}_2026-01-01`;
    const participants = Object.entries(product.shares).map(([authorId, shareBps]) => ({ authorId, shareBps }));
    batch.set(doc(db, "products", product.id), {
      title: product.title,
      basePriceKopecks: product.priceKopecks,
      type: "digital",
      active: true,
      currentRevenueRuleId: ruleId,
      createdAt
    });
    batch.set(doc(db, "revenueRules", ruleId), {
      productId: product.id,
      effectiveFrom: stamp("2026-01-01T00:00:00+03:00"),
      effectiveTo: product.id === "marker-level-1" ? stamp("2026-12-31T23:59:59+03:00") : null,
      participants,
      active: true,
      createdAt,
      createdBy: user.uid
    });
  }

  batch.set(doc(db, "revenueRules", "marker-level-1_2027-01-01"), {
    productId: "marker-level-1",
    effectiveFrom: stamp("2027-01-01T00:00:00+03:00"),
    effectiveTo: null,
    participants: [
      { authorId: "anya", shareBps: 7500 },
      { authorId: "lilia", shareBps: 2500 }
    ],
    active: true,
    createdAt,
    createdBy: user.uid
  });

  for (let index = 0; index < 60; index += 1) {
    const product = PRODUCTS[Math.floor(random() * PRODUCTS.length)];
    const monthIndex = 5 + Math.floor(index / 20); // июнь, июль, август 2026
    const day = 1 + Math.floor(random() * 27);
    const hour = 10 + Math.floor(random() * 11);
    const soldAtDate = new Date(2026, monthIndex, day, hour, Math.floor(random() * 60));
    const soldAt = Timestamp.fromDate(soldAtDate);
    const grossKopecks = product.priceKopecks;
    const taxRateBpsSnapshot = 400;
    const taxKopecks = Math.round(grossKopecks * taxRateBpsSnapshot / 10000);
    const netKopecks = grossKopecks - taxKopecks;
    const split = amountsFor(netKopecks, product.shares);
    const saleId = `demo-2026-${String(index + 1).padStart(3, "0")}`;
    const revenueRuleIdSnapshot = `${product.id}_2026-01-01`;
    const distributionSnapshot = Object.entries(split).map(([authorId, item]) => ({
      authorId,
      authorNameSnapshot: authorNames[authorId],
      shareBps: item.shareBps,
      amountKopecks: item.amountKopecks
    }));

    batch.set(doc(db, "sales", saleId), {
      soldAt,
      productId: product.id,
      productTitleSnapshot: product.title,
      productTypeSnapshot: "digital",
      grossKopecks,
      taxRateBpsSnapshot,
      taxKopecks,
      netKopecks,
      revenueRuleIdSnapshot,
      distributionSnapshot,
      participantAuthorIds: Object.keys(product.shares),
      source: "manual",
      status: "paid",
      externalOrderId: null,
      createdBy: user.uid,
      createdAt
    });

    for (const [authorId, earning] of Object.entries(split)) {
      const paidMonth = monthIndex < 7;
      const payoutId = paidMonth ? `2026-${String(monthIndex + 1).padStart(2, "0")}_${authorId}` : null;
      batch.set(doc(db, "earnings", `${saleId}_${authorId}`), {
        saleId,
        authorId,
        soldAt,
        productId: product.id,
        productTitleSnapshot: product.title,
        grossKopecks,
        taxRateBpsSnapshot,
        netKopecks,
        shareBpsSnapshot: earning.shareBps,
        amountKopecks: earning.amountKopecks,
        payoutId,
        payoutStatus: paidMonth ? "paid" : "unpaid",
        createdAt
      });

      if (authorId !== "anya") {
        const groupId = `${monthIndex}_${authorId}`;
        payoutGroups[groupId] ??= { authorId, monthIndex, amountKopecks: 0, earningIds: [] };
        payoutGroups[groupId].amountKopecks += earning.amountKopecks;
        payoutGroups[groupId].earningIds.push(`${saleId}_${authorId}`);
      }
    }
  }

  for (const group of Object.values(payoutGroups)) {
    const month = group.monthIndex + 1;
    const payoutId = `2026-${String(month).padStart(2, "0")}_${group.authorId}`;
    const paid = group.monthIndex < 7;
    if (!paid) {
      batch.delete(doc(db, "payouts", payoutId));
      continue;
    }
    const periodStart = new Date(2026, group.monthIndex, 1, 0, 0, 0);
    const periodEnd = new Date(2026, group.monthIndex + 1, 0, 23, 59, 59);
    const dueDate = new Date(2026, group.monthIndex + 1, 5, 12, 0, 0);
    batch.set(doc(db, "payouts", payoutId), {
      authorId: group.authorId,
      authorNameSnapshot: authorNames[group.authorId],
      periodStart: Timestamp.fromDate(periodStart),
      periodEnd: Timestamp.fromDate(periodEnd),
      dueDate: Timestamp.fromDate(dueDate),
      amountKopecks: group.amountKopecks,
      earningIds: group.earningIds,
      status: "paid",
      paidAt: Timestamp.fromDate(dueDate),
      createdAt,
      createdBy: user.uid
    });
  }

  await batch.commit();
}
