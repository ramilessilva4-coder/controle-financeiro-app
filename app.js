/* Controle Financeiro — app do celular. Os dados ficam no Supabase, os mesmos do programa do PC. */
"use strict";

const SUPABASE_URL = "https://anbrgocnmwcexchmgffn.supabase.co";
const SUPABASE_KEY = "sb_publishable_kB2fKD4D-kuhnGmfXDVUfg_h3gD5CZX";

const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (n == null ? "—" : (n < 0 ? "-" : "") + "CLP " + Math.abs(Math.round(n)).toLocaleString("es-CL"));
const pct = (n) => (n == null ? "—" : (Math.round(n * 100) / 100).toLocaleString("pt-BR") + "%");
const dbr = (iso) => (iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "—");
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const digits = (v) => parseInt(String(v || "").replace(/\D/g, ""), 10) || 0;

const STATUS = { Recebido: "success", Pago: "success", Confirmado: "success", Pendente: "warning",
  "Parcialmente pago": "info", Vencido: "danger", Cancelado: "", Estornado: "", "Sem venda": "", "Sem valor": "" };
const badge = (s) => `<span class="badge ${STATUS[s] || ""}">${esc(s)}</span>`;
const PERIODS = ["Hoje", "Esta semana", "Este mês", "Mês anterior", "Este ano", "Todo o período"];

// ------------------------------------------------------------------ estado
const state = {
  token: null, tab: "inicio", period: "Este mês", kind: "limpeza", recFilter: "abertos", search: "", contas: "receber",
  meta: null, rev: null, data: null, online: false,
};
try {
  state.token = localStorage.getItem("cf_key");
  state.period = localStorage.getItem("cf_period") || state.period;
} catch (e) { /* armazenamento indisponível */ }
// a chave chega pelo QR code do PC, depois de "#k=" (essa parte do link nunca é enviada a servidores)
const urlKey = new URLSearchParams(location.hash.slice(1)).get("k");
if (urlKey) {
  state.token = urlKey;
  try { localStorage.setItem("cf_key", urlKey); } catch (e) { /* ignore */ }
  history.replaceState(null, "", location.pathname);
}

// ------------------------------------------------------------------ API
async function api(action, data = {}) {
  let res;
  try {
    res = await fetch(SUPABASE_URL + "/rest/v1/rpc/cf_api", {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
      body: JSON.stringify({ p_key: state.token || "", p_action: action, p_data: data }),
    });
  } catch (e) {
    setOnline(false);
    throw new Error("Sem internet. Tente de novo quando a conexão voltar.");
  }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (out && out.message) || "Erro " + res.status;
    if (/Acesso não autorizado/.test(msg)) { showLocked(); }
    else setOnline(true);
    throw new Error(msg);
  }
  setOnline(true);
  return out;
}

function setOnline(ok) {
  state.online = ok;
  const s = $("#sync");
  s.className = "sync " + (ok ? "ok" : "err");
  $("#sync-text").textContent = ok ? "Sincronizado" : "Sem internet — tentando de novo…";
}

function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), ms);
}

// ------------------------------------------------------------------ períodos e abas
function renderChips() {
  const show = state.tab !== "receber";  // aba Contas: sem filtro de período
  const el = $("#period-chips");
  el.hidden = !show;
  el.innerHTML = PERIODS.map((p) => `<button class="chip ${p === state.period ? "active" : ""}" data-p="${esc(p)}">${esc(p)}</button>`).join("");
}
$("#period-chips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-p]");
  if (!b) return;
  state.period = b.dataset.p;
  try { localStorage.setItem("cf_period", state.period); } catch (e2) { /* ignore */ }
  renderChips();
  load();
});
$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (!b) return;
  state.tab = b.dataset.tab;
  state.search = "";
  document.querySelectorAll("#tabs [data-tab]").forEach((x) => x.classList.toggle("active", x === b));
  renderChips();
  window.scrollTo(0, 0);
  load();
});
$("#refresh").addEventListener("click", () => load(true));

// ------------------------------------------------------------------ carregamento
async function load(manual) {
  const view = $("#view");
  if (!state.data || manual === "skeleton") view.innerHTML = '<div class="skeleton"></div>';
  try {
    if (!state.meta || manual) state.meta = await api("meta");
    $("#brand").textContent = state.meta.app_name || "Controle Financeiro";
    const q = { preset: state.period };
    if (state.tab === "inicio") state.data = await api("dashboard", q);
    else if (state.tab === "salgados") state.data = await api("batches", q);
    else if (state.tab === "servicos") state.data = await api("jobs", { ...q, kind: state.kind });
    else state.data = await api(state.contas === "pagar" ? "payables" : "receivables");
    const r = await api("ping");
    state.rev = r.rev;
    render();
    if (manual === true) toast("Atualizado");
  } catch (e) {
    if (!state.data) view.innerHTML = `<div class="empty"><b>Não foi possível carregar</b>${esc(e.message)}</div>`;
    else toast(e.message);
  }
}

function render() {
  const v = $("#view");
  if (state.tab === "inicio") v.innerHTML = viewDashboard(state.data);
  else if (state.tab === "salgados") v.innerHTML = viewBatches(state.data);
  else if (state.tab === "servicos") v.innerHTML = viewJobs(state.data);
  else v.innerHTML = contasSeg() + (state.contas === "pagar" ? viewPayables(state.data) : viewReceivables(state.data));
}

function contasSeg() {
  return `<div class="seg"><button data-contas="receber" class="${state.contas === "receber" ? "active" : ""}">A receber</button>
    <button data-contas="pagar" class="${state.contas === "pagar" ? "active" : ""}">A pagar</button></div>`;
}

function viewPayables(d) {
  const t = d.totals;
  const q = state.search.toLowerCase();
  const items = d.items.filter((r) => {
    if (state.recFilter === "abertos" && !["Pendente", "Parcialmente pago", "Vencido"].includes(r.status)) return false;
    if (state.recFilter === "vencidos" && r.status !== "Vencido") return false;
    if (state.recFilter === "pagos" && r.status !== "Pago") return false;
    return !q || r.description.toLowerCase().includes(q) || (r.supplier || "").toLowerCase().includes(q)
      || r.category.toLowerCase().includes(q);
  });
  let h = `<div class="kpis">
    ${kpi("Total em aberto", fmt(t.em_aberto), `${t.qtd_aberto} conta(s)`, t.em_aberto ? "warn" : "", true)}
    ${kpi("Vencidas", fmt(t.vencido), `${t.qtd_vencido} conta(s)`, t.vencido ? "neg" : "")}
    ${kpi("Até o fim do mês", fmt(t.mes), "em aberto")}
  </div><h2>Contas a pagar</h2>
  <div class="chips light" id="rec-filter">${[["abertos", "Em aberto"], ["vencidos", "Vencidas"], ["pagos", "Pagas"], ["todos", "Todas"]]
    .map(([k, l]) => `<button class="chip ${state.recFilter === k ? "active" : ""}" data-rf="${k}">${l}</button>`).join("")}</div>
  <input class="search" id="rec-search" type="search" placeholder="Pesquisar conta, fornecedor ou categoria" value="${esc(state.search)}" style="margin-top:10px">`;
  if (!items.length) return h + emptyBox(d.items.length ? "Nenhuma conta neste filtro" : "Nenhuma conta a pagar", "Toque em + e escolha Conta a pagar (luz, aluguel, internet…).");
  return h + "<div class='list'>" + items.map((r) => `<button class="row ${r.status === "Cancelado" ? "cancelled" : ""}" data-open="pagar" data-id="${r.id}">
    <div class="left"><div class="t">${esc(r.description)}</div><div class="s">${esc(r.category)}${r.supplier ? " · " + esc(r.supplier) : ""}${r.series_id ? ` · ${r.series_n}/${r.series_total}` : ""}</div>
    <div class="s">Vence ${dbr(r.due_date)}</div></div>
    <div class="right"><div class="amt">${fmt(r.status === "Pago" ? r.amount : r.balance)}</div>${badge(r.status)}</div></button>`).join("") + "</div>";
}

// tempo real: verifica a cada 3 s se algo mudou (no PC ou em outro aparelho)
async function poll() {
  if (document.hidden || !state.token) return;
  try {
    const r = await api("ping");
    if (state.rev && r.rev !== state.rev && $("#sheet").hidden) {
      state.rev = r.rev;
      state.meta = await api("meta");
      await load();
      toast("Dados atualizados");
    }
  } catch (e) { /* setOnline já marcou a falha */ }
}
setInterval(poll, 3000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });

// ------------------------------------------------------------------ telas
function kpi(label, value, hint = "", cls = "", wide = false) {
  return `<div class="kpi ${wide ? "wide" : ""}"><div class="l">${esc(label)}</div><div class="v ${cls}">${value}</div>${hint ? `<div class="h">${hint}</div>` : ""}</div>`;
}
function emptyBox(title, text) { return `<div class="list"><div class="empty"><b>${esc(title)}</b>${esc(text)}</div></div>`; }

function viewDashboard(d) {
  const k = d.kpis;
  let h = `<div class="kpis">
    ${kpi("Faturamento", fmt(k.faturamento), "", "", true)}
    ${kpi("Lucro", fmt(k.lucro), "margem " + pct(k.margem), k.lucro < 0 ? "neg" : "pos")}
    ${kpi("Custos", fmt(k.custos))}
    ${kpi("Entradas", fmt(k.recebido), "dinheiro recebido", k.recebido ? "pos" : "")}
    ${kpi("Saídas", fmt(k.saidas), "contas pagas", k.saidas ? "neg" : "")}
    ${kpi("Saldo do caixa", fmt(k.saldo), "entradas − saídas", k.saldo < 0 ? "neg" : "pos")}
    ${kpi("Saldo previsto", fmt(k.saldo + k.a_receber - k.a_pagar), "caixa + a receber − a pagar", k.saldo + k.a_receber - k.a_pagar < 0 ? "neg" : "pos")}
    ${kpi("A receber", fmt(k.a_receber), k.vencido ? "vencido " + fmt(k.vencido) : "", k.a_receber ? "warn" : "")}
    ${kpi("A pagar", fmt(k.a_pagar), k.vencido_pagar ? "vencido " + fmt(k.vencido_pagar) : "", k.a_pagar ? "warn" : "")}
    ${kpi("Sobra após as contas", fmt(k.lucro - k.saidas), "lucro − contas pagas", k.lucro - k.saidas < 0 ? "neg" : "pos")}
    ${kpi("Fornadas / serviços", k.fornadas + " / " + k.servicos)}
  </div>`;
  const months = d.monthly.filter((m) => m.faturamento || m.lucro);
  h += "<h2>Faturamento e lucro por mês</h2>";
  if (!months.length) h += emptyBox("Sem dados no período", "Os gráficos usam apenas os registros reais.");
  else {
    const max = Math.max(1, ...d.monthly.map((m) => Math.max(m.faturamento, m.lucro)));
    h += `<div class="card"><div class="bars">${d.monthly.map((m) => `<div class="bar-group">
      <div class="bar-pair"><div class="bar a" style="height:${(m.faturamento / max) * 100}%"></div>
      <div class="bar b" style="height:${(Math.max(m.lucro, 0) / max) * 100}%"></div></div>
      <div class="bar-label">${esc(m.rotulo)}</div></div>`).join("")}</div>
      <div class="legend"><span><i style="background:var(--bar1)"></i>Faturamento</span><span><i style="background:var(--bar2)"></i>Lucro</span></div></div>`;
  }
  h += "<h2>Por módulo</h2><div class='list'>" + d.modules.map((m) => `<div class="row"><div class="left"><div class="t">${esc(m.rotulo)}</div>
      <div class="s">${m.registros} registro(s) · lucro ${fmt(m.lucro)}</div></div><div class="right"><div class="amt">${fmt(m.faturamento)}</div></div></div>`).join("") + "</div>";
  h += "<h2>Atividades recentes</h2>";
  if (!d.activity.length) h += emptyBox("Nenhuma operação ainda", "Toque em + para registrar a primeira.");
  else h += "<div class='list'>" + d.activity.map((a) => `<button class="row" data-open="${esc(a.entity)}" data-id="${a.entity_id ?? ""}">
      <div class="left"><div class="t">${esc(a.summary)}</div><div class="s">${esc(a.type)} · ${esc(a.action)} · ${dbr(a.ts)} ${esc(a.ts.slice(11, 16))}</div></div></button>`).join("") + "</div>";
  return h;
}

function viewBatches(d) {
  const s = d.summary;
  let h = `<div class="kpis">
    ${kpi("Faturamento", fmt(s.faturamento), `${s.fornadas} fornada(s)`)}
    ${kpi("Lucro estimado", fmt(s.lucro), "margem " + pct(s.margem), s.lucro < 0 ? "neg" : "pos")}
    ${kpi("Vendidos", s.vendido.toLocaleString("pt-BR"), `de ${s.produzido.toLocaleString("pt-BR")} produzidos`)}
    ${kpi("A receber", fmt(s.a_receber), "recebido " + fmt(s.recebido), s.a_receber ? "warn" : "")}
  </div><h2>Fornadas</h2>`;
  if (!d.items.length) return h + emptyBox("Nenhuma fornada neste período", "Toque em + e escolha Nova fornada.");
  return h + "<div class='list'>" + d.items.map((b) => `<button class="row ${b.status === "cancelado" ? "cancelled" : ""}" data-open="fornada" data-id="${b.id}">
    <div class="left"><div class="t">${esc(b.ref)} · ${dbr(b.date)}</div><div class="s">${b.qty_sold}/${b.qty_produced} vendidos · lucro ${fmt(b.profit)}${b.client_name ? " · " + esc(b.client_name) : ""}</div></div>
    <div class="right"><div class="amt">${fmt(b.revenue)}</div>${badge(b.pay_status)}</div></button>`).join("") + "</div>";
}

function viewJobs(d) {
  const s = d.summary;
  let h = `<div class="seg"><button data-kind="limpeza" class="${state.kind === "limpeza" ? "active" : ""}">Limpeza</button>
    <button data-kind="outro" class="${state.kind === "outro" ? "active" : ""}">Outros serviços</button></div>
    <div class="kpis">
    ${kpi("Faturamento", fmt(s.faturamento), `${s.servicos} serviço(s)`)}
    ${kpi("Lucro", fmt(s.lucro), "margem " + pct(s.margem), s.lucro < 0 ? "neg" : "pos")}
    ${kpi("Média por serviço", fmt(s.media))}
    ${kpi("A receber", fmt(s.a_receber), `${s.pendentes} com pendência`, s.a_receber ? "warn" : "")}
  </div><h2>${state.kind === "limpeza" ? "Serviços de limpeza" : "Outros serviços"}</h2>`;
  if (!d.items.length) h += emptyBox("Nada registrado neste período", "Toque em + para registrar um serviço.");
  else h += "<div class='list'>" + d.items.map((j) => `<button class="row ${j.status === "cancelado" ? "cancelled" : ""}" data-open="${esc(j.kind)}" data-id="${j.id}">
    <div class="left"><div class="t">${esc(j.title)}</div><div class="s">${esc(j.ref)} · ${dbr(j.date)}${j.client_name ? " · " + esc(j.client_name) : ""}${j.category_name ? " · " + esc(j.category_name) : ""}</div></div>
    <div class="right"><div class="amt">${fmt(j.amount)}</div>${badge(j.pay_status)}</div></button>`).join("") + "</div>";
  if (state.kind === "outro" && d.by_category.length) {
    h += "<h2>Por categoria</h2><div class='list'>" + d.by_category.map((c) => `<div class="row"><div class="left"><div class="t">${esc(c.categoria)}</div>
      <div class="s">${c.qtd} trabalho(s) · lucro ${fmt(c.lucro)}</div></div><div class="right"><div class="amt">${fmt(c.faturamento)}</div></div></div>`).join("") + "</div>";
  }
  return h;
}

function viewReceivables(d) {
  const t = d.totals;
  const q = state.search.toLowerCase();
  const items = d.items.filter((r) => {
    if (state.recFilter === "abertos" && !["Pendente", "Parcialmente pago", "Vencido"].includes(r.status)) return false;
    if (state.recFilter === "vencidos" && r.status !== "Vencido") return false;
    if (state.recFilter === "pagos" && r.status !== "Pago") return false;
    return !q || r.client_name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q);
  });
  let h = `<div class="kpis">
    ${kpi("Total em aberto", fmt(t.em_aberto), `${t.qtd_aberto} lançamento(s)`, t.em_aberto ? "warn" : "", true)}
    ${kpi("Vencido", fmt(t.vencido), `${t.qtd_vencido} lançamento(s)`, t.vencido ? "neg" : "")}
    ${kpi("Já recebido", fmt(t.recebido))}
  </div><h2>Quem deve</h2>
  <div class="chips light" id="rec-filter">${[["abertos", "Em aberto"], ["vencidos", "Vencidos"], ["pagos", "Pagos"], ["todos", "Todos"]]
    .map(([k, l]) => `<button class="chip ${state.recFilter === k ? "active" : ""}" data-rf="${k}">${l}</button>`).join("")}</div>
  <input class="search" id="rec-search" type="search" placeholder="Pesquisar devedor ou descrição" value="${esc(state.search)}" style="margin-top:10px">`;
  if (!items.length) return h + emptyBox(d.items.length ? "Nenhum resultado para este filtro" : "Ninguém deve nada", "Vendas e serviços marcados como 'a receber' aparecem aqui.");
  return h + "<div class='list'>" + items.map((r) => `<button class="row ${r.status === "Cancelado" ? "cancelled" : ""}" data-open="receber" data-id="${r.id}">
    <div class="left"><div class="t">${esc(r.client_name)}</div><div class="s">${esc(r.description)}</div>
    <div class="s">${r.due_date ? "Previsto " + dbr(r.due_date) : "Sem data prevista"}</div></div>
    <div class="right"><div class="amt">${fmt(r.status === "Pago" ? r.amount : r.balance)}</div>${badge(r.status)}</div></button>`).join("") + "</div>";
}

$("#view").addEventListener("click", (e) => {
  const k = e.target.closest("[data-kind]");
  if (k) { state.kind = k.dataset.kind; load(); return; }
  const ct = e.target.closest("[data-contas]");
  if (ct) { state.contas = ct.dataset.contas; state.search = ""; load(); return; }
  const rf = e.target.closest("[data-rf]");
  if (rf) { state.recFilter = rf.dataset.rf; render(); return; }
  const o = e.target.closest("[data-open]");
  if (o && o.dataset.id) openDetails(o.dataset.open, +o.dataset.id);
});
$("#view").addEventListener("input", (e) => {
  if (e.target.id === "rec-search") {
    state.search = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const s = $("#rec-search");
    s.focus();
    s.setSelectionRange(pos, pos);
  }
});

// ------------------------------------------------------------------ folha inferior
function openSheet(html) {
  $("#sheet-body").innerHTML = html;
  $("#sheet").hidden = false;
  $("#backdrop").hidden = false;
  document.body.style.overflow = "hidden";
}
function closeSheet() {
  $("#sheet").hidden = true;
  $("#backdrop").hidden = true;
  document.body.style.overflow = "";
}
$("#backdrop").addEventListener("click", closeSheet);
window.addEventListener("popstate", () => { if (!$("#sheet").hidden) closeSheet(); });

$("#fab").addEventListener("click", () => {
  openSheet(`<h3>Novo lançamento</h3><div class="menu">
    <button data-new="fornada"><span class="ic"><svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9 4 4 0 0 1-4-4 4 4 0 0 1-5-5z"/></svg></span><span>Nova fornada<small>Produção e venda de salgados</small></span></button>
    <button data-new="limpeza"><span class="ic"><svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/></svg></span><span>Serviço de limpeza<small>Valor cobrado e custos</small></span></button>
    <button data-new="outro"><span class="ic"><svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></span><span>Outro serviço<small>Manutenção, vendas avulsas…</small></span></button>
    <button data-new="pagar"><span class="ic"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/></svg></span><span>Conta a pagar<small>Luz, água, aluguel… única ou recorrente</small></span></button>
    <button data-new="receber"><span class="ic"><svg viewBox="0 0 24 24"><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5"/></svg></span><span>Valor a receber<small>Dívida que não veio de venda ou serviço</small></span></button>
  </div>`);
});

$("#sheet-body").addEventListener("click", (e) => {
  const n = e.target.closest("[data-new]");
  if (n) {
    if (n.dataset.new === "fornada") formBatch();
    else if (n.dataset.new === "receber") formReceivable();
    else if (n.dataset.new === "pagar") formPayable();
    else formJob(n.dataset.new);
  }
});

// ------------------------------------------------------------------ campos
const money = (name, label, value = 0) =>
  `<label class="f"><span>${esc(label)}</span><input name="${name}" inputmode="numeric" data-money value="${value ? fmt(value) : ""}" placeholder="CLP 0"></label>`;
const qty = (name, label) => `<label class="f"><span>${esc(label)}</span><input name="${name}" inputmode="numeric" data-int placeholder="0"></label>`;
const text = (name, label, ph = "", value = "") =>
  `<label class="f"><span>${esc(label)}</span><input name="${name}" placeholder="${esc(ph)}" value="${esc(value)}" autocomplete="off"></label>`;
const dateF = (name, label, value = today()) => `<label class="f"><span>${esc(label)}</span><input type="date" name="${name}" value="${value}"></label>`;
const clientF = (label = "Cliente") => `<label class="f"><span>${esc(label)}</span><input name="client_name" list="clients" placeholder="Nome do cliente" autocomplete="off">
  <datalist id="clients">${(state.meta.clients || []).map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label>`;
const methodF = (name = "payment_method") => `<label class="f"><span>Forma de pagamento</span><select name="${name}"><option value="">Não informado</option>
  ${state.meta.methods.map((m) => `<option>${esc(m)}</option>`).join("")}</select></label>`;
const notesF = () => `<label class="f"><span>Observações</span><textarea name="notes"></textarea></label>`;
const receiptBlock = () => `<h2>Recebimento</h2>
  <div class="toggle" data-receipt><button type="button" class="active" data-full="1">Recebido integralmente</button><button type="button" data-full="0">A receber</button></div>
  ${methodF()}
  <div data-partial hidden>${money("paid_upfront", "Valor já recebido agora")}
  <label class="f"><span>Contato do cliente</span><input name="contact" placeholder="Telefone (opcional)"></label>
  ${dateF("due_date", "Data prevista de recebimento", "")}</div>`;

function vals(form) {
  const o = {};
  form.querySelectorAll("[name]").forEach((el) => {
    o[el.name] = el.dataset.money !== undefined || el.dataset.int !== undefined ? digits(el.value) : el.value.trim();
  });
  const tg = form.querySelector("[data-receipt] .active");
  if (tg) o.fully_received = tg.dataset.full === "1";
  return o;
}

function wireForm(form, calc, submit) {
  form.addEventListener("input", (e) => {
    if (e.target.dataset.money !== undefined) {
      const n = digits(e.target.value);
      e.target.value = n ? fmt(n) : "";
    } else if (e.target.dataset.int !== undefined) {
      const n = digits(e.target.value);
      e.target.value = n ? String(n) : "";
    }
    calc();
  });
  form.addEventListener("click", (e) => {
    const b = e.target.closest("[data-full]");
    if (!b) return;
    form.querySelectorAll("[data-full]").forEach((x) => x.classList.toggle("active", x === b));
    form.querySelector("[data-partial]").hidden = b.dataset.full === "1";
    calc();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      await submit(vals(form));
      closeSheet();
      state.meta = null;
      await load();
    } catch (err) {
      form.querySelector(".error").textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
  calc();
}

function setErr(form, msg) {
  form.querySelector(".error").textContent = msg || "";
  form.querySelector("button[type=submit]").disabled = !!msg;
}

// ------------------------------------------------------------------ formulários
function formBatch() {
  const m = state.meta;
  openSheet(`<h3>Nova fornada</h3><form id="frm">
    ${dateF("date", "Data da produção")}
    <div class="grid2">${qty("qty_produced", "Produzidos")}${qty("qty_sold", "Vendidos")}</div>
    <div class="grid2">${money("unit_price", "Preço unitário", m.price)}${money("unit_cost", "Custo unitário", m.cost)}</div>
    ${money("extra_expenses", "Despesas adicionais")}
    ${clientF()}
    ${receiptBlock()}
    ${notesF()}
    <div class="result"><div><span>Faturamento</span><b id="r-fat">—</b></div><div><span>Custo</span><b id="r-cost">—</b></div>
    <div><span>Lucro</span><b id="r-profit">—</b></div><div><span>Margem</span><b id="r-margin">—</b></div>
    <div><span>Não vendidos</span><b id="r-unsold">—</b></div><div><span>A receber</span><b id="r-rec">—</b></div></div>
    <div class="error"></div><button class="btn" type="submit">Salvar fornada</button></form>`);
  const f = $("#frm");
  wireForm(f, () => {
    const v = vals(f);
    const rev = v.qty_sold * v.unit_price, cost = v.qty_produced * v.unit_cost + v.extra_expenses, profit = rev - cost;
    const pending = v.fully_received ? 0 : Math.max(rev - v.paid_upfront, 0);
    $("#r-fat").textContent = fmt(rev); $("#r-cost").textContent = fmt(cost);
    $("#r-profit").textContent = fmt(profit); $("#r-profit").className = profit < 0 ? "neg" : "pos";
    $("#r-margin").textContent = rev ? pct((profit / rev) * 100) : "—";
    $("#r-unsold").textContent = Math.max(v.qty_produced - v.qty_sold, 0);
    $("#r-rec").textContent = fmt(pending);
    if (!v.qty_produced) return setErr(f, "Informe a quantidade produzida.");
    if (v.qty_sold > v.qty_produced) return setErr(f, "Vendidos não pode ser maior que produzidos.");
    if (!v.fully_received && v.paid_upfront > rev) return setErr(f, "O valor recebido é maior que o faturamento.");
    if (pending > 0 && !v.client_name) return setErr(f, "Informe o cliente para lançar o valor a receber.");
    if (!v.fully_received && rev > 0 && pending === 0) return setErr(f, "Tudo já foi recebido: escolha 'Recebido integralmente'.");
    setErr(f, "");
  }, async (v) => { await api("batch_create", v); toast("Fornada registrada"); });
}

function formJob(kind) {
  const m = state.meta;
  const cats = kind === "outro" ? `<label class="f"><span>Categoria</span><select name="category_id"><option value="">Sem categoria</option>
    ${m.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label>` : "";
  openSheet(`<h3>${kind === "limpeza" ? "Serviço de limpeza" : "Outro serviço"}</h3><form id="frm">
    ${dateF("date", "Data")}
    ${text("title", kind === "limpeza" ? "Descrição do serviço" : "Nome ou descrição do trabalho", kind === "limpeza" ? "Ex.: limpeza completa do apartamento" : "Ex.: troca de torneira")}
    ${clientF()}
    ${kind === "limpeza" ? text("address", "Endereço ou referência", "Opcional") : cats}
    ${money("amount", "Valor cobrado")}
    <div class="grid2">${money("costs", "Custos", kind === "limpeza" ? m.cleaning_cost : 0)}${money("extra_expenses", "Despesas adicionais")}</div>
    ${text("cost_description", "Descrição dos custos", "Ex.: produtos, transporte")}
    ${receiptBlock()}
    ${notesF()}
    <div class="result"><div><span>Lucro</span><b id="r-profit">—</b></div><div><span>Margem</span><b id="r-margin">—</b></div>
    <div><span>A receber</span><b id="r-rec">—</b></div></div>
    <div class="error"></div><button class="btn" type="submit">Salvar serviço</button></form>`);
  const f = $("#frm");
  wireForm(f, () => {
    const v = vals(f);
    const profit = v.amount - v.costs - v.extra_expenses;
    const pending = v.fully_received ? 0 : Math.max(v.amount - v.paid_upfront, 0);
    $("#r-profit").textContent = fmt(profit); $("#r-profit").className = profit < 0 ? "neg" : "pos";
    $("#r-margin").textContent = v.amount ? pct((profit / v.amount) * 100) : "—";
    $("#r-rec").textContent = fmt(pending);
    if (!v.title) return setErr(f, "Informe a descrição do serviço.");
    if (!v.fully_received && v.paid_upfront > v.amount) return setErr(f, "O valor recebido é maior que o valor cobrado.");
    if (pending > 0 && !v.client_name) return setErr(f, "Informe o cliente para lançar o valor a receber.");
    if (!v.fully_received && v.amount > 0 && pending === 0) return setErr(f, "Tudo já foi recebido: escolha 'Recebido integralmente'.");
    setErr(f, "");
  }, async (v) => { v.kind = kind; await api("job_create", v); toast("Serviço registrado"); });
}

function formReceivable() {
  openSheet(`<h3>Valor a receber</h3><form id="frm">
    ${clientF("Devedor ou cliente")}
    ${text("description", "Descrição da origem da dívida", "Motivo")}
    ${money("amount", "Valor total devido")}
    <div class="grid2">${dateF("issue_date", "Lançamento")}${dateF("due_date", "Previsão de pagamento", "")}</div>
    <label class="f"><span>Contato</span><input name="contact" placeholder="Telefone (opcional)"></label>
    ${notesF()}
    <p class="hint">Para vendas a prazo, registre a fornada ou o serviço como "A receber": o lançamento é criado sozinho.</p>
    <div class="error"></div><button class="btn" type="submit">Salvar</button></form>`);
  const f = $("#frm");
  wireForm(f, () => {
    const v = vals(f);
    if (!v.client_name) return setErr(f, "Informe o nome do devedor.");
    if (!v.description) return setErr(f, "Informe a descrição.");
    if (!v.amount) return setErr(f, "Informe o valor devido.");
    setErr(f, "");
  }, async (v) => { await api("rec_create", v); toast("Valor a receber lançado"); });
}

const EXPENSE_CATS = ["Aluguel", "Luz", "Água", "Gás", "Internet", "Telefone", "Gastos comuns",
  "Ingredientes e materiais", "Transporte", "Impostos e taxas", "Outros"];
const FREQS = [["unica", "Uma única vez"], ["mensal", "Todo mês"], ["semanal", "Toda semana"],
  ["quinzenal", "A cada 15 dias"], ["anual", "Todo ano"]];

function addMonths(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}
function addDays(iso, n) { const t = new Date(iso + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
function lastDue(first, freq, n) {
  if (freq === "mensal") return addMonths(first, n - 1);
  if (freq === "anual") return addMonths(first, 12 * (n - 1));
  return addDays(first, (freq === "semanal" ? 7 : 15) * (n - 1));
}

function formPayable() {
  openSheet(`<h3>Conta a pagar</h3><form id="frm">
    ${text("description", "Descrição", "Ex.: Luz, Aluguel, Internet")}
    <label class="f"><span>Categoria</span><select name="category">${EXPENSE_CATS.map((c) => `<option ${c === "Outros" ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
    ${text("supplier", "Fornecedor / a quem pagar", "Opcional")}
    ${money("amount", "Valor")}
    ${dateF("due_date", "Vencimento (1ª conta)")}
    <label class="f"><span>Repetição</span><select name="frequency">${FREQS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
    <div data-rep hidden>${qty("repeat", "Quantas vezes")}</div>
    <p class="hint" id="r-prev"></p>
    <label class="f" style="display:flex;gap:10px;align-items:center"><input type="checkbox" name="paid_now" style="width:auto"> <span style="margin:0">Já paguei hoje (a 1ª)</span></label>
    ${notesF()}
    <div class="error"></div><button class="btn" type="submit">Salvar conta</button></form>`);
  const f = $("#frm");
  f.querySelector("[name=repeat]").value = "12";
  wireForm(f, () => {
    const v = vals(f);
    const freq = f.querySelector("[name=frequency]").value;
    f.querySelector("[data-rep]").hidden = freq === "unica";
    const n = digits(f.querySelector("[name=repeat]").value);
    $("#r-prev").textContent = freq === "unica" || !v.due_date || n < 2 ? "" :
      `Serão criadas ${n} contas de ${fmt(v.amount)}: de ${dbr(v.due_date)} até ${dbr(lastDue(v.due_date, freq, n))}.`;
    if (!v.description) return setErr(f, "Informe a descrição da conta.");
    if (!v.amount) return setErr(f, "Informe o valor.");
    if (!v.due_date) return setErr(f, "Informe o vencimento.");
    if (freq !== "unica" && (n < 2 || n > 60)) return setErr(f, "Repetir de 2 a 60 vezes.");
    setErr(f, "");
  }, async (v) => {
    v.paid_now = f.querySelector("[name=paid_now]").checked;
    if (v.frequency === "unica") v.repeat = 1;
    const r = await api("payable_create", v);
    toast(r.ids.length > 1 ? `${r.ids.length} contas lançadas` : "Conta lançada");
  });
  f.querySelector("[name=paid_now]").addEventListener("change", () => f.dispatchEvent(new Event("input")));
}

function formPayPayable(p) {
  openSheet(`<h3>Pagar conta</h3><p class="muted">${esc(p.description)} — vence ${dbr(p.due_date)}</p>
    <div class="result"><div><span>Valor</span><b>${fmt(p.amount)}</b></div><div><span>Já pago</span><b>${fmt(p.paid)}</b></div>
    <div><span>Falta pagar</span><b class="warn">${fmt(p.balance)}</b></div><div><span>Depois</span><b id="r-after">—</b></div></div>
    <form id="frm">${money("amount", "Valor pago", p.balance)}${dateF("date", "Data do pagamento")}${methodF("method")}${notesF()}
    <div class="error"></div><button class="btn" type="submit">Confirmar pagamento</button></form>`);
  const f = $("#frm");
  wireForm(f, () => {
    const v = vals(f);
    const rest = p.balance - v.amount;
    $("#r-after").textContent = rest === 0 ? "Quitada" : fmt(rest);
    if (!v.amount) return setErr(f, "Informe o valor pago.");
    if (v.amount > p.balance) return setErr(f, "O valor é maior que o que falta pagar.");
    setErr(f, "");
  }, async (v) => { await api("payable_pay", { ...v, id: p.id }); toast(p.balance - v.amount === 0 ? "Conta quitada" : "Pagamento registrado"); });
}

function formPayment(rec) {
  openSheet(`<h3>Registrar pagamento</h3><p class="muted">${esc(rec.client_name)} — ${esc(rec.description)}</p>
    <div class="result"><div><span>Devido</span><b>${fmt(rec.amount)}</b></div><div><span>Já pago</span><b>${fmt(rec.paid)}</b></div>
    <div><span>Saldo</span><b class="warn">${fmt(rec.balance)}</b></div><div><span>Depois</span><b id="r-after">—</b></div></div>
    <form id="frm">${money("amount", "Valor recebido", rec.balance)}${dateF("date", "Data do recebimento")}${methodF("method")}${notesF()}
    <div class="error"></div><button class="btn" type="submit">Confirmar pagamento</button></form>`);
  const f = $("#frm");
  wireForm(f, () => {
    const v = vals(f);
    const rest = rec.balance - v.amount;
    $("#r-after").textContent = rest === 0 ? "Quitado" : fmt(rest);
    if (!v.amount) return setErr(f, "Informe o valor recebido.");
    if (v.amount > rec.balance) return setErr(f, "O valor é maior que o saldo pendente.");
    setErr(f, "");
  }, async (v) => { await api("pay_add", { ...v, id: rec.id }); toast(rec.balance - v.amount === 0 ? "Dívida quitada" : "Pagamento registrado"); });
}

// ------------------------------------------------------------------ detalhes
function dl(rows) { return `<dl class="details">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`; }

async function openDetails(entity, id) {
  if (entity === "pagamento") entity = "receber_pagamento";
  try {
    if (entity === "fornada") {
      const b = await api("batch", { id });
      openSheet(`<h3>Fornada ${esc(b.ref)}</h3>${dl([
        ["Data", dbr(b.date)], ["Situação", b.status === "cancelado" ? "Cancelada" : badge(b.pay_status)],
        ["Produzidos", b.qty_produced], ["Vendidos", b.qty_sold], ["Não vendidos", b.qty_unsold],
        ["Preço unitário", fmt(b.unit_price)], ["Custo unitário", fmt(b.unit_cost)], ["Despesas", fmt(b.extra_expenses)],
        ["Faturamento", fmt(b.revenue)], ["Custo estimado", fmt(b.total_cost)], ["Lucro", fmt(b.profit)], ["Margem", pct(b.margin)],
        ["Recebido", fmt(b.received)], ["A receber", fmt(b.to_receive)], ["Cliente", esc(b.client_name || "—")],
        ["Observações", esc(b.notes || "—")], ...(b.cancel_reason ? [["Motivo do cancelamento", esc(b.cancel_reason)]] : [])])}
        ${actions(b.status === "ativo", b.to_receive > 0 ? b.receivable_id : null, "batches", id)}`);
    } else if (entity === "limpeza" || entity === "outro") {
      const j = await api("job", { id });
      openSheet(`<h3>${esc(j.title)}</h3>${dl([
        ["Referência", esc(j.ref)], ["Data", dbr(j.date)], ["Situação", j.status === "cancelado" ? "Cancelado" : badge(j.pay_status)],
        ["Cliente", esc(j.client_name || "—")], ...(j.kind === "limpeza" ? [["Endereço", esc(j.address || "—")]] : [["Categoria", esc(j.category_name || "Sem categoria")]]),
        ["Valor cobrado", fmt(j.amount)], ["Custos", fmt(j.total_cost)], ["Lucro", fmt(j.profit)], ["Margem", pct(j.margin)],
        ["Recebido", fmt(j.received)], ["A receber", fmt(j.to_receive)], ["Observações", esc(j.notes || "—")],
        ...(j.cancel_reason ? [["Motivo do cancelamento", esc(j.cancel_reason)]] : [])])}
        ${actions(j.status === "ativo", j.to_receive > 0 ? j.receivable_id : null, "jobs", id)}`);
    } else if (entity === "pagar" || entity === "pagamento_conta") {
      if (entity === "pagamento_conta") return;
      const p = await api("payable", { id });
      const pays = p.payments.length ? `<h2>Pagamentos</h2><div class="list">${p.payments.map((x) => `<div class="row"><div class="left">
        <div class="t">${dbr(x.date)}${x.method ? " · " + esc(x.method) : ""}</div><div class="s">${esc(x.notes || x.reverse_reason || "")}</div></div>
        <div class="right"><div class="amt">${fmt(x.amount)}</div>${badge(x.status === "ativo" ? "Confirmado" : "Estornado")}</div></div>`).join("")}</div>` : "";
      openSheet(`<h3>${esc(p.description)}</h3>${dl([
        ["Referência", esc(p.ref)], ["Situação", badge(p.status)], ["Categoria", esc(p.category)],
        ["Fornecedor", esc(p.supplier || "—")], ["Valor", fmt(p.amount)], ["Pago", fmt(p.paid)], ["Falta pagar", fmt(p.balance)],
        ["Vencimento", dbr(p.due_date)], ["Repetição", p.series_id ? `${p.series_n}/${p.series_total}` : "Única"],
        ["Observações", esc(p.notes || "—")], ...(p.cancel_reason ? [["Motivo do cancelamento", esc(p.cancel_reason)]] : [])])}${pays}
        <div class="btns">${p.raw_status === "aberto" && p.balance > 0 ? `<button class="btn" data-paypag="${p.id}">Pagar conta</button>` : ""}
        ${p.raw_status === "aberto" ? `<button class="btn danger" data-cancel="payables" data-cid="${p.id}">Cancelar conta</button>` : ""}
        <button class="btn secondary" data-close>Fechar</button></div>`);
    } else if (entity === "receber" || entity === "receber_pagamento") {
      const r = await api("receivable", { id });
      const pays = r.payments.length ? `<h2>Pagamentos</h2><div class="list">${r.payments.map((p) => `<div class="row"><div class="left">
        <div class="t">${dbr(p.date)}${p.method ? " · " + esc(p.method) : ""}</div><div class="s">${esc(p.notes || p.reverse_reason || "")}</div></div>
        <div class="right"><div class="amt">${fmt(p.amount)}</div>${badge(p.status === "ativo" ? "Confirmado" : "Estornado")}</div></div>`).join("")}</div>` : "";
      openSheet(`<h3>${esc(r.client_name)}</h3>${dl([
        ["Referência", esc(r.ref)], ["Descrição", esc(r.description)], ["Situação", badge(r.status)],
        ["Valor devido", fmt(r.amount)], ["Pago", fmt(r.paid)], ["Saldo", fmt(r.balance)],
        ["Lançamento", dbr(r.issue_date)], ["Previsão", dbr(r.due_date)], ["Contato", esc(r.contact || "—")],
        ["Origem", esc(r.origin_label) + (r.origin_id ? " · " + esc(r.origin_ref) : "")]])}${pays}
        <div class="btns">${r.raw_status === "aberto" && r.balance > 0 ? `<button class="btn" data-pay="${r.id}">Registrar pagamento</button>` : ""}
        ${r.raw_status === "aberto" && r.origin_type === "manual" ? `<button class="btn danger" data-cancel="receivables" data-cid="${r.id}">Cancelar lançamento</button>` : ""}
        <button class="btn secondary" data-close>Fechar</button></div>`);
    } else return;
  } catch (e) { toast(e.message); }
}

function actions(active, recId, kind, id) {
  return `<div class="btns">${recId ? `<button class="btn" data-pay="${recId}">Registrar pagamento</button>` : ""}
    ${active ? `<button class="btn danger" data-cancel="${kind}" data-cid="${id}">Cancelar registro</button>` : ""}
    <button class="btn secondary" data-close>Fechar</button></div>`;
}

$("#sheet-body").addEventListener("click", async (e) => {
  if (e.target.closest("[data-close]")) return closeSheet();
  const pp = e.target.closest("[data-paypag]");
  if (pp) {
    try { formPayPayable(await api("payable", { id: +pp.dataset.paypag })); } catch (err) { toast(err.message); }
    return;
  }
  const p = e.target.closest("[data-pay]");
  if (p) {
    try { formPayment(await api("receivable", { id: +p.dataset.pay })); } catch (err) { toast(err.message); }
    return;
  }
  const c = e.target.closest("[data-cancel]");
  if (c) {
    const reason = prompt("Motivo do cancelamento (obrigatório).\nO registro fica no histórico, mas sai dos totais.");
    if (!reason || !reason.trim()) return;
    try {
      const act = { batches: "batch_cancel", jobs: "job_cancel", receivables: "rec_cancel", payables: "payable_cancel" }[c.dataset.cancel];
      await api(act, { id: +c.dataset.cid, reason: reason.trim() });
      toast("Cancelado");
      closeSheet();
      load();
    } catch (err) { toast(err.message); }
  }
});

// ------------------------------------------------------------------ início
function showLocked() {
  $("#view").innerHTML = `<div class="locked"><h1>Conecte este celular</h1>
    <p class="muted">No programa Controle Financeiro do computador, abra <b>Celular</b> e leia o QR code com a câmera deste celular.</p></div>`;
  $("#period-chips").hidden = true;
  $("#fab").hidden = true;
}

if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
if (!state.token) showLocked();
else { renderChips(); load("skeleton"); }
