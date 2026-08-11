import "./styles.css";
import { createUserWithEmailAndPassword, onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, signOut } from "firebase/auth";
import {
  Timestamp, collection, doc, getDoc, getDocs, query, where, writeBatch
} from "firebase/firestore";
import { auth, db, userCreatorAuth } from "./firebase.js";
import { amountsFor, seedDemoData } from "./seed.js";

const app = document.querySelector("#app");
const state = {
  user: null, profile: null, authors: [], products: [], revenueRules: [], sales: [], earnings: [], payouts: [],
  settings: { taxRateBps: 400, payoutDay: 5, currency: "RUB" },
  view: "dashboard", notice: "", ruleProductId: null,
  filters: { month: "all", product: "all", author: "all", type: "all", source: "all", status: "all" },
  authorMonth: "all",
  demoMode: false
};

const rubles = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
const monthFormatter = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" });
const asDate = (value) => value?.toDate ? value.toDate() : new Date(value);
const dateText = (value) => value ? dateFormatter.format(asDate(value)) : "—";
const timeText = (value) => value ? timeFormatter.format(asDate(value)) : "—";
const rub = (value = 0) => rubles.format(value / 100);
const escapeHtml = (value = "") => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const sortByDate = (items, field) => [...items].sort((a, b) => asDate(b[field]) - asDate(a[field]));
const sum = (items, getter) => items.reduce((total, item) => total + getter(item), 0);
const saleTitle = (sale) => sale.productTitleSnapshot || sale.productTitle || "Без названия";
const saleGross = (sale) => sale.grossKopecks ?? Math.round((sale.grossAmount || 0) * 100);
const saleTax = (sale) => sale.taxKopecks ?? Math.round((sale.taxAmount || 0) * 100);
const saleNet = (sale) => sale.netKopecks ?? Math.round((sale.netAmount || 0) * 100);
const earningAmount = (item) => item.amountKopecks ?? Math.round((item.amount || 0) * 100);
const earningDate = (item) => item.soldAt || item.date;
const earningShare = (item) => item.shareBpsSnapshot ?? Math.round((item.percent || 0) * 100);
const payoutAmount = (item) => item.amountKopecks ?? Math.round((item.amount || 0) * 100);
const payoutStatus = (item) => item.payoutStatus || item.status || "unpaid";
const authorName = (id) => state.authors.find((item) => item.id === id)?.name || id;
const monthKey = (value) => {
  const date = asDate(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

async function readCollection(name, constraint = null) {
  const source = constraint ? query(collection(db, name), constraint) : collection(db, name);
  const snapshot = await getDocs(source);
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

async function loadData() {
  if (!state.profile) return;
  if (state.profile.role === "admin") {
    const [authors, products, revenueRules, sales, earnings, payouts, settingsSnapshot] = await Promise.all([
      readCollection("authors"), readCollection("products"), readCollection("revenueRules"), readCollection("sales"),
      readCollection("earnings"), readCollection("payouts"), getDoc(doc(db, "settings", "main"))
    ]);
    Object.assign(state, { authors, products, revenueRules, sales, earnings, payouts });
    if (settingsSnapshot.exists()) state.settings = settingsSnapshot.data();
  } else {
    const authorId = state.profile.authorId;
    const [earnings, payouts] = await Promise.all([
      readCollection("earnings", where("authorId", "==", authorId)),
      readCollection("payouts", where("authorId", "==", authorId))
    ]);
    Object.assign(state, { earnings, payouts, authors: [], products: [], revenueRules: [], sales: [] });
  }
}

function loginScreen(error = "") {
  app.innerHTML = `<main class="login-shell"><section class="login-frame" aria-labelledby="login-title">
    <div class="login-visual" aria-hidden="true"><div class="visual-orb orb-one"></div><div class="visual-orb orb-two"></div>
      <div class="login-visual-copy"><div class="brand-mark">АШ</div><p>Финансы творческой команды</p><strong>Всё важное — спокойно, понятно и в одном месте.</strong></div>
      <div class="visual-card visual-card-main"><span>Ближайшая выплата</span><strong>5 сентября</strong><i></i></div>
      <div class="visual-card visual-card-small"><span>Начисления</span><strong>Под контролем</strong></div>
    </div>
    <div class="login-card"><p class="eyebrow">АутШкола</p><h1 id="login-title">Кабинет авторов</h1>
      <p class="muted">Продажи, начисления и выплаты — в одном месте.</p>
      ${error ? `<p class="alert" role="alert">${escapeHtml(error)}</p>` : ""}
      <form id="login-form" class="stack"><label>Email<input name="email" type="email" autocomplete="email" required></label>
      <label>Пароль<input name="password" type="password" autocomplete="current-password" required></label>
      <button class="primary" type="submit">Войти</button></form>
      <div class="login-divider"><span>или</span></div>
      <button id="demo-login" class="demo-login" type="button"><strong>Посмотреть демо</strong><span>Готовый кабинет Марины с тестовыми данными</span></button>
      <p class="demo-caption">Только просмотр · изменения данных недоступны</p>
    </div></section></main>`;
  document.querySelector("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const button = event.currentTarget.querySelector("button");
    button.disabled = true; button.textContent = "Входим…";
    try { await signInWithEmailAndPassword(auth, form.get("email"), form.get("password")); }
    catch { loginScreen("Не удалось войти. Проверь почту и пароль."); }
  });
  document.querySelector("#demo-login").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.querySelector("strong").textContent = "Открываю демо…";
    try {
      await signInAnonymously(auth);
    } catch (error) {
      console.error(error);
      loginScreen("Демо временно недоступно. Попробуй ещё раз позже.");
    }
  });
}

const card = (label, value, tone = "", note = "") => `<article class="metric ${tone}"><span>${label}</span><strong>${value}</strong>${note ? `<small>${note}</small>` : ""}</article>`;
const activeSales = () => state.sales.filter((item) => item.status === "paid");
const unpaidEmployeeEarnings = () => state.earnings.filter((item) => item.authorId !== "anya" && payoutStatus(item) === "unpaid");

function dashboardView() {
  const now = new Date();
  const monthlySales = activeSales().filter((item) => {
    const date = asDate(item.soldAt);
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  });
  const monthlySaleIds = new Set(monthlySales.map((item) => item.id));
  const monthlyEarnings = state.earnings.filter((item) => monthlySaleIds.has(item.saleId));
  const gross = sum(monthlySales, saleGross);
  const tax = sum(monthlySales, saleTax);
  const staff = sum(monthlyEarnings.filter((item) => item.authorId !== "anya"), earningAmount);
  const myIncome = sum(monthlyEarnings.filter((item) => item.authorId === "anya"), earningAmount);
  const reserve = sum(unpaidEmployeeEarnings(), earningAmount);
  const average = monthlySales.length ? Math.round(gross / monthlySales.length) : 0;
  return `<section class="page-heading"><div><p class="eyebrow">Обзор</p><h2>Финансы АутШколы</h2><p class="muted">${escapeHtml(monthFormatter.format(now))}</p></div>
    <button id="seed-button" class="secondary">Обновить демо-данные</button></section>
    <section class="admin-overview-grid">
      <article class="finance-overview"><div class="overview-heading"><div><span>Выручка за месяц</span><strong>${rub(gross)}</strong></div><span class="trend-badge">${monthlySales.length} продаж</span></div>
        <div class="overview-kpis">${card("Налог", rub(tax))}${card("Начислено команде", rub(staff))}${card("Мой доход", rub(myIncome), "soft")}</div>
      </article>
      <article class="reserve-card"><div class="reserve-icon" aria-hidden="true">↗</div><div><span>Зарплатный резерв</span><strong>${rub(reserve)}</strong></div><p>Необходимая сумма на зарплатном счёте на сегодняшний день</p></article>
    </section>
    <section class="admin-lower-grid"><section class="panel sales-panel"><div class="panel-title"><div><p class="section-kicker">Операции</p><h3>Последние продажи</h3></div><button class="link-button" data-view="sales">Все продажи</button></div>${compactSalesTable(sortByDate(activeSales(), "soldAt").slice(0, 8))}</section>
      <aside class="insight-card"><p class="section-kicker">В этом месяце</p><h3>Коротко о продажах</h3><div class="insight-stat"><span>Средний чек</span><strong>${rub(average)}</strong></div><div class="insight-stat"><span>Операций</span><strong>${monthlySales.length}</strong></div><div class="insight-visual" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div></aside>
    </section>`;
}

function compactSalesTable(items) {
  return `<div class="table-wrap"><table><thead><tr><th>Дата</th><th>Время</th><th>Товар</th><th>Цена</th><th>Налог</th><th>После налога</th></tr></thead><tbody>
    ${items.length ? sortByDate(items, "soldAt").map((sale) => `<tr><td>${dateText(sale.soldAt)}</td><td>${timeText(sale.soldAt)}</td><td>${escapeHtml(saleTitle(sale))}</td><td>${rub(saleGross(sale))}</td><td>${rub(saleTax(sale))}</td><td>${rub(saleNet(sale))}</td></tr>`).join("") : `<tr><td colspan="6" class="empty">Пока нет продаж</td></tr>`}
  </tbody></table></div>`;
}

function filteredSales() {
  return state.sales.filter((sale) => {
    const f = state.filters;
    return (f.month === "all" || monthKey(sale.soldAt) === f.month)
      && (f.product === "all" || sale.productId === f.product)
      && (f.author === "all" || (sale.participantAuthorIds || []).includes(f.author))
      && (f.type === "all" || (sale.productTypeSnapshot || sale.productType) === f.type)
      && (f.source === "all" || sale.source === f.source)
      && (f.status === "all" || sale.status === f.status);
  });
}

function filterSelect(name, label, options) {
  return `<label>${label}<select data-filter="${name}">${options.map(([value, text]) => `<option value="${value}" ${state.filters[name] === value ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}</select></label>`;
}

function salesView() {
  const months = [...new Set(state.sales.map((item) => monthKey(item.soldAt)))].sort().reverse();
  const rows = sortByDate(filteredSales(), "soldAt");
  const now = new Date();
  const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const localTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return `<section class="page-heading"><div><p class="eyebrow">Продажи</p><h2>История операций</h2></div></section>
    <div class="two-columns"><section class="panel"><h3>Новая продажа</h3><form id="sale-form" class="stack compact">
      <div class="form-row"><label>Дата<input name="soldAt" type="date" required value="${localDate}"></label><label>Время<input name="soldTime" type="time" required value="${localTime}"></label></div>
      <label>Товар<select name="productId" required>${state.products.filter((p) => p.active !== false).map((p) => `<option value="${p.id}">${escapeHtml(p.title)}</option>`).join("")}</select></label>
      <label>Стоимость, ₽<input name="amount" type="number" min="1" step="0.01" required value="${(state.products[0]?.basePriceKopecks || state.products[0]?.price * 100 || 50000) / 100}"></label>
      <label>Источник<select name="source"><option value="manual">Ручная продажа</option><option value="voice">Голосовой ввод (заглушка)</option><option value="shop">Магазин (не подключён)</option></select></label>
      <div class="button-row"><button class="primary" type="submit">Сохранить продажу</button><button id="voice-button" class="secondary" type="button">🎙 Добавить голосом</button></div>
    </form></section><section id="sale-preview" class="panel sale-preview">${salePreviewHtml()}</section></div>
    <section class="panel"><div class="filter-grid">
      ${filterSelect("month", "Период", [["all", "Все месяцы"], ...months.map((m) => [m, m])])}
      ${filterSelect("product", "Товар", [["all", "Все товары"], ...state.products.map((p) => [p.id, p.title])])}
      ${filterSelect("author", "Участник", [["all", "Все участники"], ...state.authors.map((a) => [a.id, a.name])])}
      ${filterSelect("type", "Тип", [["all", "Все типы"], ["digital", "Digital"], ["physical", "Physical"]])}
      ${filterSelect("source", "Источник", [["all", "Все"], ["manual", "Ручной"], ["shop", "Магазин"], ["voice", "Голос"]])}
      ${filterSelect("status", "Статус", [["all", "Все"], ["paid", "Оплачено"], ["refunded", "Возврат"], ["cancelled", "Отменено"]])}
    </div><p class="table-count">Найдено операций: ${rows.length}</p><div class="table-wrap"><table><thead><tr><th>Дата</th><th>Время</th><th>Товар</th><th>Тип</th><th>Цена</th><th>Налог</th><th>Участники и распределение</th><th>Источник</th><th>Статус</th></tr></thead><tbody>
      ${rows.length ? rows.slice(0, 60).map(fullSaleRow).join("") : `<tr><td colspan="9" class="empty">По выбранным фильтрам продаж нет</td></tr>`}
    </tbody></table></div><p class="hint">Функциональность возвратов зарезервирована для физических товаров.</p></section>`;
}

function findRule(productId, date = new Date()) {
  const rules = state.revenueRules.filter((item) => item.productId === productId && item.active !== false)
    .filter((item) => asDate(item.effectiveFrom) <= date && (!item.effectiveTo || asDate(item.effectiveTo) >= date))
    .sort((a, b) => asDate(b.effectiveFrom) - asDate(a.effectiveFrom));
  return rules[0] || null;
}

function sharesForProduct(product, date = new Date()) {
  const rule = findRule(product?.id, date);
  if (rule) return { ruleId: rule.id, shares: Object.fromEntries(rule.participants.map((p) => [p.authorId, p.shareBps])) };
  const legacy = product?.currentShares || {};
  return { ruleId: product?.currentRevenueRuleId || "legacy", shares: Object.fromEntries(Object.entries(legacy).map(([id, percent]) => [id, percent * 100])) };
}

function salePreviewHtml(productId, amountRubles, soldDate) {
  const product = state.products.find((item) => item.id === productId) || state.products[0];
  if (!product) return `<h3>Предварительный расчёт</h3><p>Сначала добавь товары.</p>`;
  const gross = Math.round(Number(amountRubles ?? ((product.basePriceKopecks || product.price * 100) / 100)) * 100);
  const taxBps = state.settings.taxRateBps || 400;
  const tax = Math.round(gross * taxBps / 10000);
  const net = gross - tax;
  const { shares } = sharesForProduct(product, soldDate || new Date());
  const split = amountsFor(net, shares);
  return `<h3>Предварительный расчёт</h3><dl class="calculation"><div><dt>Стоимость</dt><dd>${rub(gross)}</dd></div><div><dt>Налог ${taxBps / 100}%</dt><dd>−${rub(tax)}</dd></div><div class="total"><dt>После налога</dt><dd>${rub(net)}</dd></div>${Object.entries(split).map(([id, item]) => `<div><dt>${escapeHtml(authorName(id))} ${item.shareBps / 100}%</dt><dd>${rub(item.amountKopecks)}</dd></div>`).join("")}</dl>`;
}

function distributionForSale(sale) {
  if (sale.distributionSnapshot) return sale.distributionSnapshot;
  return Object.entries(sale.split || {}).map(([authorId, item]) => ({ authorId, authorNameSnapshot: authorName(authorId), shareBps: (item.percent || 0) * 100, amountKopecks: (item.amount || 0) * 100 }));
}

function fullSaleRow(sale) {
  const distribution = distributionForSale(sale).map((part) => `${escapeHtml(part.authorNameSnapshot || authorName(part.authorId))} ${part.shareBps / 100}% — ${rub(part.amountKopecks)}`).join("<br>");
  const source = { manual: "Ручной", shop: "Магазин", voice: "Голос" }[sale.source] || sale.source;
  const status = { paid: "Оплачено", refunded: "Возврат", cancelled: "Отменено" }[sale.status] || sale.status;
  return `<tr><td>${dateText(sale.soldAt)}</td><td>${timeText(sale.soldAt)}</td><td>${escapeHtml(saleTitle(sale))}</td><td>${escapeHtml(sale.productTypeSnapshot || sale.productType || "digital")}</td><td>${rub(saleGross(sale))}</td><td>${rub(saleTax(sale))}</td><td class="distribution">${distribution}</td><td>${source}</td><td><span class="status ${sale.status === "paid" ? "success" : ""}">${status}</span></td></tr>`;
}

function productsView() {
  const editProduct = state.products.find((p) => p.id === state.ruleProductId);
  return `<section class="page-heading"><div><p class="eyebrow">Каталог</p><h2>Товары и правила дохода</h2></div></section>
    ${editProduct ? revenueRuleForm(editProduct) : ""}
    <div class="product-grid">${state.products.map((product) => {
      const rules = state.revenueRules.filter((rule) => rule.productId === product.id).sort((a, b) => asDate(b.effectiveFrom) - asDate(a.effectiveFrom));
      const productSales = state.sales.filter((sale) => sale.productId === product.id && sale.status === "paid");
      const current = findRule(product.id);
      return `<article class="product-card"><div class="product-meta"><span class="pill">${escapeHtml(product.type === "digital" || !product.type ? "Цифровой" : product.type)}</span><span class="status ${product.active === false ? "" : "active"}">${product.active === false ? "Архив" : "Активен"}</span></div>
        <h3>${escapeHtml(product.title)}</h3><div class="product-price">${rub(product.basePriceKopecks ?? product.price * 100)}</div>
        <div class="product-stats"><span><small>Продаж</small><strong>${productSales.length}</strong></span><span><small>Выручка</small><strong>${rub(sum(productSales, saleGross))}</strong></span></div>
        <div class="shares"><small>Распределение долей</small>${(current?.participants || []).map((part) => `<span>${escapeHtml(authorName(part.authorId))}<b>${part.shareBps / 100}%</b></span>`).join("") || "Нет действующего правила"}</div>
        <details><summary>История правил (${rules.length})</summary>${rules.map((rule) => `<p class="rule-line"><b>${dateText(rule.effectiveFrom)} — ${rule.effectiveTo ? dateText(rule.effectiveTo) : "далее"}</b><br>${rule.participants.map((p) => `${escapeHtml(authorName(p.authorId))} ${p.shareBps / 100}%`).join(" · ")}</p>`).join("")}</details>
        <button class="secondary full" data-edit-rule="${product.id}">Изменить распределение</button></article>`;
    }).join("")}</div>`;
}

function revenueRuleForm(product) {
  const current = findRule(product.id);
  const currentMap = Object.fromEntries((current?.participants || []).map((p) => [p.authorId, p.shareBps / 100]));
  return `<section class="panel rule-editor"><div class="panel-title"><div><h3>Новое правило: ${escapeHtml(product.title)}</h3><p>Старое правило останется в истории и в снимках продаж.</p></div><button class="link-button" id="cancel-rule">Закрыть</button></div>
    <form id="rule-form" class="stack compact"><input type="hidden" name="productId" value="${product.id}"><label>Новое правило начинает действовать с<input type="date" name="effectiveFrom" required value="2027-01-01"></label>
    <div class="rule-fields">${state.authors.map((author) => `<label>${escapeHtml(author.name)}, %<input type="number" name="share_${author.id}" min="0" max="100" step="1" value="${currentMap[author.id] || 0}"></label>`).join("")}</div>
    <p class="hint">Итого должно быть ровно 100%.</p><button class="primary" type="submit">Сохранить новое правило</button></form></section>`;
}

function authorsView() {
  const awaiting = unpaidEmployeeEarnings();
  const awaitingAuthors = new Set(awaiting.map((item) => item.authorId)).size;
  const totalDue = sum(awaiting, earningAmount);
  return `<section class="page-heading"><div><p class="eyebrow">Команда</p><h2>Авторы</h2></div></section>
    <div class="compact-summary">${card("Авторов", state.authors.length)}${card("Ожидают выплаты", awaitingAuthors)}${card("Общая сумма к выплате", rub(totalDue))}</div>
    <section class="panel"><div class="panel-title"><div><h3>Создать доступ сотруднику</h3><p>Аккаунт создаёт только администратор. Самостоятельной регистрации в приложении нет.</p></div></div>
      <form id="author-access-form" class="access-form" autocomplete="off"><label>Автор<select name="authorId" required>${state.authors.filter((a) => a.id !== "anya" && !a.userId).map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("")}</select></label><label>Учебный email<input name="employeeEmail" type="text" inputmode="email" autocomplete="off" required></label><label>Временный пароль<input name="temporaryPassword" type="password" autocomplete="new-password" minlength="8" required></label><button class="primary" type="submit">Создать доступ</button></form>
    </section><section class="panel"><div class="table-wrap"><table><thead><tr><th>Имя</th><th>Доступ</th><th>Активен</th><th>Товаров</th><th>Продаж</th><th>Заработано</th><th>Ожидает выплаты</th></tr></thead><tbody>
    ${state.authors.map((author) => {
      const earnings = state.earnings.filter((item) => item.authorId === author.id);
      const rules = state.revenueRules.filter((rule) => rule.participants?.some((p) => p.authorId === author.id));
      const products = new Set(rules.map((rule) => rule.productId));
      const sales = new Set(earnings.map((item) => item.saleId));
      const unpaid = earnings.filter((item) => payoutStatus(item) === "unpaid");
      const productNames = [...products].map((id) => state.products.find((p) => p.id === id)?.title).filter(Boolean);
      const payouts = state.payouts.filter((p) => p.authorId === author.id);
      return `<tr><td><strong>${escapeHtml(author.name)}</strong><details class="mini-detail"><summary>Подробнее</summary><small><b>Товары:</b> ${escapeHtml(productNames.join(", ") || "нет")}</small><small><b>Начислений:</b> ${earnings.length}; <b>выплат:</b> ${payouts.length}</small></details></td><td>${author.userId ? "Есть" : "Нет"}</td><td>${author.active === false ? "Нет" : "Да"}</td><td>${products.size}</td><td>${sales.size}</td><td>${rub(sum(earnings, earningAmount))}</td><td>${rub(sum(unpaid, earningAmount))}</td></tr>`;
    }).join("")}</tbody></table></div></section>`;
}

function payoutsView() {
  if (state.profile.role !== "admin") return myPayoutsView();
  const reserve = sum(unpaidEmployeeEarnings(), earningAmount);
  return `<section class="page-heading"><div><p class="eyebrow">Расчёты</p><h2>Выплаты</h2><p class="muted">Всего нужно выплатить сейчас: <strong>${rub(reserve)}</strong></p></div></section>
    <div class="payout-grid">${state.authors.filter((a) => a.id !== "anya").map((author) => {
      const earnings = state.earnings.filter((item) => item.authorId === author.id && payoutStatus(item) === "unpaid");
      return `<article class="author-card"><div class="avatar">${escapeHtml(author.name[0])}</div><div class="grow"><h3>${escapeHtml(author.name)}</h3><p>${earnings.length} начислений</p><strong>${rub(sum(earnings, earningAmount))}</strong><button class="secondary full" data-form-payout="${author.id}" ${earnings.length ? "" : "disabled"}>Сформировать выплату</button></div></article>`;
    }).join("")}</div>
    <section class="panel"><h3>История и запланированные выплаты</h3><div class="table-wrap"><table><thead><tr><th>Автор</th><th>Период</th><th>Срок</th><th>Продаж</th><th>Сумма</th><th>Статус</th><th></th></tr></thead><tbody>
      ${state.payouts.length ? sortByDate(state.payouts, "dueDate").map((payout) => `<tr><td>${escapeHtml(payout.authorNameSnapshot || payout.authorName || authorName(payout.authorId))}</td><td>${dateText(payout.periodStart)}–${dateText(payout.periodEnd)}</td><td>${dateText(payout.dueDate)}</td><td>${payout.earningIds?.length || "—"}</td><td>${rub(payoutAmount(payout))}</td><td><span class="status ${payout.status === "paid" ? "success" : ""}">${payout.status === "paid" ? "Выплачено" : "Запланировано"}</span></td><td>${payout.status === "planned" ? `<button class="secondary" data-pay-payout="${payout.id}">Отметить как выплачено</button>` : ""}</td></tr>`).join("") : `<tr><td colspan="7" class="empty">Выплат пока нет</td></tr>`}
    </tbody></table></div></section>`;
}

function payoutDetails(payout) {
  const linked = payout.earningIds?.length ? state.earnings.filter((e) => payout.earningIds.includes(e.id)) : state.earnings.filter((e) => e.payoutId === payout.id);
  return `<details class="payout-detail"><summary><span>${escapeHtml(monthFormatter.format(asDate(payout.periodStart)))}</span><strong>${rub(payoutAmount(payout))}</strong><em>${payout.status === "paid" ? `Выплачено ${dateText(payout.paidAt || payout.dueDate)}` : `Запланировано на ${dateText(payout.dueDate)}`}</em></summary>
    <div class="table-wrap"><table><thead><tr><th>Дата</th><th>Товар</th><th>Сумма продажи</th><th>Доля</th><th>Начислено</th></tr></thead><tbody>${linked.map((e) => `<tr><td>${dateText(earningDate(e))}</td><td>${escapeHtml(e.productTitleSnapshot || e.productTitle)}</td><td>${rub(e.grossKopecks ?? e.grossAmount * 100)}</td><td>${earningShare(e) / 100}%</td><td>${rub(earningAmount(e))}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">Детализация недоступна</td></tr>`}</tbody></table></div></details>`;
}

function myPayoutsView() {
  const paid = state.payouts.filter((payout) => payout.status === "paid");
  const latest = [...paid].sort((a, b) => asDate(b.paidAt || b.dueDate) - asDate(a.paidAt || a.dueDate))[0];
  const now = new Date();
  const day = state.settings.payoutDay || 5;
  const nextDate = now.getDate() < day ? new Date(now.getFullYear(), now.getMonth(), day) : new Date(now.getFullYear(), now.getMonth() + 1, day);
  return `<section class="page-heading"><div><p class="eyebrow">Мой кабинет</p><h2>Мои выплаты</h2></div></section>
    <div class="compact-summary payout-summary">${card("Всего выплачено", rub(sum(paid, payoutAmount)))}${card("Последняя выплата", latest ? rub(payoutAmount(latest)) : "—", "", latest ? dateText(latest.paidAt || latest.dueDate) : "Выплат пока нет")}${card("Ближайшая дата выплаты", dateText(nextDate))}</div>
    <section class="panel payout-list">${sortByDate(state.payouts, "periodStart").map(payoutDetails).join("") || `<p class="empty">Выплат пока нет</p>`}</section>`;
}

function payoutProgress() {
  const now = new Date();
  const day = state.settings.payoutDay || 5;
  const previous = now.getDate() >= day ? new Date(now.getFullYear(), now.getMonth(), day) : new Date(now.getFullYear(), now.getMonth() - 1, day);
  const next = now.getDate() >= day ? new Date(now.getFullYear(), now.getMonth() + 1, day) : new Date(now.getFullYear(), now.getMonth(), day);
  const total = next - previous;
  const elapsed = Math.max(0, Math.min(total, now - previous));
  const percent = Math.round(elapsed / total * 100);
  const days = Math.ceil((next - now) / 86400000);
  return `<div class="author-payout-progress"><div class="progress-copy"><strong>${now.getDate() === day ? "Сегодня день выплаты" : `До выплаты осталось ${days} ${days % 10 === 1 && days % 100 !== 11 ? "день" : "дней"}`}</strong><span>${percent}% периода прошло</span></div><div class="progress-track" aria-label="Прогресс до выплаты"><span style="width:${percent}%"></span></div><div class="progress-labels"><span>${dateText(previous)}</span><span>${dateText(next)}</span></div></div>`;
}

function authorDashboard() {
  const now = new Date();
  const total = sum(state.earnings, earningAmount);
  const current = state.earnings.filter((item) => { const d = asDate(earningDate(item)); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
  const unpaid = state.earnings.filter((item) => payoutStatus(item) === "unpaid");
  const nextPayout = (() => { const d = state.settings.payoutDay || 5; return now.getDate() < d ? new Date(now.getFullYear(), now.getMonth(), d) : new Date(now.getFullYear(), now.getMonth() + 1, d); })();
  const months = [...new Set(state.earnings.map((item) => monthKey(earningDate(item))))].sort().reverse();
  const rows = [...state.earnings].filter((item) => state.authorMonth === "all" || monthKey(earningDate(item)) === state.authorMonth).sort((a, b) => asDate(earningDate(b)) - asDate(earningDate(a))).slice(0, 50);
  return `<section class="page-heading author-heading"><div><p class="eyebrow">Мой кабинет</p><h2>Здравствуйте, ${escapeHtml(state.profile.name)}</h2></div><button class="secondary" data-view="payouts">Посмотреть выплаты</button></section>
    <section class="author-finance-grid"><article class="author-payout-hero"><div class="hero-top"><div><span>К ближайшей выплате</span><strong>${rub(sum(unpaid, earningAmount))}</strong><p>${escapeHtml(monthFormatter.format(nextPayout))}</p></div><div class="hero-date-mark">${nextPayout.getDate()}</div></div>${payoutProgress()}</article>
      <div class="author-secondary-metrics">${card("Заработано в этом месяце", rub(sum(current, earningAmount)), "monthly")}${card("Всего заработано", rub(total), "total")}</div></section>
    <section class="panel earnings-panel"><div class="panel-title"><div><p class="section-kicker">История</p><h3>Мои начисления</h3></div><label class="inline-filter">Месяц<select id="author-month-filter"><option value="all">Все месяцы</option>${months.map((m) => `<option value="${m}" ${state.authorMonth === m ? "selected" : ""}>${m}</option>`).join("")}</select></label></div><div class="table-wrap"><table><thead><tr><th>№</th><th>Дата</th><th>Время</th><th>Товар</th><th>Цена</th><th>Налог</th><th>Доля</th><th>Начислено</th></tr></thead><tbody>
      ${rows.map((e, index) => `<tr><td>${index + 1}</td><td>${dateText(earningDate(e))}</td><td>${timeText(earningDate(e))}</td><td>${escapeHtml(e.productTitleSnapshot || e.productTitle)}</td><td>${rub(e.grossKopecks ?? e.grossAmount * 100)}</td><td>${(e.taxRateBpsSnapshot ?? 400) / 100}%</td><td>${earningShare(e) / 100}%</td><td>${rub(earningAmount(e))}</td></tr>`).join("") || `<tr><td colspan="8" class="empty">Начислений пока нет</td></tr>`}
    </tbody></table></div></section>`;
}

function statisticsView() {
  const months = [...new Set(state.sales.map((item) => monthKey(item.soldAt)))].sort().reverse();
  const sales = state.sales.filter((sale) => sale.status === "paid" && (state.filters.month === "all" || monthKey(sale.soldAt) === state.filters.month));
  const byMonth = Object.entries(sales.reduce((acc, sale) => { const key = monthKey(sale.soldAt); acc[key] = (acc[key] || 0) + saleGross(sale); return acc; }, {})).sort();
  const maxMonth = Math.max(1, ...byMonth.map(([, value]) => value));
  const productStats = state.products.map((product) => { const rows = sales.filter((sale) => sale.productId === product.id); return { ...product, count: rows.length, gross: sum(rows, saleGross) }; }).sort((a, b) => b.count - a.count);
  return `<section class="page-heading"><div><p class="eyebrow">Аналитика</p><h2>Статистика</h2></div><label class="inline-filter">Период<select data-filter="month"><option value="all">Все месяцы</option>${months.map((m) => `<option value="${m}" ${state.filters.month === m ? "selected" : ""}>${m}</option>`).join("")}</select></label></section>
    <section class="panel"><h3>Продажи по месяцам</h3><div class="bar-chart">${byMonth.map(([label, value]) => `<div><span>${label}</span><i><b style="width:${Math.round(value / maxMonth * 100)}%"></b></i><strong>${rub(value)}</strong></div>`).join("")}</div></section>
    <div class="two-columns"><section class="panel"><h3>Топ-5 товаров</h3>${productStats.slice(0, 5).map((p, i) => `<div class="ranking"><span>${i + 1}</span><div><b>${escapeHtml(p.title)}</b><small>${p.count} продаж</small></div><strong>${rub(p.gross)}</strong></div>`).join("")}</section>
    <section class="panel"><h3>По авторам</h3>${state.authors.map((author) => { const items = state.earnings.filter((e) => e.authorId === author.id && sales.some((s) => s.id === e.saleId)); return `<div class="ranking"><div class="avatar tiny">${escapeHtml(author.name[0])}</div><div><b>${escapeHtml(author.name)}</b><small>${new Set(items.map((e) => e.saleId)).size} продаж</small></div><strong>${rub(sum(items, earningAmount))}</strong></div>`; }).join("")}</section></div>
    <section class="panel"><h3>Все товары</h3><div class="table-wrap"><table><thead><tr><th>Товар</th><th>Продаж</th><th>Выручка</th></tr></thead><tbody>${productStats.map((p) => `<tr><td>${escapeHtml(p.title)}</td><td>${p.count}</td><td>${rub(p.gross)}</td></tr>`).join("")}</tbody></table></div></section>`;
}

function integrationsView() {
  return `<section class="page-heading"><div><p class="eyebrow">Настройки</p><h2>Интеграции</h2></div></section><div class="integration-grid">
    <article class="integration-card"><div class="integration-icon">🛍️</div><h3>Автоматическое получение заказов</h3><span class="status warning">Не подключено</span><p>Будущие продажи из магазина будут создаваться только после подтверждения оплаты. Поле <code>externalOrderId</code> уже предусмотрено.</p></article>
    <article class="integration-card"><div class="integration-icon">✈️</div><h3>Telegram</h3><span class="status">Запланировано</span><p>После продажи бот сможет сообщить, сколько перевести в зарплатный резерв. Реальный Telegram API не подключён.</p></article>
    <article class="integration-card"><div class="integration-icon">🎙️</div><h3>Голосовой ввод</h3><span class="status">Следующая версия</span><p>Архитектура поддерживает <code>source: voice</code>, но Speech-to-Text API сейчас не используется.</p></article>
  </div>`;
}

function layout() {
  const admin = state.profile.role === "admin";
  const views = admin
    ? [["dashboard", "Обзор"], ["sales", "Продажи"], ["products", "Товары"], ["authors", "Авторы"], ["payouts", "Выплаты"], ["statistics", "Статистика"], ["integrations", "Интеграции"]]
    : [["dashboard", "Мой доход"], ["payouts", "Мои выплаты"]];
  const adminViews = { dashboard: dashboardView, sales: salesView, products: productsView, authors: authorsView, payouts: payoutsView, statistics: statisticsView, integrations: integrationsView };
  const content = admin ? (adminViews[state.view] || dashboardView)() : state.view === "payouts" ? myPayoutsView() : authorDashboard();
  app.innerHTML = `<div class="app-shell"><aside class="sidebar"><div class="brand"><div class="brand-mark small">АШ</div><div><strong>АутШкола</strong><span>Кабинет авторов</span></div></div>
    <nav aria-label="Основная навигация">${views.map(([id, label]) => `<button data-view="${id}" class="${state.view === id ? "active" : ""}">${label}</button>`).join("")}</nav>
    <div class="sidebar-user"><span>${escapeHtml(state.profile.name)}</span><small>${admin ? "Администратор" : "Автор"}</small><button id="logout">Выйти</button></div></aside>
    <main class="content">${state.demoMode ? `<div class="demo-banner" role="status">Демонстрационный режим · тестовые данные</div>` : ""}${state.notice ? `<div class="notice" role="status">${escapeHtml(state.notice)}</div>` : ""}${content}</main></div>`;
  bindEvents();
}

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => { state.view = button.dataset.view; state.notice = ""; layout(); }));
  document.querySelector("#logout")?.addEventListener("click", () => signOut(auth));
  document.querySelector("#seed-button")?.addEventListener("click", seedHandler);
  document.querySelector("#sale-form")?.addEventListener("submit", addSaleHandler);
  document.querySelector("#rule-form")?.addEventListener("submit", saveRevenueRule);
  document.querySelector("#author-access-form")?.addEventListener("submit", createAuthorAccess);
  document.querySelector("#cancel-rule")?.addEventListener("click", () => { state.ruleProductId = null; layout(); });
  document.querySelectorAll("[data-edit-rule]").forEach((button) => button.addEventListener("click", () => { state.ruleProductId = button.dataset.editRule; layout(); window.scrollTo({ top: 0, behavior: "smooth" }); }));
  document.querySelectorAll("[data-form-payout]").forEach((button) => button.addEventListener("click", () => formPayout(button.dataset.formPayout)));
  document.querySelectorAll("[data-pay-payout]").forEach((button) => button.addEventListener("click", () => markPayoutPaid(button.dataset.payPayout)));
  document.querySelectorAll("[data-filter]").forEach((select) => select.addEventListener("change", () => { state.filters[select.dataset.filter] = select.value; layout(); }));
  document.querySelector("#author-month-filter")?.addEventListener("change", (event) => { state.authorMonth = event.currentTarget.value; layout(); });
  document.querySelector("#voice-button")?.addEventListener("click", () => { state.notice = "Голосовой ввод будет подключён в следующей версии."; layout(); });
  const form = document.querySelector("#sale-form");
  if (form) {
    const updatePreview = () => {
      const data = new FormData(form);
      const date = new Date(`${data.get("soldAt")}T${data.get("soldTime") || "12:00"}:00`);
      document.querySelector("#sale-preview").innerHTML = salePreviewHtml(data.get("productId"), data.get("amount"), date);
    };
    form.querySelectorAll("input,select").forEach((field) => field.addEventListener("input", updatePreview));
    form.productId.addEventListener("change", () => { const product = state.products.find((p) => p.id === form.productId.value); form.amount.value = (product.basePriceKopecks ?? product.price * 100) / 100; updatePreview(); });
    updatePreview();
  }
}

async function seedHandler(event) {
  const button = event.currentTarget; button.disabled = true; button.textContent = "Обновляю…";
  try { await seedDemoData(state.user); state.notice = "Демо-база обновлена: 5 участников, 10 товаров, история правил, 60 продаж и выплаты за три месяца."; await loadData(); layout(); }
  catch (error) { console.error(error); state.notice = "Не удалось обновить демо-данные. Проверь правила Firestore."; layout(); }
}

async function addSaleHandler(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const product = state.products.find((item) => item.id === form.get("productId"));
  const soldAtDate = new Date(`${form.get("soldAt")}T${form.get("soldTime")}:00`);
  const { ruleId, shares } = sharesForProduct(product, soldAtDate);
  if (!product || !Object.keys(shares).length) { state.notice = "Для товара нет действующего правила распределения."; layout(); return; }
  const grossKopecks = Math.round(Number(form.get("amount")) * 100);
  const taxRateBpsSnapshot = state.settings.taxRateBps || 400;
  const taxKopecks = Math.round(grossKopecks * taxRateBpsSnapshot / 10000);
  const netKopecks = grossKopecks - taxKopecks;
  const split = amountsFor(netKopecks, shares);
  const saleRef = doc(collection(db, "sales"));
  const soldAt = Timestamp.fromDate(soldAtDate);
  const batch = writeBatch(db);
  const distributionSnapshot = Object.entries(split).map(([authorId, item]) => ({ authorId, authorNameSnapshot: authorName(authorId), shareBps: item.shareBps, amountKopecks: item.amountKopecks }));
  batch.set(saleRef, { soldAt, productId: product.id, productTitleSnapshot: product.title, productTypeSnapshot: product.type || "digital", grossKopecks, taxRateBpsSnapshot, taxKopecks, netKopecks, revenueRuleIdSnapshot: ruleId, distributionSnapshot, participantAuthorIds: Object.keys(shares), source: form.get("source"), status: "paid", externalOrderId: null, createdBy: state.user.uid, createdAt: Timestamp.now() });
  for (const [authorId, earning] of Object.entries(split)) {
    batch.set(doc(db, "earnings", `${saleRef.id}_${authorId}`), { saleId: saleRef.id, authorId, soldAt, productId: product.id, productTitleSnapshot: product.title, grossKopecks, taxRateBpsSnapshot, netKopecks, shareBpsSnapshot: earning.shareBps, amountKopecks: earning.amountKopecks, payoutId: null, payoutStatus: "unpaid", createdAt: Timestamp.now() });
  }
  try { await batch.commit(); state.notice = `Продажа сохранена атомарно. После налога: ${rub(netKopecks)}.`; await loadData(); layout(); }
  catch (error) { console.error(error); state.notice = "Не удалось сохранить продажу."; layout(); }
}

async function saveRevenueRule(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const participants = state.authors.map((author) => ({ authorId: author.id, shareBps: Math.round(Number(data.get(`share_${author.id}`) || 0) * 100) })).filter((p) => p.shareBps > 0);
  if (sum(participants, (p) => p.shareBps) !== 10000) { state.notice = "Новое распределение не сохранено: сумма долей должна быть ровно 100%."; layout(); return; }
  const productId = data.get("productId");
  const start = new Date(`${data.get("effectiveFrom")}T00:00:00`);
  const current = findRule(productId, new Date(start.getTime() - 1000));
  const id = `${productId}_${data.get("effectiveFrom")}`;
  const batch = writeBatch(db);
  if (current) batch.update(doc(db, "revenueRules", current.id), { effectiveTo: Timestamp.fromDate(new Date(start.getTime() - 1000)) });
  batch.set(doc(db, "revenueRules", id), { productId, effectiveFrom: Timestamp.fromDate(start), effectiveTo: null, participants, active: true, createdAt: Timestamp.now(), createdBy: state.user.uid });
  batch.update(doc(db, "products", productId), { currentRevenueRuleId: id });
  try { await batch.commit(); state.ruleProductId = null; state.notice = "Новое правило создано. Старые продажи и их проценты не изменились."; await loadData(); layout(); }
  catch (error) { console.error(error); state.notice = "Не удалось сохранить новое правило."; layout(); }
}

async function createAuthorAccess(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const authorId = data.get("authorId");
  const author = state.authors.find((item) => item.id === authorId);
  try {
    const credential = await createUserWithEmailAndPassword(userCreatorAuth, data.get("employeeEmail"), data.get("temporaryPassword"));
    await signOut(userCreatorAuth);
    const batch = writeBatch(db);
    batch.set(doc(db, "users", credential.user.uid), { name: author.name, role: "author", authorId, active: true, email: data.get("employeeEmail") });
    batch.update(doc(db, "authors", authorId), { userId: credential.user.uid });
    await batch.commit();
    state.notice = `Доступ для ${author.name} создан. Передай сотруднику учебные логин и временный пароль отдельно.`;
    await loadData(); layout();
  } catch (error) {
    console.error(error);
    state.notice = error.code === "auth/email-already-in-use" ? "Этот email уже используется." : "Не удалось создать доступ сотруднику.";
    layout();
  }
}

async function formPayout(authorId) {
  const earnings = state.earnings.filter((item) => item.authorId === authorId && payoutStatus(item) === "unpaid");
  if (!earnings.length) return;
  const dates = earnings.map((e) => asDate(earningDate(e))).sort((a, b) => a - b);
  const periodStart = new Date(dates[0].getFullYear(), dates[0].getMonth(), 1);
  const periodEnd = new Date(dates.at(-1).getFullYear(), dates.at(-1).getMonth() + 1, 0, 23, 59, 59);
  const dueDate = new Date(periodEnd.getFullYear(), periodEnd.getMonth() + 1, state.settings.payoutDay || 5, 12);
  const payoutRef = doc(collection(db, "payouts"));
  const batch = writeBatch(db);
  batch.set(payoutRef, { authorId, authorNameSnapshot: authorName(authorId), periodStart: Timestamp.fromDate(periodStart), periodEnd: Timestamp.fromDate(periodEnd), dueDate: Timestamp.fromDate(dueDate), amountKopecks: sum(earnings, earningAmount), earningIds: earnings.map((e) => e.id), status: "planned", paidAt: null, createdAt: Timestamp.now(), createdBy: state.user.uid });
  earnings.forEach((earning) => batch.update(doc(db, "earnings", earning.id), { payoutId: payoutRef.id, payoutStatus: "included" }));
  try { await batch.commit(); state.notice = `Выплата для ${authorName(authorId)} сформирована.`; await loadData(); layout(); }
  catch (error) { console.error(error); state.notice = "Не удалось сформировать выплату."; layout(); }
}

async function markPayoutPaid(payoutId) {
  if (!window.confirm("Подтвердить, что выплата действительно выполнена?")) return;
  const payout = state.payouts.find((item) => item.id === payoutId);
  const earnings = state.earnings.filter((item) => item.payoutId === payoutId || payout?.earningIds?.includes(item.id));
  const batch = writeBatch(db);
  batch.update(doc(db, "payouts", payoutId), { status: "paid", paidAt: Timestamp.now() });
  earnings.forEach((earning) => batch.update(doc(db, "earnings", earning.id), { payoutStatus: "paid" }));
  try { await batch.commit(); state.notice = "Выплата отмечена как выполненная и перенесена в историю автора."; await loadData(); layout(); }
  catch (error) { console.error(error); state.notice = "Не удалось изменить статус выплаты."; layout(); }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { Object.assign(state, { user: null, profile: null, view: "dashboard", notice: "", demoMode: false }); loginScreen(); return; }
  app.innerHTML = `<main class="loading"><div class="spinner"></div><p>Загружаю кабинет…</p></main>`;
  try {
    if (user.isAnonymous) {
      state.user = user;
      state.profile = { name: "Марина", role: "author", authorId: "marina", active: true };
      state.demoMode = true;
      await loadData();
      layout();
      return;
    }
    const profileSnapshot = await getDoc(doc(db, "users", user.uid));
    if (!profileSnapshot.exists()) { await signOut(auth); loginScreen("Для этого аккаунта не создан профиль доступа."); return; }
    const profile = profileSnapshot.data();
    if (profile.active === false || !["admin", "author"].includes(profile.role)) { await signOut(auth); loginScreen("Доступ к этому аккаунту отключён."); return; }
    state.user = user; state.profile = profile; state.demoMode = false; await loadData(); layout();
  } catch (error) {
    console.error(error); app.innerHTML = `<main class="loading"><p class="alert">Не удалось прочитать данные. Проверь Security Rules.</p><button id="logout" class="secondary">Выйти</button></main>`;
    document.querySelector("#logout").addEventListener("click", () => signOut(auth));
  }
});
