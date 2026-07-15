import React, { useState, useMemo, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, BarChart, Bar,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import {
  LayoutDashboard, TrendingUp, Lightbulb, MessageSquare, Plug,
  Download, FileText, AlertTriangle, ArrowUpRight, ArrowDownRight,
  Sparkles, Menu, X, Sun, ShieldAlert, Activity, CheckCircle2,
  Send, Loader2, Database, Minus, Info,
} from "lucide-react";
import {
  loadMentions, loadSourceHealth, aiChat, aiRecommendations, aiConversationHistory, aiConversationMessages,
  LIVE, SOURCES, TOPICS, ANCHOR, DAYMS, SOURCE_INFO, loadAppSettings, saveAppSettings, loadYoutubeTermStats,
} from "./data";
import { YoutubeQuotaWidget } from "./YoutubeQuotaWidget";

/* ------------------------------------------------------------------ *
 * Smart Customer Feedback — Nordzucker AG
 * Sentiment- & Trend-Intelligence über öffentliche Quellen
 *
 * Datenschicht: src/data
 *  - Demo-Modus (Default): deterministische Beispieldaten.
 *  - Live-Modus: Supabase (gesetzt, sobald VITE_SUPABASE_URL existiert) —
 *    Mentions aus Postgres, KI-Antworten über die ai-query Edge Function.
 * ------------------------------------------------------------------ */

/* Bezugszeitpunkt: im Demo-Modus fix (für stabile Daten), live = jetzt. */
const NOW = LIVE ? new Date() : ANCHOR;

const DEFAULT_TOPIC_COLORS = {
  zuckersteuer: "#e1a53a",
  zuckerfrei: "#0a6cd4",
  softdrinks: "#e0574a",
  suesswaren: "#16a37b",
  backen: "#8a6d3b",
  gesundheit: "#6d5ce7",
  saisonal: "#4ea235",
  preise: "#52617a",
  nachhaltig: "#0a5cb8",
};

const DEFAULT_SOURCE_COLORS = {
  reddit: "#004b93",
  youtube: "#e0574a",
  news: "#6d5ce7",
  instagram: "#16a37b",
};

const DEFAULT_SOURCE_PRIORITY = {
  reddit: 10,
  youtube: 20,
  news: 30,
  instagram: 40,
};

function sourceLabelFromId(sourceId) {
  return String(sourceId ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || "Unbekannt";
}

function resolveSourceCatalog(appSettings, sourceHealth) {
  const configured = Array.isArray(appSettings?.source_catalog) ? appSettings.source_catalog : [];
  const configuredById = new Map(configured.filter((entry) => entry?.id).map((entry) => [entry.id, entry]));
  const healthById = new Map((sourceHealth ?? []).map((entry) => [entry.id, entry]));
  
  const base = SOURCE_INFO.map((meta, index) => {
    const cfg = configuredById.get(meta.id) ?? {};
    const health = healthById.get(meta.id) ?? {};
    return {
      ...meta,
      label: cfg.label ?? meta.label,
      status: cfg.status ?? health.status ?? meta.status,
      auth: cfg.auth ?? meta.auth,
      endpoint: cfg.endpoint ?? meta.endpoint,
      note: cfg.note ?? meta.note,
      priority: Number.isFinite(cfg.priority) ? cfg.priority : (DEFAULT_SOURCE_PRIORITY[meta.id] ?? (index + 1) * 10),
      color: cfg.color ?? DEFAULT_SOURCE_COLORS[meta.id] ?? "#0a6cd4",
      lastSync: health.lastSync ?? null,
      volume: health.volume ?? 0,
    };
  });
  const known = new Set(base.map((entry) => entry.id));
  const extras = (sourceHealth ?? [])
    .filter((entry) => entry?.id && !known.has(entry.id))
    .map((entry, index) => ({
      id: entry.id,
      label: entry.label ?? sourceLabelFromId(entry.id),
      status: entry.status ?? "active",
      auth: "Backend-Konfiguration",
      endpoint: "-",
      note: "Quelle ist in Supabase aktiv, aber noch nicht im Katalog dokumentiert.",
      priority: 900 + index,
      color: DEFAULT_SOURCE_COLORS[entry.id] ?? "#8694a8",
      lastSync: entry.lastSync ?? null,
      volume: entry.volume ?? 0,
    }));
  return [...base, ...extras].sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999) || a.label.localeCompare(b.label));
}

function normalizeTopicCatalogDraft(rows) {
  return rows
    .map((row) => ({
      id: String(row.id ?? "").trim(),
      label: String(row.label ?? "").trim(),
      lean: Number(row.lean ?? 0),
      color: String(row.color ?? "#0a6cd4").trim(),
    }))
    .filter((row) => row.id && row.label);
}

function normalizeSourceCatalogDraft(rows) {
  return rows
    .map((row) => ({
      id: String(row.id ?? "").trim(),
      label: String(row.label ?? "").trim(),
      priority: Number(row.priority ?? 999),
      color: String(row.color ?? "#0a6cd4").trim(),
    }))
    .filter((row) => row.id && row.label);
}

function draftTopicCatalog(appSettings) {
  const catalog = Array.isArray(appSettings?.topic_catalog) ? appSettings.topic_catalog : [];
  if (catalog.length > 0) {
    return catalog.map((item) => ({
      id: item.id ?? "",
      label: item.label ?? topicLabelFromId(item.id),
      lean: Number(item.lean ?? 0),
      color: item.color ?? DEFAULT_TOPIC_COLORS[item.id] ?? "#0a6cd4",
    }));
  }
  return resolveTopicCatalog(appSettings, []).map((item) => ({
    id: item.id,
    label: item.label,
    lean: item.lean,
    color: item.color,
  }));
}

function draftSourceCatalog(appSettings, sourceHealth) {
  return resolveSourceCatalog(appSettings, sourceHealth).map((item) => ({
    id: item.id,
    label: item.label,
    priority: item.priority ?? 999,
    color: item.color ?? "#0a6cd4",
  }));
}
function topicLabelFromId(topicId) {
  return String(topicId ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || "Unbekannt";
}

function resolveTopicCatalog(appSettings, mentions) {
  const configured = Array.isArray(appSettings?.topic_catalog) ? appSettings.topic_catalog : [];
  const base = (configured.length ? configured : TOPICS).map((t) => ({
    id: t.id,
    label: t.label ?? topicLabelFromId(t.id),
    lean: Number.isFinite(t.lean) ? t.lean : 0,
    color: t.color ?? DEFAULT_TOPIC_COLORS[t.id] ?? "#0a6cd4",
  }));
  const known = new Set(base.map((t) => t.id));
  const discovered = [...new Set((mentions ?? []).map((m) => m.topic).filter(Boolean))]
    .filter((id) => !known.has(id))
    .map((id) => ({
      id,
      label: topicLabelFromId(id),
      lean: 0,
      color: DEFAULT_TOPIC_COLORS[id] ?? "#0a6cd4",
    }));
  return [...base, ...discovered];
}

/* =========================  DESIGN SYSTEM  ========================= */
const STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;450;500;600;700&display=swap');

:root{
  --nz-900:#012a5e; --nz-700:#004b93; --nz-600:#0a5cb8; --nz-500:#0a6cd4;
  --nz-100:#e7f0fb; --nz-50:#f2f7fd;
  --green:#6cbf4b; --green-d:#4ea235;
  --ink:#0d1b2e; --ink-2:#52617a; --ink-3:#8694a8;
  --line:#e4eaf2; --line-2:#eef2f8;
  --bg:#eef2f7; --surface:#ffffff;
  --pos:#16a37b; --pos-bg:#e6f6f0;
  --neg:#e0574a; --neg-bg:#fcebe9;
  --neu:#e1a53a; --neu-bg:#fcf3e2;
  --violet:#6d5ce7; --violet-bg:#efedfd;
  --shadow:0 1px 2px rgba(13,27,46,.05),0 4px 16px rgba(13,27,46,.06);
  --shadow-l:0 8px 30px rgba(13,27,46,.10);
}
*{box-sizing:border-box}
.scf{font-family:'Inter',system-ui,sans-serif;color:var(--ink);background:var(--bg);
  min-height:100vh;display:grid;grid-template-columns:248px 1fr;font-size:14px;-webkit-font-smoothing:antialiased}
.scf h1,.scf h2,.scf h3,.scf .disp{font-family:'Space Grotesk',sans-serif;letter-spacing:-.01em}

/* ---- sidebar ---- */
.side{background:var(--nz-900);color:#cfe0f4;display:flex;flex-direction:column;
  position:sticky;top:0;height:100vh;padding:20px 14px}
.brand{display:flex;align-items:center;gap:11px;padding:6px 8px 18px}
.brand .wm{font-family:'Space Grotesk';font-weight:700;font-size:16px;color:#fff;line-height:1}
.brand .sub{font-size:10.5px;color:#7fa7d6;letter-spacing:.03em;text-transform:uppercase;margin-top:3px}
.nav{display:flex;flex-direction:column;gap:2px;margin-top:6px}
.nav-sec{font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:#5e80ad;
  padding:14px 10px 6px;font-weight:600}
.nav-item{display:flex;align-items:center;gap:11px;padding:9px 11px;border-radius:9px;
  color:#bcd2ee;font-weight:500;cursor:pointer;border:1px solid transparent;transition:.14s;font-size:13.5px}
.nav-item:hover{background:rgba(255,255,255,.06);color:#fff}
.nav-item.on{background:linear-gradient(90deg,var(--nz-600),var(--nz-500));color:#fff;
  box-shadow:0 4px 14px rgba(10,108,212,.35)}
.nav-item .ico{flex:none}
.side-foot{margin-top:auto;padding-top:14px;border-top:1px solid rgba(255,255,255,.09)}
.src-row{display:flex;align-items:center;gap:8px;font-size:11.5px;color:#9fbbe0;padding:5px 8px}
.dot{width:7px;height:7px;border-radius:50%;flex:none}
.dot.live{background:var(--green);box-shadow:0 0 0 3px rgba(108,191,75,.22)}
.dot.idle{background:#5e80ad}

/* ---- main ---- */
.main{min-width:0;display:flex;flex-direction:column}
.topbar{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.86);
  backdrop-filter:blur(10px);border-bottom:1px solid var(--line);
  display:flex;align-items:center;gap:16px;padding:13px 26px;flex-wrap:wrap}
.topbar h1{font-size:18px;font-weight:600;margin:0}
.topbar .crumb{font-size:11.5px;color:var(--ink-3);font-weight:500;margin-bottom:1px}
.spacer{flex:1}
.range{display:flex;background:var(--line-2);border-radius:9px;padding:3px}
.range button{border:0;background:transparent;font:inherit;font-size:12.5px;font-weight:500;
  color:var(--ink-2);padding:6px 12px;border-radius:7px;cursor:pointer}
.range button.on{background:#fff;color:var(--nz-700);box-shadow:var(--shadow);font-weight:600}
.btn{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);background:#fff;
  color:var(--ink-2);font:inherit;font-size:12.5px;font-weight:550;padding:8px 13px;border-radius:9px;
  cursor:pointer;transition:.14s;white-space:nowrap}
.btn:hover{border-color:var(--nz-300,#9bbde8);color:var(--nz-700);box-shadow:var(--shadow)}
.btn-pri{background:var(--nz-700);color:#fff;border-color:var(--nz-700)}
.btn-pri:hover{background:var(--nz-600);color:#fff}
.content{padding:24px 26px 60px;max-width:1320px;width:100%}

/* ---- cards ---- */
.grid{display:grid;gap:16px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:15px;
  box-shadow:var(--shadow);padding:18px;min-width:0}
.grid > *{min-width:0}
.card-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px}
.card-t{font-size:13.5px;font-weight:600;color:var(--ink);font-family:'Space Grotesk'}
.card-s{font-size:11.5px;color:var(--ink-3);margin-top:2px}
details.info-wrap{position:relative;display:inline-flex}
details.info-wrap > summary{list-style:none}
details.info-wrap > summary::-webkit-details-marker{display:none}
.info-btn{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:999px;
  border:1px solid var(--line);color:var(--ink-3);background:#fff;cursor:pointer;transition:.14s;vertical-align:middle}
.info-btn:hover{color:var(--nz-700);border-color:var(--nz-500)}
.info-pop{position:absolute;top:calc(100% + 8px);right:0;z-index:40;width:min(320px,78vw);background:#fff;
  border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-l);padding:10px 12px}
details.info-wrap.left .info-pop{left:0;right:auto}
.info-pop .t{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-3);margin-bottom:4px}
.info-pop p{margin:0;font-size:12px;line-height:1.5;color:var(--ink-2)}
.kpi .lab{font-size:12px;color:var(--ink-2);font-weight:500;display:flex;align-items:center;gap:7px}
.kpi .val{font-family:'Space Grotesk';font-weight:600;font-size:30px;line-height:1.1;margin:9px 0 6px}
.delta{display:inline-flex;align-items:center;gap:3px;font-size:11.5px;font-weight:600;
  padding:2px 8px;border-radius:20px}
.delta.up{color:var(--pos);background:var(--pos-bg)}
.delta.down{color:var(--neg);background:var(--neg-bg)}
.delta.flat{color:var(--ink-2);background:var(--line-2)}
.kpi-ico{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;flex:none}

/* sentiment pill */
.pill{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;
  padding:3px 9px;border-radius:20px;max-width:100%;white-space:normal;overflow-wrap:anywhere}
.pill.pos{color:var(--pos);background:var(--pos-bg)}
.pill.neg{color:var(--neg);background:var(--neg-bg)}
.pill.neu{color:var(--neu);background:var(--neu-bg)}

/* signal cards */
.signal{display:flex;gap:13px;padding:15px;border-radius:13px;border:1px solid var(--line);
  background:var(--surface);position:relative;overflow:hidden}
.signal .bar{position:absolute;left:0;top:0;bottom:0;width:4px}
.signal .s-ico{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;flex:none}
.signal h4{margin:0 0 4px;font-size:14px;font-weight:600;font-family:'Space Grotesk'}
.signal p{margin:0;font-size:12.5px;color:var(--ink-2);line-height:1.5}
.signal .meta{display:flex;gap:8px;margin-top:9px;flex-wrap:wrap}
.tag{font-size:10.5px;font-weight:600;color:var(--ink-2);background:var(--line-2);
  padding:2px 8px;border-radius:6px}

/* topic bar */
.tbar{display:flex;align-items:center;gap:12px;padding:7px 0}
.tbar .nm{font-size:12.5px;font-weight:500;width:150px;flex:none}
.tbar .track{flex:1;height:9px;border-radius:6px;background:var(--line-2);overflow:hidden;position:relative}
.tbar .fill{height:100%;border-radius:6px}
.tbar .sc{font-size:12px;font-weight:600;width:46px;text-align:right;flex:none;font-variant-numeric:tabular-nums}

/* table */
.tbl{width:100%;border-collapse:collapse;font-size:13px}
.tbl th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;
  color:var(--ink-3);font-weight:600;padding:9px 12px;border-bottom:1px solid var(--line)}
.tbl td{padding:11px 12px;border-bottom:1px solid var(--line-2);vertical-align:middle}
.tbl tr:last-child td{border-bottom:0}
.tbl tr:hover td{background:var(--nz-50)}

/* chat */
.chat-wrap{display:flex;flex-direction:column;height:calc(100vh - 230px);min-height:420px}
.chat-log{flex:1;overflow-y:auto;padding:6px 2px;display:flex;flex-direction:column;gap:14px}
.msg{max-width:82%;padding:12px 15px;border-radius:14px;font-size:13.5px;line-height:1.55;word-break:break-word}
.msg.u{align-self:flex-end;background:var(--nz-700);color:#fff;border-bottom-right-radius:5px}
.msg.a{align-self:flex-start;background:var(--surface);border:1px solid var(--line);border-bottom-left-radius:5px;box-shadow:var(--shadow)}
.chat-md{display:flex;flex-direction:column;gap:10px;color:var(--ink);font-size:13.5px;line-height:1.65}
.chat-md > :first-child{margin-top:0}
.chat-md > :last-child{margin-bottom:0}
.chat-md h1,.chat-md h2,.chat-md h3,.chat-md h4{font-family:'Space Grotesk',sans-serif;letter-spacing:-.01em;line-height:1.2;margin:0}
.chat-md h1{font-size:19px}
.chat-md h2{font-size:17px}
.chat-md h3{font-size:15px}
.chat-md h4{font-size:14px}
.chat-md p,.chat-md ul,.chat-md ol,.chat-md blockquote,.chat-md pre{margin:0}
.chat-md ul,.chat-md ol{padding-left:20px;display:grid;gap:6px}
.chat-md li > p{margin:0}
.chat-md strong{font-weight:700;color:var(--ink)}
.chat-md em{font-style:italic}
.chat-md a{color:var(--nz-700);text-decoration:none;border-bottom:1px solid rgba(0,75,147,.25)}
.chat-md a:hover{border-bottom-color:var(--nz-700)}
.chat-md blockquote{padding:10px 12px;border-left:3px solid var(--nz-500);background:var(--nz-50);border-radius:0 10px 10px 0;color:var(--ink-2)}
.chat-md code{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;background:var(--nz-50);padding:0.15em 0.38em;border-radius:6px;border:1px solid var(--line)}
.chat-md pre{overflow:auto;background:#0d1b2e;color:#e6eef8;padding:12px 14px;border-radius:12px;border:1px solid #11243e}
.chat-md pre code{background:transparent;border:0;padding:0;color:inherit;font-size:12px;display:block;white-space:pre-wrap}
.chat-md table{width:100%;border-collapse:collapse;font-size:12.5px;overflow:hidden;border:1px solid var(--line);border-radius:10px}
.chat-md th,.chat-md td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
.chat-md th{background:var(--nz-50);font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-3)}
.chat-md tr:last-child td{border-bottom:0}
.chat-in{display:flex;gap:10px;margin-top:14px}
.chat-in input{flex:1;border:1px solid var(--line);border-radius:11px;padding:12px 15px;
  font:inherit;font-size:13.5px;outline:none}
.chat-in input:focus{border-color:var(--nz-500);box-shadow:0 0 0 3px var(--nz-100)}
.suggest{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.chip{font-size:12px;font-weight:500;color:var(--nz-700);background:var(--nz-100);
  border:0;padding:7px 12px;border-radius:20px;cursor:pointer;font-family:inherit}
.chip:hover{background:#d7e7fb}

/* misc */
.empty{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;
  padding:40px;color:var(--ink-2)}
.spin{animation:sp 1s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}
.menu-btn{display:none;border:1px solid var(--line);background:#fff;border-radius:9px;
  padding:8px;cursor:pointer}
.report-head{display:none}
.print-report{display:none}
.print-cover{display:none}
.lede{font-size:13px;color:var(--ink-2);line-height:1.6;max-width:760px}
.ai-card{border:1px solid var(--line);border-radius:13px;padding:15px;background:var(--surface);
  border-left:3px solid var(--violet)}
.ai-card h4{margin:0 0 5px;font-size:14px;font-family:'Space Grotesk';font-weight:600}
.ai-card p{margin:0;font-size:12.5px;color:var(--ink-2);line-height:1.55}
.prio{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:2px 7px;border-radius:5px}
.source-badges{display:flex;gap:8px;flex-wrap:wrap}
.src-badge{display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border-radius:999px;font-size:11px;font-weight:600;max-width:100%;white-space:normal;overflow-wrap:anywhere}
.src-badge.on{color:var(--pos);background:var(--pos-bg)}
.src-badge.off{color:var(--ink-3);background:var(--line-2)}
.source-grid{grid-template-columns:1fr 1fr}
.source-card-head{align-items:flex-start;gap:10px;flex-wrap:wrap}
.source-card-top{display:flex;align-items:center;gap:10px;min-width:0}
.source-card-top .card-t,.source-card-top .card-s{overflow-wrap:anywhere}
.source-kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px}
.tbl-shell{border:1px solid var(--line);border-radius:12px;background:#fff;max-width:100%}
.tbl-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%}
.tbl-min{min-width:660px}
.tbl-wide{min-width:760px}
.catalog-grid{grid-template-columns:1fr 1fr}
.catalog-row{display:grid;grid-template-columns:1fr 1.4fr 0.7fr 0.7fr auto;gap:8px;align-items:center}
.g-kpi4{grid-template-columns:repeat(4,1fr)}
.g-split-2-1{grid-template-columns:2fr 1fr}
.g-split-1-1{grid-template-columns:1fr 1fr}
.g-split-13-1{grid-template-columns:1.3fr 1fr}
.g-split-12-1{grid-template-columns:1.2fr 1fr}
.g-3{grid-template-columns:repeat(3,1fr)}
.filters-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.mobile-stack{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.cube-hero{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:12px}
.cube-chip{border:1px solid var(--line);background:linear-gradient(135deg,#fff,var(--nz-50));border-radius:12px;padding:12px;
  animation:rise .5s ease both}
.cube-chip .k{font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--ink-3);font-weight:600}
.cube-chip .v{font-family:'Space Grotesk';font-weight:600;font-size:17px;margin-top:4px}
.cube-chip .m{font-size:11.5px;color:var(--ink-2)}
.cube-heat{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.cube-cell{border-radius:11px;padding:10px;border:1px solid var(--line);background:#fff;animation:rise .42s ease both}
.cube-cell .l{font-size:11px;color:var(--ink-3);font-weight:600}
.cube-cell .n{font-size:19px;font-family:'Space Grotesk';font-weight:600;margin:3px 0}
.cube-cell .f{height:6px;border-radius:999px;background:var(--line-2);overflow:hidden}
.cube-cell .f > span{display:block;height:100%;background:linear-gradient(90deg,var(--nz-500),#48a1ff)}
.mono-endpoint{background:var(--ink);color:#cfe0f4;border-radius:9px;padding:9px 12px;font-family:monospace;font-size:11px;overflow:auto;overflow-wrap:anywhere;max-width:100%}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}

@media (max-width:920px){
  .scf{grid-template-columns:1fr}
  .side{position:fixed;left:0;top:0;z-index:50;width:min(272px,84vw);transform:translateX(-100%);
    transition:transform .22s;box-shadow:var(--shadow-l)}
  .side.open{transform:translateX(0)}
  .menu-btn{display:inline-grid;place-items:center}
  .content{padding:18px 16px 44px}
  .topbar{padding:11px 16px;gap:10px}
  .topbar h1{font-size:16.5px}
  .topbar .spacer{display:none}
  .topbar .range{order:4;width:100%;justify-content:space-between}
  .source-grid,.catalog-grid{grid-template-columns:1fr}
  .source-card-head .pill{margin-left:0}
  .source-kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .g-kpi4{grid-template-columns:repeat(2,minmax(0,1fr))}
  .g-split-2-1,.g-split-1-1,.g-split-13-1,.g-split-12-1,.g-3,.filters-grid{grid-template-columns:1fr}
  .catalog-row{grid-template-columns:1fr 1fr}
  .catalog-row .btn{grid-column:1 / -1;justify-content:center}
  .card{padding:15px}
  .kpi .val{font-size:26px}
  .chat-wrap{height:calc(100vh - 200px);min-height:360px}
  .msg{max-width:92%}
  .cube-hero,.cube-heat{grid-template-columns:1fr}
}
@media (max-width:600px){
  .content{padding:14px 12px 36px}
  .topbar{padding:10px 12px}
  .topbar .btn{padding:7px 9px;font-size:11.5px}
  .topbar .range button{padding:6px 9px;font-size:11.5px}
  .card{padding:13px}
  .kpi .val{font-size:23px}
  .tbar{gap:8px}
  .tbar .nm{width:105px;font-size:11.5px}
  .tbar .sc{width:40px;font-size:11px}
  .chat-wrap{height:calc(100vh - 180px);min-height:320px}
  .chat-in{flex-wrap:wrap}
  .chat-in .btn{width:100%;justify-content:center}
  .msg{max-width:96%}
  .source-kpi-grid{grid-template-columns:1fr}
  .catalog-row{grid-template-columns:1fr}
  .catalog-row .btn{grid-column:auto}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}

@media print{
  .scf{display:block;background:#fff}
  .no-print{display:none!important}
  .print-cover{display:block;border:1px solid #d6deeb;border-radius:12px;padding:18px;background:linear-gradient(145deg,#ffffff,#f4f8fe);margin-bottom:14px;break-after:page}
  .print-cover-h{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px}
  .print-cover h2{margin:0;font-size:24px;font-family:'Space Grotesk';color:#10315a}
  .print-cover .meta{font-size:12px;color:#4b607e}
  .print-cover-grid{display:grid;grid-template-columns:1.2fr 1fr;gap:12px}
  .print-status{border:1px solid #d6deeb;border-radius:10px;padding:11px;background:#fff}
  .print-status .lab{font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#5d6f89;font-weight:700}
  .print-status .val{font-size:18px;font-weight:700;margin-top:5px}
  .print-status .desc{font-size:11px;color:#475d79;margin-top:4px;line-height:1.4}
  .print-status .val.green{color:#178a66}
  .print-status .val.amber{color:#9a6509}
  .print-status .val.red{color:#a12f25}
  .print-snapshot{border:1px solid #d6deeb;border-radius:10px;padding:11px;background:#fff}
  .print-snapshot h3{margin:0 0 8px;font-size:13px;color:#123561}
  .print-snapshot ul{margin:0;padding-left:16px;font-size:11.5px;color:#1a2f4d;line-height:1.45;display:grid;gap:4px}
  .print-plan{margin-top:12px;border:1px solid #d6deeb;border-radius:10px;background:#fff;padding:11px}
  .print-plan h3{margin:0 0 8px;font-size:13px;color:#123561}
  .print-plan-table{width:100%;border-collapse:collapse;font-size:11.5px}
  .print-plan-table th{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#657995;text-align:left;padding:6px 7px;background:#f4f7fb;border-bottom:1px solid #d6deeb}
  .print-plan-table td{padding:6px 7px;border-bottom:1px solid #edf1f7;color:#182b46;vertical-align:top}
  .print-plan-table tr:last-child td{border-bottom:0}
  .report-head{display:block;margin-bottom:18px;border-bottom:2px solid var(--nz-700);padding-bottom:10px}
  .print-report{display:block;margin-bottom:14px}
  .print-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:12px}
  .print-kpi{border:1px solid #d6deeb;border-radius:10px;padding:10px 11px;background:#f8fbff}
  .print-kpi .k{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#5d6f89;font-weight:700}
  .print-kpi .v{font-family:'Space Grotesk';font-size:18px;font-weight:700;color:#102341;margin-top:4px}
  .print-panel{border:1px solid #d6deeb;border-radius:10px;padding:11px;background:#fff}
  .print-panel h3{margin:0 0 8px;font-size:13px;font-weight:700;color:#123561}
  .print-table{width:100%;border-collapse:collapse;font-size:11.5px}
  .print-table th{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#657995;text-align:left;padding:6px 7px;background:#f4f7fb;border-bottom:1px solid #d6deeb}
  .print-table td{padding:6px 7px;border-bottom:1px solid #edf1f7;color:#182b46;vertical-align:top}
  .print-table tr:last-child td{border-bottom:0}
  .print-prio{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:1px 6px;border-radius:4px;display:inline-block}
  .print-prio.high{background:#fcebe9;color:#a12f25}
  .print-prio.mid{background:#fcf3e2;color:#9a6509}
  .print-score{font-size:11px;font-weight:700;padding:1px 6px;border-radius:6px;background:#e7f0fb;color:#004b93;display:inline-block;min-width:34px;text-align:center}
  .content{padding:0;max-width:none}
  .card{box-shadow:none;break-inside:avoid;border-color:#cdd7e5}
  .grid{gap:12px}
}
`;

/* (Daten & KI: siehe src/data) */

/* =========================  HELPERS  ========================= */
const fmtPct = n => (n>0?"+":"") + n + "%";
const sentColor = s => s > 0.15 ? "var(--pos)" : s < -0.15 ? "var(--neg)" : "var(--neu)";
const sentClass = s => s > 0.15 ? "pos" : s < -0.15 ? "neg" : "neu";
const dlBlob = (name, text, type) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
};
const toCSV = rows => {
  if (!rows.length) return "";
  const head = Object.keys(rows[0]);
  const esc = v => `"${String(v ?? "").replace(/"/g,'""')}"`;
  return [head.join(","), ...rows.map(r => head.map(h => esc(r[h])).join(","))].join("\n");
};
const csvEsc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const csvLine = (cols) => cols.map(csvEsc).join(",");
const tableFromObjects = (rows) => {
  if (!rows.length) return { header: [], body: [] };
  const header = Object.keys(rows[0]);
  return { header, body: rows.map((row) => header.map((key) => row[key])) };
};
const toCSVSectioned = (sections) => {
  const lines = [];
  sections.forEach((section, idx) => {
    if (section.title) lines.push(csvLine([section.title]));
    if (section.header?.length) lines.push(csvLine(section.header));
    (section.rows ?? []).forEach((row) => lines.push(csvLine(row)));
    if (idx < sections.length - 1) lines.push("");
  });
  return lines.join("\n");
};

const signed = (n) => `${n > 0 ? "+" : ""}${n}`;
const priorityRank = { Hoch: 3, Mittel: 2, Niedrig: 1 };
const clampScore = (n) => Math.max(0, Math.min(100, Math.round(n)));

function ceilToNextTen(n) {
  return Math.ceil(Math.abs(n) / 10) * 10;
}

function buildSymmetricDomain(series, key) {
  const values = (series ?? []).map((row) => Number(row?.[key] ?? 0)).filter((v) => Number.isFinite(v));
  const peak = Math.max(10, ...values.map((v) => Math.abs(v)));
  const bound = ceilToNextTen(peak);
  return [-bound, bound];
}

function buildExportReport({ agg, liveSignals, range, title, view }) {
  if (!agg) return null;

  const topTopicByVolume = agg.byTopic[0] ?? null;
  const biggestRisk = [...agg.byTopic].sort((a, b) => a.net - b.net)[0] ?? null;
  const topicById = Object.fromEntries((agg.byTopic ?? []).map((topic) => [topic.id, topic]));
  const recommendations = [];
  const pushRecommendation = (item) => {
    if (recommendations.some((entry) => entry.action === item.action)) return;
    recommendations.push({
      ...item,
      score: clampScore(item.score ?? 50),
      rank: priorityRank[item.priority] ?? 1,
    });
  };

  if (agg.curNet < 0) {
    const score = 80 + Math.min(20, Math.abs(agg.curNet));
    pushRecommendation({
      priority: "Hoch",
      owner: "Marketing + Vertrieb",
      horizon: "0-14 Tage",
      action: "Defensive Kommunikation im Kernsortiment starten",
      reason: `Business Impact liegt bei ${signed(agg.curNet)} und signalisiert kurzfristiges Umsatzrisiko fuer Nordzucker-Produkte.`,
      successKpi: "Business Impact >= 0",
      score,
    });
  }

  const sugarFree = topicById.zuckerfrei;
  if (sugarFree && sugarFree.vol >= 2 && sugarFree.net <= -15) {
    const score = 82 + Math.min(18, Math.abs(sugarFree.net));
    pushRecommendation({
      priority: "Hoch",
      owner: "Category Management",
      horizon: "0-7 Tage",
      action: "Narrativ zu Zuckerfrei gegen Nordzucker-Portfolio absichern",
      reason: `Thema Zuckerfrei zeigt ${signed(sugarFree.net)} bei ${sugarFree.vol} Erwaehnungen und drueckt den produktbezogenen Outcome.`,
      successKpi: "Impact Zuckerfrei > -10",
      score,
    });
  }

  const softdrinks = topicById.softdrinks;
  if (softdrinks && softdrinks.vol >= 3 && softdrinks.net <= -8) {
    const score = 76 + Math.min(20, Math.abs(softdrinks.net) + softdrinks.vol);
    pushRecommendation({
      priority: "Hoch",
      owner: "B2B Sales",
      horizon: "0-14 Tage",
      action: "Softdrink-Accounts mit Value-Story aktivieren",
      reason: `Softdrinks liegt bei ${signed(softdrinks.net)} und weist auf erhoehtes Abwanderungsrisiko im B2B-Kanal hin.`,
      successKpi: "Impact Softdrinks > 0",
      score,
    });
  }

  const preise = topicById.preise;
  if (preise && preise.vol >= 3 && preise.net >= 8) {
    const score = 58 + Math.min(30, preise.net + preise.vol);
    pushRecommendation({
      priority: "Mittel",
      owner: "Pricing + Vertrieb",
      horizon: "14-30 Tage",
      action: "Preis-Leistungs-Botschaft offensiv in Key Accounts platzieren",
      reason: `Preise erreicht ${signed(preise.net)} bei ${preise.vol} Erwaehnungen und kann fuer Margin-stabile Deals genutzt werden.`,
      successKpi: "Share positiver Preis-Mentions >= 35%",
      score,
    });
  }

  const seasonal = topicById.saisonal;
  if (seasonal && seasonal.vol >= 3 && seasonal.net >= 8) {
    const score = 54 + Math.min(28, seasonal.net + seasonal.vol);
    pushRecommendation({
      priority: "Mittel",
      owner: "Demand Planning",
      horizon: "7-21 Tage",
      action: "Saisonale Kampagnen auf volumenstarke Segmente ausrollen",
      reason: `Saisonal erreicht ${signed(seasonal.net)} bei ${seasonal.vol} Erwaehnungen und zeigt ein skalierbares Nachfragefenster.`,
      successKpi: "Saison-Volumen +15%",
      score,
    });
  }

  if (biggestRisk && biggestRisk.net < -10) {
    const score = 72 + Math.min(24, Math.abs(biggestRisk.net));
    pushRecommendation({
      priority: "Hoch",
      owner: "Corporate Communications",
      horizon: "0-7 Tage",
      action: `Thema ${biggestRisk.label} mit Gegenbotschaft besetzen`,
      reason: `Thema hat Impact ${signed(biggestRisk.net)} bei ${biggestRisk.vol} Erwaehnungen im Zeitraum und beeinflusst Kaufbereitschaft negativ.`,
      successKpi: `Impact ${biggestRisk.label} +10 Punkte`,
      score,
    });
  }

  if (liveSignals?.length) {
    const signal = liveSignals[0];
    const score = 50 + Math.min(20, Math.round((signal.score ?? 0.2) * 100 / 6));
    pushRecommendation({
      priority: "Mittel",
      owner: "Market Intelligence",
      horizon: "0-14 Tage",
      action: `Signal ${signal.title} operativ verfolgen`,
      reason: signal.text,
      successKpi: "Signal innerhalb 14 Tagen mit Entscheidung bewertet",
      score,
    });
  }

  if (!recommendations.length) {
    pushRecommendation({
      priority: "Mittel",
      owner: "Steering Committee",
      horizon: "30 Tage",
      action: "Aktuelle Strategie stabil halten und Monitoring fortfuehren",
      reason: "Keine kritischen Abweichungen in den aktuellen KPI-Trends identifiziert.",
      successKpi: "Business Impact stabil >= +5",
      score: 45,
    });
  }

  const viewBoost = (item) => {
    if (view === "bi" && (item.owner === "Category Management" || item.owner === "Pricing + Vertrieb")) return 8;
    if (view === "trends" && item.owner === "Market Intelligence") return 10;
    if (view === "dashboard" && item.priority === "Hoch") return 6;
    return 0;
  };

  const prioritized = recommendations
    .map((item) => ({ ...item, score: clampScore(item.score + viewBoost(item)) }))
    .sort((a, b) => b.score - a.score || b.rank - a.rank);

  const status = (() => {
    if (agg.curNet >= 10 && agg.netDelta >= 0) {
      return {
        label: "Gruen - Wachstumsfenster",
        tone: "green",
        detail: "Nordzucker profitiert aktuell von einem stabil positiven Nachfrage- und Kommunikationsumfeld.",
      };
    }
    if (agg.curNet <= -5 || agg.netDelta <= -10) {
      return {
        label: "Rot - Sofortmassnahmen noetig",
        tone: "red",
        detail: "Negative Signale ueberwiegen. Kurzfristige Gegensteuerung ist fuer Absatzschutz erforderlich.",
      };
    }
    return {
      label: "Gelb - Eng monitoren",
      tone: "amber",
      detail: "Gemischte Lage. Chancen vorhanden, aber Themenrisiken muessen eng operativ gefuehrt werden.",
    };
  })();

  const topThree = prioritized.slice(0, 3);
  const actionPlan = [
    {
      horizon: "30 Tage",
      objective: "Stabilisierung und Fokus auf Risiken",
      owner: "Marketing + Vertrieb",
      actions: topThree.slice(0, 2).map((item) => item.action).join("; ") || "Operative Lagebewertung und priorisierte Taskforce aufsetzen",
    },
    {
      horizon: "60 Tage",
      objective: "Kampagnen- und Portfoliojustierung",
      owner: "Category + Pricing",
      actions: topThree.map((item) => item.successKpi).join("; ") || "Themenspezifische Botschaften gegen Umsatzrisiken testen und ausrollen",
    },
    {
      horizon: "90 Tage",
      objective: "Skalierung in stabilen Segmenten",
      owner: "Steering Committee",
      actions: "Erfolgreiche Maßnahmen standardisieren, KPI-Fortschritt je Thema reviewen, Budget in positive Hebel umschichten",
    },
  ];

  const summaryRows = [
    ["Report", title],
    ["Zeitraum", `Letzte ${range} Tage`],
    ["Report-Fokus", view === "bi" ? "BI Steuerung" : view === "trends" ? "Risiko- und Signalfrueherkennung" : "Management Snapshot"],
    ["Business Impact (Net)", `${signed(agg.curNet)} (Delta ${signed(agg.netDelta)})`],
    ["Public Sentiment (Net)", `${signed(agg.curPublicNet)} (Delta ${signed(agg.publicNetDelta)})`],
    ["Erwaehnungen", `${agg.curVol} (Delta ${signed(agg.volDelta)}%)`],
    ["Positiver Business-Anteil", `${agg.posShare}%`],
    ["Top-Thema nach Volumen", topTopicByVolume ? `${topTopicByVolume.label} (${topTopicByVolume.vol})` : "n/a"],
  ];
  return {
    generatedAt: NOW.toLocaleDateString("de-DE"),
    summaryRows,
    status,
    actionPlan,
    recommendations: topThree,
  };
}
const toUtcDayKey = (value) => {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
};

const fromUtcDayKey = (key) => {
  const [y, m, d] = key.split("-").map((n) => Number(n));
  return new Date(Date.UTC(y, m - 1, d));
};

const addUtcDays = (date, days) => {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const dateLabel = (value) => {
  const d = value instanceof Date ? value : fromUtcDayKey(String(value));
  return `${String(d.getUTCDate()).padStart(2,"0")}.${String(d.getUTCMonth()+1).padStart(2,"0")}`;
};

const REGION_RULES = [
  { id:"bw", label:"Baden-Württemberg", rx:/\bbaden[-\s]?württemberg\b|\bbw\b/i },
  { id:"by", label:"Bayern", rx:/\bbayern\b|\bby\b/i },
  { id:"be", label:"Berlin", rx:/\bberlin\b|\bbe\b/i },
  { id:"bb", label:"Brandenburg", rx:/\bbrandenburg\b|\bbb\b/i },
  { id:"hb", label:"Bremen", rx:/\bbremen\b|\bhb\b/i },
  { id:"hh", label:"Hamburg", rx:/\bhamburg\b|\bhh\b/i },
  { id:"he", label:"Hessen", rx:/\bhessen\b|\bhe\b/i },
  { id:"mv", label:"Mecklenburg-Vorpommern", rx:/\bmecklenburg\b|\bvorpommern\b|\bmv\b/i },
  { id:"ni", label:"Niedersachsen", rx:/\bniedersachsen\b|\bni\b/i },
  { id:"nw", label:"Nordrhein-Westfalen", rx:/\bnordrhein[-\s]?westfalen\b|\bnrw\b|\bnw\b/i },
  { id:"rp", label:"Rheinland-Pfalz", rx:/\brheinland[-\s]?pfalz\b|\brp\b/i },
  { id:"sl", label:"Saarland", rx:/\bsaarland\b|\bsl\b/i },
  { id:"sn", label:"Sachsen", rx:/\bsachsen\b|\bsn\b/i },
  { id:"st", label:"Sachsen-Anhalt", rx:/\bsachsen[-\s]?anhalt\b|\bst\b/i },
  { id:"sh", label:"Schleswig-Holstein", rx:/\bschleswig[-\s]?holstein\b|\bsh\b/i },
  { id:"th", label:"Thüringen", rx:/\bthüringen\b|\bthueringen\b|\bth\b/i },
  { id:"de", label:"Deutschland", rx:/\bdeutschland\b|\bde\b/i },
];

const PRODUCT_RULES = [
  { id:"fluessig", label:"Flüssigzucker", rx:/\bflüssigzucker\b|\bfluessigzucker\b|\bsirup\b/i },
  { id:"braun", label:"Brauner Zucker", rx:/\bbrauner?\s+zucker\b|\brohrzucker\b|\bbrown\s+sugar\b/i },
  { id:"puder", label:"Puderzucker", rx:/\bpuderzucker\b|\bicing\s+sugar\b/i },
  { id:"kristall", label:"Kristallzucker", rx:/\bkristallzucker\b|\bhaushaltszucker\b|\bweisszucker\b|\bweißer?\s+zucker\b/i },
  { id:"zuckerfrei", label:"Zuckerfreie Produkte", rx:/\bzuckerfrei\b|\bohne\s+zucker\b|\bzero\s+sugar\b/i },
  { id:"softdrink", label:"Softdrink-Süßung", rx:/\bcola\b|\bsoftdrink\b|\blimonade\b|\bgetränk\b/i },
  { id:"suesswaren", label:"Süßwaren & Backen", rx:/\bschokolade\b|\bkuchen\b|\bgebäck\b|\bbacken\b|\bsüßware\b|\bsuessware\b/i },
];

const getQuarter = (d) => {
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} ${d.getFullYear()}`;
};

const inferRegion = (m) => {
  const text = `${m.text ?? ""} ${m.author ?? ""}`;
  for (const r of REGION_RULES) if (r.rx.test(text)) return r.label;
  return "Deutschland";
};

const inferProduct = (m) => {
  const text = `${m.text ?? ""} ${m.topicLabel ?? ""}`;
  for (const p of PRODUCT_RULES) if (p.rx.test(text)) return p.label;
  if (m.topic === "backen") return "Süßwaren & Backen";
  if (m.topic === "softdrinks") return "Softdrink-Süßung";
  if (m.topic === "zuckerfrei") return "Zuckerfreie Produkte";
  return "Sonstige Zuckerprodukte";
};

const enrichMentionForBI = (m) => ({
  ...m,
  quarter: getQuarter(m.date),
  region: inferRegion(m),
  product: inferProduct(m),
});

/* aggregate metrics for a window */
function aggregate(mentions, range, topicCatalog){
  const cut = NOW.getTime() - range * DAYMS;
  const prevCut = cut - range * DAYMS;
  const cur = mentions.filter(m => m.ts >= cut);
  const prev = mentions.filter(m => m.ts < cut && m.ts >= prevCut);
  const impactNet = arr => arr.length ? +(arr.reduce((s,m)=>s+m.sentiment,0)/arr.length*100).toFixed(0) : 0;
  const publicNet = arr => arr.length ? +(arr.reduce((s,m)=>s+(m.publicSentiment ?? m.sentiment),0)/arr.length*100).toFixed(0) : 0;
  const impactPositiveShare = arr => arr.length ? Math.round(arr.filter(m=>m.sentiment>0.15).length/arr.length*100) : 0;
  const publicPositiveShare = arr => arr.length ? Math.round(arr.filter(m=>(m.publicSentiment ?? m.sentiment)>0.15).length/arr.length*100) : 0;
  const curNet = impactNet(cur), prevNet = impactNet(prev);
  const curPublicNet = publicNet(cur), prevPublicNet = publicNet(prev);
  const curVol = cur.length, prevVol = prev.length;
  // daily series
  const byDay = {};
  cur.forEach(m => { const k = toUtcDayKey(m.date); (byDay[k] ??= []).push(m.sentiment); });
  const series = [];
  const todayUtc = fromUtcDayKey(toUtcDayKey(NOW));
  for (let d = range - 1; d >= 0; d--){
    const day = addUtcDays(todayUtc, -d);
    const k = toUtcDayKey(day);
    const vals = byDay[k] || [];
    series.push({ day: dateLabel(day), net: vals.length ? +(vals.reduce((a,b)=>a+b,0)/vals.length*100).toFixed(0):0, vol: vals.length });
  }
  // by source / topic
  const bySource = SOURCES.map(s => {
    const a = cur.filter(m=>m.source===s.id);
    return { id:s.id, label:s.label, net: impactNet(a), vol: a.length };
  });
  const byTopic = topicCatalog.map(t => {
    const a = cur.filter(m=>m.topic===t.id);
    return { id:t.id, label:t.label, net: impactNet(a), vol: a.length };
  }).filter(t=>t.vol>0).sort((a,b)=>b.vol-a.vol);
  return {
    cur, prev, curNet, prevNet, curVol, prevVol,
    curPublicNet, prevPublicNet,
    netDelta: curNet - prevNet, volDelta: prevVol ? Math.round((curVol-prevVol)/prevVol*100) : 0,
    publicNetDelta: curPublicNet - prevPublicNet,
    posShare: impactPositiveShare(cur), posShareDelta: impactPositiveShare(cur)-impactPositiveShare(prev),
    publicPosShare: publicPositiveShare(cur), publicPosShareDelta: publicPositiveShare(cur)-publicPositiveShare(prev),
    series, bySource, byTopic,
  };
}

function topicWindowStats(mentions, range, topicCatalog) {
  const cut = NOW.getTime() - range * DAYMS;
  const prevCut = cut - range * DAYMS;
  const avgSent = (arr) => arr.length
    ? +(arr.reduce((sum, m) => sum + (m.sentiment || 0), 0) / arr.length).toFixed(2)
    : 0;

  return topicCatalog.map((t) => {
    const curItems = mentions.filter((m) => m.topic === t.id && m.ts >= cut);
    const prevItems = mentions.filter((m) => m.topic === t.id && m.ts < cut && m.ts >= prevCut);
    const curVol = curItems.length;
    const prevVol = prevItems.length;
    const deltaPct = prevVol > 0 ? Math.round(((curVol - prevVol) / prevVol) * 100) : (curVol > 0 ? 100 : 0);
    return {
      id: t.id,
      label: t.label,
      curVol,
      prevVol,
      deltaPct,
      curSent: avgSent(curItems),
      prevSent: avgSent(prevItems),
    };
  });
}

const DEFAULT_SIGNAL_CONFIG = {
  maxSignals: 3,
  coverageMinMentions: 50,
  rules: {
    softdrinks: { minVol: 2, maxSent: -0.15 },
    seasonal: { minVol: 2, minDeltaPct: 20, minSent: 0 },
    tax: { minVol: 2, minDeltaPct: 20 },
  },
};

const DEFAULT_TREND_FOCUS_TOPICS = ["saisonal", "softdrinks", "zuckersteuer", "gesundheit"];

function deriveSignals(mentions, range, appSettings, topicCatalog) {
  const cut = NOW.getTime() - range * DAYMS;
  const curMentions = mentions.filter((m) => m.ts >= cut);
  const stats = topicWindowStats(mentions, range, topicCatalog);
  const byId = Object.fromEntries(stats.map((s) => [s.id, s]));
  const cfgRaw = appSettings?.signal_config ?? {};
  const cfg = {
    ...DEFAULT_SIGNAL_CONFIG,
    ...cfgRaw,
    rules: {
      ...DEFAULT_SIGNAL_CONFIG.rules,
      ...(cfgRaw.rules ?? {}),
    },
  };
  const signals = [];

  const pushSignal = (signal) => {
    if (!signal) return;
    if (signals.find((s) => s.key === signal.key)) return;
    signals.push(signal);
  };

  const soft = byId.softdrinks;
  if (soft && soft.curVol >= cfg.rules.softdrinks.minVol && soft.curSent <= cfg.rules.softdrinks.maxSent) {
    pushSignal({
      key: "softdrinks-risk",
      icon: ShieldAlert,
      color: "var(--neg)",
      bg: "var(--neg-bg)",
      severity: "Risiko",
      topic: soft.label,
      title: `${soft.label}: negative Stimmung im aktuellen Fenster`,
      body: `Im aktuellen Zeitraum wurden ${soft.curVol} Erwähnungen zu ${soft.label} mit Ø-Impact ${soft.curSent} erkannt. Das spricht für erhöhtes Beobachtungs- und Steuerungsbedarfsniveau für Nordzucker.`,
      tags: [`Volumen ${soft.curVol}`, `Impact ${soft.curSent}`, `${soft.deltaPct >= 0 ? "+" : ""}${soft.deltaPct}% ggü. Vorperiode`],
      action: "Frühwarnmonitoring auf Softdrink-nahe Nachfrageindikatoren verdichten und mit Vertriebsszenarien spiegeln.",
    });
  }

  const seasonal = byId.saisonal;
  if (
    seasonal &&
    seasonal.curVol >= cfg.rules.seasonal.minVol &&
    seasonal.deltaPct >= cfg.rules.seasonal.minDeltaPct &&
    seasonal.curSent >= cfg.rules.seasonal.minSent
  ) {
    pushSignal({
      key: "seasonal-chance",
      icon: Sun,
      color: "var(--green-d)",
      bg: "#edf7e6",
      severity: "Chance",
      topic: seasonal.label,
      title: `${seasonal.label}: positives Momentum`,
      body: `${seasonal.label} steigt um ${seasonal.deltaPct}% bei Ø-Impact ${seasonal.curSent}. Das deutet auf eine verwertbare saisonale Absatzchance für Nordzucker hin.`,
      tags: [`Volumen ${seasonal.curVol}`, `Impact ${seasonal.curSent}`, `+${seasonal.deltaPct}%`],
      action: "Gezielte saisonale B2B-Ansprache und Lieferplanung entlang Peak-Wochen priorisieren.",
    });
  }

  const tax = byId.zuckersteuer;
  if (tax && tax.curVol >= cfg.rules.tax.minVol && tax.deltaPct >= cfg.rules.tax.minDeltaPct) {
    pushSignal({
      key: "tax-watch",
      icon: AlertTriangle,
      color: "var(--neu)",
      bg: "var(--neu-bg)",
      severity: "Beobachten",
      topic: tax.label,
      title: `${tax.label}: Dynamik nimmt zu`,
      body: `${tax.curVol} Erwähnungen mit ${tax.deltaPct >= 0 ? "+" : ""}${tax.deltaPct}% Veränderung signalisieren erhöhte regulatorische Diskussion.`,
      tags: [`Volumen ${tax.curVol}`, `${tax.deltaPct >= 0 ? "+" : ""}${tax.deltaPct}%`],
      action: "Public-Affairs-Tracking und regulatorische Szenarien monatlich aktualisieren.",
    });
  }

  if (curMentions.length < cfg.coverageMinMentions) {
    pushSignal({
      key: "coverage-watch",
      icon: AlertTriangle,
      color: "var(--neu)",
      bg: "var(--neu-bg)",
      severity: "Beobachten",
      topic: "Datenabdeckung",
      title: "Geringe Stichprobe im Analysefenster",
      body: `Aktuell liegen ${curMentions.length} Erwähnungen vor. Trend- und Risikoaussagen sind dadurch richtungsweisend, aber noch nicht hoch belastbar.`,
      tags: [`${curMentions.length} Erwähnungen`, `Qualitätshinweis`],
      action: "Quellenabdeckung erhöhen und vor Entscheidungen zusätzliche Läufe über mehrere Tage einplanen.",
    });
  }

  if (signals.length < cfg.maxSignals) {
    const candidates = stats
      .filter((s) => s.curVol > 0)
      .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
    for (const c of candidates) {
      if (signals.length >= cfg.maxSignals) break;
      pushSignal({
        key: `topic-${c.id}`,
        icon: c.curSent < -0.15 ? ShieldAlert : c.curSent > 0.15 ? Sun : AlertTriangle,
        color: c.curSent < -0.15 ? "var(--neg)" : c.curSent > 0.15 ? "var(--green-d)" : "var(--neu)",
        bg: c.curSent < -0.15 ? "var(--neg-bg)" : c.curSent > 0.15 ? "#edf7e6" : "var(--neu-bg)",
        severity: c.curSent < -0.15 ? "Risiko" : c.curSent > 0.15 ? "Chance" : "Beobachten",
        topic: c.label,
        title: `${c.label}: datengetriebener Themenimpuls`,
        body: `${c.curVol} Erwähnungen, Ø-Impact ${c.curSent}, Veränderung ${c.deltaPct >= 0 ? "+" : ""}${c.deltaPct}% zur Vorperiode.`,
        tags: [`Volumen ${c.curVol}`, `Impact ${c.curSent}`, `${c.deltaPct >= 0 ? "+" : ""}${c.deltaPct}%`],
        action: "Thema im Monitoring halten und bei wiederholter Bestätigung in Maßnahmen überführen.",
      });
    }
  }

  return signals.slice(0, cfg.maxSignals);
}

/* =========================  SHARED UI  ========================= */
const ChartTip = ({ active, payload, label, unit }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{background:"#fff",border:"1px solid var(--line)",borderRadius:10,padding:"9px 12px",
      boxShadow:"var(--shadow-l)",fontSize:12}}>
      <div style={{fontWeight:600,marginBottom:4}}>{label}</div>
      {payload.map((p,i)=>(
        <div key={i} style={{display:"flex",gap:8,alignItems:"center",color:"var(--ink-2)"}}>
          <span style={{width:8,height:8,borderRadius:2,background:p.color||p.fill}}/>
          {p.name}: <b style={{color:"var(--ink)"}}>{p.value}{unit||""}</b>
        </div>
      ))}
    </div>
  );
};
const Delta = ({ v, suffix="" }) => {
  const cls = v>0?"up":v<0?"down":"flat";
  const Ico = v>0?ArrowUpRight:v<0?ArrowDownRight:Minus;
  return <span className={`delta ${cls}`}><Ico size={12}/>{(v>0?"+":"")+v}{suffix}</span>;
};
const InfoHint = ({ title, text, align = "right" }) => (
  <details className={`info-wrap ${align === "left" ? "left" : ""}`}>
    <summary className="info-btn" aria-label={`Info zu ${title}`} title={`Info zu ${title}`}>
      <Info size={13} />
    </summary>
    <div className="info-pop">
      <div className="t">Info</div>
      <p>{text}</p>
    </div>
  </details>
);

/* =========================  DASHBOARD  ========================= */
function Dashboard({ agg, range, signals }){
  const severityCount = signals.reduce((acc, s) => {
    acc[s.severity] = (acc[s.severity] ?? 0) + 1;
    return acc;
  }, {});
  const sourcePie = agg.bySource.map(s => ({ name:s.label, value:s.vol }));
  const PIECOL = ["#004b93","#0a6cd4","#6cbf4b","#6d5ce7"];
  const impactDomain = useMemo(() => buildSymmetricDomain(agg.series, "net"), [agg.series]);
  return (
    <>
      <p className="lede" style={{marginBottom:20}}>
        Aggregierte Geschäftsauswirkung für Nordzucker aus öffentlichen Quellen, verdichtet über die letzten {range} Tage.
        Kommentare werden nicht nur sprachlich, sondern vor allem nach ihrer wahrscheinlichen Wirkung auf Zucker- und Absatzinteressen von Nordzucker bewertet.
      </p>

      {/* KPIs */}
      <div className="grid g-kpi4" style={{marginBottom:16}}>
        <div className="card kpi">
          <div className="mobile-stack">
            <span className="lab"><Activity size={14}/> Geschäftsauswirkung
              <InfoHint title="Geschäftsauswirkung" text="Skala von -100 bis +100. Positive Werte zeigen voraussichtlich günstige Wirkung auf Nachfrage/Absatz, negative Werte deuten auf Geschäftsrisiken hin. Wichtiger als ein Einzelwert ist die Richtung über mehrere Tage." />
            </span>
            <span className="kpi-ico" style={{background:"var(--nz-100)",color:"var(--nz-700)"}}><Activity size={17}/></span>
          </div>
          <div className="val" style={{color:sentColor(agg.curNet/100)}}>{agg.curNet>0?"+":""}{agg.curNet}</div>
          <Delta v={agg.netDelta} suffix=" Pkt." /> <span style={{fontSize:11.5,color:"var(--ink-3)"}}>ggü. Vorperiode</span>
        </div>
        <div className="card kpi">
          <div className="mobile-stack">
            <span className="lab"><MessageSquare size={14}/> Erwähnungen
              <InfoHint title="Erwähnungen" text="Zeigt die Datenmenge im gewählten Zeitraum. Mehr Volumen erhöht die Aussagekraft, starkes Plus/Minus kann aber auch nur durch einzelne Quellen oder Events entstehen." />
            </span>
            <span className="kpi-ico" style={{background:"var(--nz-100)",color:"var(--nz-700)"}}><MessageSquare size={16}/></span>
          </div>
          <div className="val">{agg.curVol.toLocaleString("de-DE")}</div>
          <Delta v={agg.volDelta} suffix=" %" /> <span style={{fontSize:11.5,color:"var(--ink-3)"}}>Volumen</span>
        </div>
        <div className="card kpi">
          <div className="mobile-stack">
            <span className="lab"><CheckCircle2 size={14}/> Geschäftlich positiv
              <InfoHint title="Geschäftlich positiv" text="Anteil der Beiträge mit klar positivem Business-Impact. Hohe Werte zeigen Chancenpotenzial, aber nur in Kombination mit ausreichendem Volumen und stabiler Trendlinie." />
            </span>
            <span className="kpi-ico" style={{background:"var(--pos-bg)",color:"var(--pos)"}}><CheckCircle2 size={16}/></span>
          </div>
          <div className="val">{agg.posShare}%</div>
          <Delta v={agg.posShareDelta} suffix=" pp" />
        </div>
        <div className="card kpi">
          <div className="mobile-stack">
            <span className="lab"><ShieldAlert size={14}/> Aktive Signale
              <InfoHint title="Aktive Signale" text="Anzahl automatisch erkannter Risiko-, Chancen- oder Beobachtungssignale. Viele Signale bedeuten nicht automatisch Krise, sondern eher höheren Steuerungsbedarf." />
            </span>
            <span className="kpi-ico" style={{background:"var(--neg-bg)",color:"var(--neg)"}}><ShieldAlert size={16}/></span>
          </div>
          <div className="val">{signals.length}</div>
          <span className="pill neg" style={{marginTop:2}}>
            {(severityCount.Risiko ?? 0)} Risiko · {(severityCount.Chance ?? 0)} Chance · {(severityCount.Beobachten ?? 0)} Beobachtung
          </span>
        </div>
      </div>

      {/* trend + source */}
      <div className="grid g-split-2-1" style={{marginBottom:16}}>
        <div className="card">
          <div className="card-h"><div><div style={{display:"flex",alignItems:"center",gap:6}}><div className="card-t">Stimmungsverlauf</div>
            <InfoHint title="Stimmungsverlauf" text="Die Kurve zeigt den täglichen Business-Impact. Wichtiger als einzelne Ausreißer ist, ob sich ein Trend über mehrere Tage ober- oder unterhalb der Nulllinie stabilisiert." />
          </div>
            <div className="card-s">Täglicher Nordzucker-Impact über {range} Tage</div></div></div>
          <ResponsiveContainer width="100%" height={230}>
            <AreaChart data={agg.series} margin={{top:5,right:6,left:-18,bottom:0}}>
              <defs>
                <linearGradient id="gPos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0a6cd4" stopOpacity={0.32}/>
                  <stop offset="100%" stopColor="#0a6cd4" stopOpacity={0.02}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f8" vertical={false}/>
              <XAxis dataKey="day" tick={{fontSize:11,fill:"#8694a8"}} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24}/>
              <YAxis tick={{fontSize:11,fill:"#8694a8"}} axisLine={false} tickLine={false} domain={impactDomain}/>
              <ReferenceLine y={0} stroke="#e4eaf2" />
              <Tooltip content={<ChartTip/>}/>
              <Area type="monotone" dataKey="net" name="Geschäftsauswirkung" stroke="#0a5cb8" strokeWidth={2.4} fill="url(#gPos)"/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <div className="card-h"><div style={{display:"flex",alignItems:"center",gap:6}}><div className="card-t">Quellen-Mix</div>
            <InfoHint title="Quellen-Mix" text="Zeigt, aus welchen Kanälen die Daten stammen. Ein sehr einseitiger Mix kann Interpretationen verzerren; robuste Trends sollten in mehreren Quellen sichtbar sein." />
          </div></div>
          <ResponsiveContainer width="100%" height={170}>
            <PieChart>
              <Pie data={sourcePie} dataKey="value" nameKey="name" innerRadius={42} outerRadius={66} paddingAngle={2}>
                {sourcePie.map((e,i)=><Cell key={i} fill={PIECOL[i%4]}/>)}
              </Pie>
              <Tooltip content={<ChartTip/>}/>
            </PieChart>
          </ResponsiveContainer>
          <div style={{display:"flex",flexDirection:"column",gap:5,marginTop:6}}>
            {sourcePie.map((s,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:8,fontSize:12}}>
                <span className="dot" style={{background:PIECOL[i%4]}}/>{s.name}
                <span style={{marginLeft:"auto",fontWeight:600}}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* topic sentiment + signals */}
      <div className="grid g-split-1-1" style={{marginBottom:16}}>
        <div className="card">
          <div className="card-h"><div><div style={{display:"flex",alignItems:"center",gap:6}}><div className="card-t">Geschäftsauswirkung nach Thema</div>
            <InfoHint title="Geschäftsauswirkung nach Thema" text="Vergleicht Themencluster nach ihrer mutmaßlichen Wirkung auf Nordzucker. Priorität haben Themen mit stark negativem Wert und gleichzeitig hohem Volumen." />
          </div>
            <div className="card-s">Nordzucker-Impact je Themencluster</div></div></div>
          {agg.byTopic.slice(0,7).map(t=>{
            const w = Math.abs(t.net); 
            return (
              <div className="tbar" key={t.id}>
                <span className="nm">{t.label}</span>
                <span className="track"><span className="fill"
                  style={{width:Math.max(6,w)+"%",background:sentColor(t.net/100)}}/></span>
                <span className="sc" style={{color:sentColor(t.net/100)}}>{t.net>0?"+":""}{t.net}</span>
              </div>
            );
          })}
        </div>
        <div className="card">
          <div className="card-h"><div style={{display:"flex",alignItems:"center",gap:6}}><div className="card-t">Signale & Risiken</div>
            <InfoHint title="Signale und Risiken" text="Automatisch erkannte Auffälligkeiten auf Basis von Volumen, Trend und Impact. Nutze sie als Frühwarnsystem, validiere kritische Signale aber immer mit Detaildaten." />
          </div></div>
          {signals.length === 0 ? (
            <div className="empty" style={{padding:"22px 12px"}}>
              <AlertTriangle size={20} style={{color:"var(--ink-3)"}}/>
              <div>Keine belastbaren Signale im aktuellen Datenfenster.</div>
            </div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:11}}>
              {signals.map((s,i)=>(
                <div className="signal" key={i}>
                  <span className="bar" style={{background:s.color}}/>
                  <span className="s-ico" style={{background:s.bg,color:s.color}}><s.icon size={19}/></span>
                  <div>
                    <h4>{s.title}</h4>
                    <p>{s.body}</p>
                    <div className="meta">{s.tags.map((t,j)=><span className="tag" key={j}>{t}</span>)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* =========================  TRENDS & RISIKEN  ========================= */
function Trends({ mentions, range, signals, appSettings, topicCatalog }){
  // topic momentum: current vs previous window volume
  const cut = NOW.getTime()-range*DAYMS, prevCut = cut-range*DAYMS;
  const mom = topicCatalog.map(t=>{
    const cur = mentions.filter(m=>m.topic===t.id && m.ts>=cut).length;
    const prev = mentions.filter(m=>m.topic===t.id && m.ts<cut && m.ts>=prevCut).length || 1;
    return { ...t, cur, delta: Math.round((cur-prev)/prev*100) };
  }).sort((a,b)=>b.delta-a.delta);
  // multi-line topic volume series (weekly buckets over range)
  const configuredFocus = Array.isArray(appSettings?.trend_focus_topics)
    ? appSettings.trend_focus_topics
    : DEFAULT_TREND_FOCUS_TOPICS;
  const topicById = Object.fromEntries(topicCatalog.map((t) => [t.id, t]));
  const focus = configuredFocus.filter((id) => topicById[id]);
  const buckets = Math.min(range, 30);
  const todayUtc = fromUtcDayKey(toUtcDayKey(NOW));
  const series = [];
  for (let d = buckets; d >= 1; d--){
    const day = addUtcDays(todayUtc, -d);
    const dayKey = toUtcDayKey(day);
    const row = { day: dateLabel(day) };
    focus.forEach(f=>{ row[f]=mentions.filter(m=>m.topic===f && toUtcDayKey(m.date)===dayKey).length; });
    series.push(row);
  }
  const labelFor = (id) => topicById[id]?.label ?? topicLabelFromId(id);
  const colorFor = (id) => topicById[id]?.color ?? DEFAULT_TOPIC_COLORS[id] ?? "#0a6cd4";

  const risks = signals.map((s) => ({
    sev: s.severity === "Risiko" ? "Hoch" : s.severity === "Chance" ? "Chance" : "Mittel",
    color: s.color,
    title: s.title,
    body: s.body,
    action: s.action,
  }));
  return (
    <>
      <p className="lede" style={{marginBottom:20}}>
        Themen-Momentum, aufkommende Diskussionen und konkrete Risiko-/Chancen-Lagen aus Sicht von Nordzucker.
        Grundlage ist nicht die bloße Sprachtonalität, sondern die wahrscheinliche Geschäftsrelevanz der Aussagen.
      </p>
      <div className="grid g-split-2-1" style={{marginBottom:16}}>
        <div className="card">
          <div className="card-h"><div><div style={{display:"flex",alignItems:"center",gap:6}}><div className="card-t">Themen-Volumen im Zeitverlauf</div>
            <InfoHint title="Themen-Volumen" text="Zeigt die Anzahl Erwähnungen pro Tag. Ein steigendes Volumen ohne Impact-Verbesserung kann auf wachsende Diskussion bei gleichbleibendem Risiko hindeuten." />
          </div>
            <div className="card-s">Erwähnungen je Tag, ausgewählte Cluster</div></div></div>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={series} margin={{top:5,right:8,left:-20,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f8" vertical={false}/>
              <XAxis dataKey="day" tick={{fontSize:11,fill:"#8694a8"}} axisLine={false} tickLine={false} minTickGap={26}/>
              <YAxis tick={{fontSize:11,fill:"#8694a8"}} axisLine={false} tickLine={false}/>
              <Tooltip content={<ChartTip/>}/>
              {focus.map(f=><Line key={f} type="monotone" dataKey={f} name={labelFor(f)} stroke={colorFor(f)} strokeWidth={2.2} dot={false}/>)}
            </LineChart>
          </ResponsiveContainer>
          <div style={{display:"flex",gap:16,flexWrap:"wrap",marginTop:8}}>
            {focus.map(f=>(<span key={f} style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:"var(--ink-2)"}}>
              <span className="dot" style={{background:colorFor(f)}}/>{labelFor(f)}</span>))}
          </div>
        </div>
        <div className="card">
          <div className="card-h"><div><div style={{display:"flex",alignItems:"center",gap:6}}><div className="card-t">Momentum</div>
            <InfoHint title="Momentum" text="Prozentuale Veränderung gegenüber der Vorperiode. Hohe Prozentwerte bei sehr kleinem Basisvolumen können überzeichnet sein, deshalb immer mit absoluten Werten lesen." />
          </div>
            <div className="card-s">Volumen ggü. Vorperiode</div></div></div>
          <div style={{display:"flex",flexDirection:"column",gap:3}}>
            {mom.slice(0,7).map(t=>(
              <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",borderBottom:"1px solid var(--line-2)"}}>
                <span style={{fontSize:12.5,fontWeight:500,flex:1}}>{t.label}</span>
                <span style={{fontSize:11.5,color:"var(--ink-3)"}}>{t.cur}×</span>
                <Delta v={t.delta} suffix=" %"/>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-h"><div style={{display:"flex",alignItems:"center",gap:6}}><div className="card-t">Risiko- & Chancen-Register</div>
          <InfoHint title="Risiko- und Chancen-Register" text="Kondensiert relevante Signale in priorisierte Felder. Fokus zuerst auf hohe Risiken mit klarer Handlungsempfehlung und kurzer Zeitschiene." />
        </div></div>
        {risks.length === 0 ? (
          <div className="empty" style={{padding:"22px 12px"}}>
            <AlertTriangle size={20} style={{color:"var(--ink-3)"}}/>
            <div>Keine Risiko-/Chancen-Signale aus den aktuellen Daten ableitbar.</div>
          </div>
        ) : (
          <div style={{display:"flex",flexDirection:"column",gap:13}}>
            {risks.map((r,i)=>(
              <div key={i} style={{display:"flex",gap:14,padding:"14px 0",borderBottom:i<risks.length-1?"1px solid var(--line-2)":"0"}}>
                <div style={{width:74,flex:"none"}}>
                  <span className="prio" style={{color:r.color,background:r.color+"1a",border:`1px solid ${r.color}`}}>{r.sev}</span>
                </div>
                <div style={{flex:1}}>
                  <h4 style={{margin:"0 0 5px",fontFamily:"Space Grotesk",fontSize:14.5,fontWeight:600}}>{r.title}</h4>
                  <p style={{margin:"0 0 7px",fontSize:12.8,color:"var(--ink-2)",lineHeight:1.55}}>{r.body}</p>
                  <p style={{margin:0,fontSize:12.5,color:"var(--ink)"}}><b style={{color:"var(--nz-700)"}}>Empfehlung:</b> {r.action}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/* =========================  EMPFEHLUNGEN & PROGNOSEN (AI)  ========================= */
function Recommendations({ dataSummary }){
  const [state, setState] = useState("idle"); // idle|loading|done|error
  const [recs, setRecs] = useState([]); const [fc, setFc] = useState([]); const [actions, setActions] = useState([]); const [err, setErr] = useState("");
  const run = async () => {
    if (!LIVE){
      setErr("Demo-Modus aktiv. Verbinde das Supabase-Backend (VITE_SUPABASE_URL in der .env), um echte KI-Empfehlungen aus den Live-Daten zu generieren.");
      setState("error"); return;
    }
    setState("loading"); setErr("");
    try {
      const parsed = await aiRecommendations(dataSummary);
      setRecs(parsed.recommendations||[]); setFc(parsed.forecasts||[]); setActions(parsed.actions||[]); setState("done");
    } catch(e){ setErr(String(e.message||e)); setState("error"); }
  };
  const pCol = p => p==="hoch"?"var(--neg)":p==="mittel"?"var(--neu)":"var(--ink-3)";
  const dIco = d => d==="steigend"?ArrowUpRight:d==="fallend"?ArrowDownRight:Minus;
  const renderCitations = (citations=[]) => citations.length ? (
    <div style={{marginTop:8,fontSize:11.5,color:"var(--ink-3)",display:"grid",gap:4}}>
      <b>Belege</b>
      {citations.map((c, i) => (
        <div key={i}>[{c.ref}] {c.source}{c.author ? ` · ${c.author}` : ""}: "{c.excerpt}"</div>
      ))}
    </div>
  ) : null;
  return (
    <>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:16,marginBottom:20,flexWrap:"wrap"}}>
        <p className="lede" style={{margin:0}}>
          KI-gestützte Handlungsempfehlungen und Prognosen, generiert auf Basis der aktuell analysierten Wirkungs- und Trenddaten für Nordzucker.
          Jede Anfrage ruft live das Sprachmodell über die API auf.
        </p>
        <button className="btn btn-pri no-print" onClick={run} disabled={state==="loading"}>
          {state==="loading"?<Loader2 size={15} className="spin"/>:<Sparkles size={15}/>}
          {state==="done"?"Neu generieren":"Analyse starten"}
        </button>
      </div>

      {state==="idle" && (
        <div className="card"><div className="empty">
          <Sparkles size={30} style={{color:"var(--violet)"}}/>
          <div style={{fontWeight:600,fontSize:15,color:"var(--ink)"}}>Bereit zur Analyse</div>
          <div style={{maxWidth:440}}>Klicke auf „Analyse starten“, um aus den aktuellen Daten Empfehlungen und Prognosen abzuleiten.</div>
        </div></div>
      )}
      {state==="error" && (
        <div className="card"><div className="empty">
          <AlertTriangle size={28} style={{color:"var(--neg)"}}/>
          <div style={{fontWeight:600,color:"var(--ink)"}}>Analyse fehlgeschlagen</div>
          <div style={{maxWidth:460,fontSize:12.5}}>Die KI-Schnittstelle ist in dieser Umgebung evtl. nicht erreichbar. Details: {err}</div>
        </div></div>
      )}
      {state==="done" && (
        <div className="grid g-split-13-1">
          <div className="card">
            <div className="card-h"><div className="card-t">Handlungsempfehlungen</div></div>
            <div style={{display:"flex",flexDirection:"column",gap:11}}>
              {recs.map((r,i)=>(
                <div className="ai-card" key={i}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"start"}}>
                    <h4>{r.title}</h4>
                    <span className="prio" style={{color:pCol(r.priority),background:pCol(r.priority)+"1a",flex:"none"}}>{r.priority}</span>
                  </div>
                  <p>{r.rationale}</p>
                  <p style={{marginTop:6,color:"var(--ink-3)",fontSize:11.5}}><b>Horizont:</b> {r.horizon} · <b>Konfidenz:</b> {r.confidence}</p>
                  {renderCitations(r.citations)}
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-h"><div className="card-t">Prognosen</div></div>
            <div style={{display:"flex",flexDirection:"column",gap:11}}>
              {fc.map((f,i)=>{ const D=dIco(f.direction);
                return (
                <div className="ai-card" key={i} style={{borderLeftColor:"var(--nz-500)"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                    <D size={16} style={{color:f.direction==="steigend"?"var(--pos)":f.direction==="fallend"?"var(--neg)":"var(--ink-3)"}}/>
                    <h4 style={{margin:0}}>{f.topic}</h4>
                  </div>
                  <p>{f.statement}</p>
                  <p style={{marginTop:6,color:"var(--ink-3)",fontSize:11.5}}><b>Richtung:</b> {f.direction} · <b>Konfidenz:</b> {f.confidence}</p>
                  {renderCitations(f.citations)}
                </div>
              );})}
            </div>
          </div>
          <div className="card">
            <div className="card-h"><div className="card-t">Commercial Actions</div></div>
            <div style={{display:"flex",flexDirection:"column",gap:11}}>
              {actions.map((a,i)=>(
                <div className="ai-card" key={i} style={{borderLeftColor:"var(--pos)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"start"}}>
                    <h4>{a.title}</h4>
                    <span className="prio" style={{color:"var(--pos)",background:"var(--pos-bg)",flex:"none"}}>{a.confidence}</span>
                  </div>
                  <p>{a.steps}</p>
                  <p style={{marginTop:6,color:"var(--ink-3)",fontSize:11.5}}><b>Owner:</b> {a.owner} · <b>Horizont:</b> {a.horizon}</p>
                  {renderCitations(a.citations)}
                </div>
              ))}
              {actions.length===0 && <div style={{fontSize:12.5,color:"var(--ink-3)"}}>Keine Maßnahmenvorschläge zurückgegeben.</div>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* =========================  KI-ASSISTENT (chat)  ========================= */
const ASSISTANT_SESSION_KEY = "scf_ai_session_id";

function getAssistantSessionId(){
  if (typeof window === "undefined") return "session-server";
  const existing = window.localStorage.getItem(ASSISTANT_SESSION_KEY);
  if (existing) return existing;
  const generated = window.crypto?.randomUUID?.() ?? `session-${Date.now()}`;
  window.localStorage.setItem(ASSISTANT_SESSION_KEY, generated);
  return generated;
}

function Assistant({ dataSummary }){
  const [log, setLog] = useState([]);
  const [history, setHistory] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [input, setInput] = useState(""); const [busy, setBusy] = useState(false);
  const [sessionId] = useState(() => getAssistantSessionId());
  const endRef = useRef(null);
  useEffect(()=>{ endRef.current?.scrollIntoView({behavior:"smooth"}); }, [log, busy]);

  const refreshHistory = async () => {
    if (!LIVE) {
      setHistory([]);
      return;
    }
    try {
      const rows = await aiConversationHistory(sessionId, 20);
      setHistory(rows);
    } catch {
      setHistory([]);
    }
  };

  useEffect(() => {
    refreshHistory();
  }, [sessionId]);

  const suggestions = [
    "Welche Themen sind aktuell das größte Risiko für unser B2B-Geschäft?",
    "Wie steht Nordzucker im Stimmungsvergleich zu Südzucker?",
    "Was treibt die saisonalen Trends gerade an?",
  ];

  const startNewConversation = () => {
    setConversationId(null);
    setLog([]);
    setInput("");
  };

  const openConversation = async (id) => {
    if (!id || !LIVE || historyBusy || busy) return;
    setHistoryBusy(true);
    try {
      const data = await aiConversationMessages(sessionId, id, 160);
      const msgs = Array.isArray(data?.messages)
        ? data.messages
          .filter((m) => m?.role === "user" || m?.role === "assistant")
          .map((m) => ({ role: m.role, content: String(m.content ?? "") }))
        : [];
      setConversationId(id);
      setLog(msgs);
    } catch {
      setLog((prev) => [...prev, {
        role: "assistant",
        content: "Verlauf konnte nicht geladen werden. Bitte erneut versuchen.",
      }]);
    } finally {
      setHistoryBusy(false);
    }
  };

  const send = async (q) => {
    const text = (q ?? input).trim(); if (!text || busy) return;
    const next = [...log, { role:"user", content:text }];
    setLog(next); setInput(""); setBusy(true);
    if (!LIVE){
      setLog([...next, { role:"assistant", content:"Demo-Modus: Der KI-Assistent benötigt das verbundene Supabase-Backend. Hinterlege VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY in der .env und deploye die ai-query Edge Function, dann beantworte ich Fragen auf Basis der Live-Daten." }]);
      setBusy(false); return;
    }
    try {
      const response = await aiChat({
        session_id: sessionId,
        conversation_id: conversationId,
        messages: next.map((m) => ({ role: m.role, content: m.content })),
        question: text,
        days: 3650,
      });
      const nextConversationId = response?.conversation_id ?? conversationId;
      if (nextConversationId) setConversationId(nextConversationId);
      setLog([...next, { role:"assistant", content:String(response?.answer ?? "") }]);
      refreshHistory();
    } catch(e){
      const message = String(e?.message ?? e ?? "").trim();
      const fallback = "Die KI-Schnittstelle ist gerade nicht erreichbar.";
      setLog([...next, {
        role:"assistant",
        content: message ? `${fallback} ${message}` : `${fallback} Prüfe, ob die ai-query Edge Function deployed und ANTHROPIC_API_KEY gesetzt ist.`,
      }]);
    } finally { setBusy(false); }
  };
  return (
    <div className="card chat-wrap">
      <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:10,flexWrap:"wrap"}}>
        <button className="btn" onClick={startNewConversation} disabled={busy || historyBusy}>Neue Unterhaltung</button>
        <select
          value={conversationId ?? ""}
          onChange={(e) => openConversation(e.target.value)}
          disabled={!LIVE || busy || historyBusy || history.length === 0}
          style={{
            minWidth: 260,
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: "8px 10px",
            color: "var(--ink)",
            background: "#fff",
          }}
        >
          <option value="">{history.length === 0 ? "Kein Verlauf" : "Verlauf auswählen"}</option>
          {history.map((row) => (
            <option key={row.id} value={row.id}>
              {row.title || "Neue Unterhaltung"}
            </option>
          ))}
        </select>
        {historyBusy && <span style={{fontSize:12,color:"var(--ink-3)"}}>Lade Verlauf...</span>}
      </div>
      {log.length===0 ? (
        <div className="empty" style={{flex:1,justifyContent:"center"}}>
          <MessageSquare size={30} style={{color:"var(--nz-500)"}}/>
          <div style={{fontWeight:600,fontSize:15,color:"var(--ink)"}}>Frag die Daten</div>
          <div style={{maxWidth:440}}>Stelle Fragen zur Geschäftsauswirkung, zu Trends, Risiken oder zum Wettbewerb. Antworten basieren auf den live aggregierten Daten aus Sicht von Nordzucker.</div>
        </div>
      ) : (
        <div className="chat-log">
          {log.map((m,i)=>(
            <div key={i} className={`msg ${m.role==="user"?"u":"a"}`}>
              {m.role === "assistant" ? (
                <div className="chat-md">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {m.content}
                  </ReactMarkdown>
                </div>
              ) : (
                m.content.split("\n").filter(Boolean).map((p,j)=><p key={j} style={{margin:0}}>{p}</p>)
              )}
            </div>
          ))}
          {busy && <div className="msg a"><Loader2 size={16} className="spin"/></div>}
          <div ref={endRef}/>
        </div>
      )}
      <div>
        {log.length===0 && (
          <div className="suggest">
            {suggestions.map((s,i)=><button key={i} className="chip" onClick={()=>send(s)}>{s}</button>)}
          </div>
        )}
        <div className="chat-in">
          <input value={input} onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&send()} placeholder="Frage zur Nordzucker-Auswirkung stellen…"/>
          <button className="btn btn-pri" onClick={()=>send()} disabled={busy}><Send size={15}/></button>
        </div>
      </div>
    </div>
  );
}

/* =========================  DATENQUELLEN / SCHNITTSTELLEN  ========================= */
function SettingsAdmin({ appSettings, sourceHealth, onSaveSettings }){
  const [adminSecret, setAdminSecret] = useState("");
  const [topicDraft, setTopicDraft] = useState(() => draftTopicCatalog(appSettings));
  const [sourceDraft, setSourceDraft] = useState(() => draftSourceCatalog(appSettings, sourceHealth));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    setTopicDraft(draftTopicCatalog(appSettings));
    setSourceDraft(draftSourceCatalog(appSettings, sourceHealth));
  }, [appSettings, sourceHealth]);

  const updateRow = (kind, index, field, value) => {
    if (kind === "topic") {
      setTopicDraft((rows) => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
      return;
    }
    setSourceDraft((rows) => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
  };

  const addRow = (kind) => {
    if (kind === "topic") {
      setTopicDraft((rows) => [...rows, { id: "", label: "", lean: 0, color: "#0a6cd4" }]);
      return;
    }
    setSourceDraft((rows) => [...rows, { id: "", label: "", priority: 999, color: "#0a6cd4" }]);
  };

  const removeRow = (kind, index) => {
    if (kind === "topic") {
      setTopicDraft((rows) => rows.filter((_, rowIndex) => rowIndex !== index));
      return;
    }
    setSourceDraft((rows) => rows.filter((_, rowIndex) => rowIndex !== index));
  };

  const save = async () => {
    setSaving(true);
    setStatus("");
    try {
      const entries = [
        { key: "topic_catalog", value: normalizeTopicCatalogDraft(topicDraft) },
        { key: "source_catalog", value: normalizeSourceCatalogDraft(sourceDraft) },
      ];
      await onSaveSettings(entries, adminSecret.trim());
      setStatus("Gespeichert");
    } catch (error) {
      setStatus(`Fehler: ${String(error?.message ?? error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <div className="card-h">
        <div>
          <div className="card-t">Katalog-Pflege</div>
          <div className="card-s">Bearbeitet app_settings ohne SQL; Secret wird nur lokal im Formular verwendet.</div>
        </div>
        <button className="btn btn-pri" onClick={save} disabled={saving}>{saving ? "Speichert..." : "Speichern"}</button>
      </div>

      <div className="grid catalog-grid" style={{ marginBottom: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 11.5, color: "var(--ink-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>Admin-Secret</span>
          <input
            value={adminSecret}
            onChange={(e) => setAdminSecret(e.target.value)}
            type="password"
            placeholder="x-admin-secret / cron_secret"
            style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", font: "inherit" }}
          />
        </label>
        <div style={{ alignSelf: "end", fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5 }}>
          Die Schreibfunktion ist serverseitig per Shared Secret geschützt. Ohne Secret bleibt das Panel nur lesbar.
        </div>
      </div>

      <div className="card" style={{ background: "var(--nz-50)", boxShadow: "none", marginBottom: 14 }}>
        <div className="card-h" style={{ marginBottom: 10 }}>
          <div>
            <div className="card-t">Topic-Katalog</div>
            <div className="card-s">id, Label, Lean, Farbe</div>
          </div>
          <button className="btn" onClick={() => addRow("topic")}>Zeile hinzufügen</button>
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {topicDraft.map((row, index) => (
            <div key={`${row.id || "topic"}-${index}`} className="catalog-row">
              <input value={row.id} onChange={(e) => updateRow("topic", index, "id", e.target.value)} placeholder="id" style={editorInputStyle} />
              <input value={row.label} onChange={(e) => updateRow("topic", index, "label", e.target.value)} placeholder="Label" style={editorInputStyle} />
              <input value={row.lean} onChange={(e) => updateRow("topic", index, "lean", e.target.value)} placeholder="Lean" type="number" step="0.05" style={editorInputStyle} />
              <input value={row.color} onChange={(e) => updateRow("topic", index, "color", e.target.value)} placeholder="#0a6cd4" style={editorInputStyle} />
              <button className="btn" onClick={() => removeRow("topic", index)}>Entfernen</button>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ background: "var(--nz-50)", boxShadow: "none" }}>
        <div className="card-h" style={{ marginBottom: 10 }}>
          <div>
            <div className="card-t">Source-Katalog</div>
            <div className="card-s">id, Label, Priorität, Farbe</div>
          </div>
          <button className="btn" onClick={() => addRow("source")}>Zeile hinzufügen</button>
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {sourceDraft.map((row, index) => (
            <div key={`${row.id || "source"}-${index}`} className="catalog-row">
              <input value={row.id} onChange={(e) => updateRow("source", index, "id", e.target.value)} placeholder="id" style={editorInputStyle} />
              <input value={row.label} onChange={(e) => updateRow("source", index, "label", e.target.value)} placeholder="Label" style={editorInputStyle} />
              <input value={row.priority} onChange={(e) => updateRow("source", index, "priority", e.target.value)} placeholder="10" type="number" style={editorInputStyle} />
              <input value={row.color} onChange={(e) => updateRow("source", index, "color", e.target.value)} placeholder="#004b93" style={editorInputStyle} />
              <button className="btn" onClick={() => removeRow("source", index)}>Entfernen</button>
            </div>
          ))}
        </div>
      </div>

      {status && <div style={{ marginTop: 12, fontSize: 12.5, color: status.startsWith("Fehler") ? "var(--neg)" : "var(--pos)" }}>{status}</div>}
    </div>
  );
}

const editorInputStyle = {
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "9px 11px",
  font: "inherit",
  background: "#fff",
};

function Sources({ sourceHealth, appSettings, onSaveSettings }){
  const items = useMemo(() => resolveSourceCatalog(appSettings, sourceHealth), [appSettings, sourceHealth]);
  const [termStats, setTermStats] = useState([]);
  const [termStatsError, setTermStatsError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      if (!LIVE) {
        setTermStats([]);
        setTermStatsError("");
        return;
      }
      try {
        const rows = await loadYoutubeTermStats(16);
        if (!active) return;
        setTermStats(rows);
        setTermStatsError("");
      } catch (e) {
        if (!active) return;
        setTermStats([]);
        setTermStatsError(String(e?.message || e));
      }
    })();
    return () => { active = false; };
  }, [sourceHealth]);

  const badge = (item) => {
    if (!LIVE) return { t:"Demo-Daten", c:"var(--neu)", b:"var(--neu-bg)" };
    if (item.status === "review") return { t:"App-Review nötig", c:"var(--neg)", b:"var(--neg-bg)" };
    if ((item.volume ?? 0) > 0) return { t:"Aktiv ingestiert", c:"var(--pos)", b:"var(--pos-bg)" };
    if (item.lastSync) return { t:"Synchronisiert (0 Treffer)", c:"var(--neu)", b:"var(--neu-bg)" };
    return { t:"Nicht synchronisiert", c:"var(--ink-3)", b:"var(--line-2)" };
  };

  const fmtSync = (value) => {
    if (!value) return "Noch kein Sync";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "Noch kein Sync";
    return `Letzter Sync: ${d.toLocaleString("de-DE", { hour12: false })}`;
  };

  const classifyTerm = (row) => {
    if ((row.ewmaHits ?? 0) >= 0.8) return { label: "High Yield", color: "var(--pos)", bg: "var(--pos-bg)" };
    if ((row.ewmaHits ?? 0) >= 0.25) return { label: "Stable", color: "var(--neu)", bg: "var(--neu-bg)" };
    return { label: "Explore", color: "var(--ink-2)", bg: "var(--line-2)" };
  };

  return (
    <>
      {LIVE && (
        <div style={{marginBottom:24}}>
          <div style={{fontSize:13,fontWeight:600,color:"var(--ink-2)",marginBottom:12,textTransform:"uppercase",letterSpacing:"0.5px"}}>YouTube API Quota Monitoring</div>
          <YoutubeQuotaWidget />
        </div>
      )}
      {LIVE && (
        <div className="card" style={{marginBottom:20, background:"linear-gradient(180deg,#ffffff 0%, #f7faff 100%)"}}>
          <div className="card-h">
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span className="kpi-ico" style={{background:"#e7f0fb",color:"#0a6cd4"}}><TrendingUp size={16}/></span>
              <div>
                <div className="card-t">YouTube Keyword Performance</div>
                <div className="card-s">Adaptive Exploration/Exploitation aus realen Search-Hits</div>
              </div>
            </div>
            <span className="pill neu">Lernmodus aktiv</span>
          </div>
          {termStatsError ? (
            <div style={{fontSize:12.5,color:"var(--neg)",marginTop:6}}>Term-Statistiken konnten nicht geladen werden: {termStatsError}</div>
          ) : termStats.length === 0 ? (
            <div style={{fontSize:12.5,color:"var(--ink-2)",marginTop:6}}>Noch keine Term-Performance-Daten vorhanden. Nach dem nächsten Ingest-Lauf werden Kennzahlen angezeigt.</div>
          ) : (
            <>
              <div className="source-kpi-grid">
                <div style={{padding:"10px 12px",borderRadius:12,border:"1px solid var(--line)",background:"#fff"}}>
                  <div style={{fontSize:11,color:"var(--ink-3)",textTransform:"uppercase",letterSpacing:".05em"}}>Beobachtete Terms</div>
                  <div style={{fontSize:22,fontWeight:700,color:"var(--ink)"}}>{termStats.length}</div>
                </div>
                <div style={{padding:"10px 12px",borderRadius:12,border:"1px solid var(--line)",background:"#fff"}}>
                  <div style={{fontSize:11,color:"var(--ink-3)",textTransform:"uppercase",letterSpacing:".05em"}}>Top EWMA</div>
                  <div style={{fontSize:22,fontWeight:700,color:"var(--pos)"}}>{Math.max(...termStats.map((r) => r.ewmaHits ?? 0)).toFixed(2)}</div>
                </div>
                <div style={{padding:"10px 12px",borderRadius:12,border:"1px solid var(--line)",background:"#fff"}}>
                  <div style={{fontSize:11,color:"var(--ink-3)",textTransform:"uppercase",letterSpacing:".05em"}}>Gesamt-Hits</div>
                  <div style={{fontSize:22,fontWeight:700,color:"var(--ink)"}}>{termStats.reduce((sum, r) => sum + (r.totalHits ?? 0), 0)}</div>
                </div>
                <div style={{padding:"10px 12px",borderRadius:12,border:"1px solid var(--line)",background:"#fff"}}>
                  <div style={{fontSize:11,color:"var(--ink-3)",textTransform:"uppercase",letterSpacing:".05em"}}>Durchschn. EWMA</div>
                  <div style={{fontSize:22,fontWeight:700,color:"#0a6cd4"}}>{(termStats.reduce((sum, r) => sum + (r.ewmaHits ?? 0), 0) / Math.max(1, termStats.length)).toFixed(2)}</div>
                </div>
              </div>
              <div className="tbl-shell tbl-scroll">
              <table className="tbl tbl-min" style={{margin:0}}>
                <thead>
                  <tr>
                    <th>Keyword</th>
                    <th>Cluster</th>
                    <th>EWMA-Hits</th>
                    <th>Last Run</th>
                    <th>Total Hits</th>
                    <th>Läufe</th>
                  </tr>
                </thead>
                <tbody>
                  {termStats.map((row) => {
                    const badge = classifyTerm(row);
                    return (
                      <tr key={row.term}>
                        <td style={{fontWeight:600}}>{row.term}</td>
                        <td><span className="pill" style={{color:badge.color,background:badge.bg}}>{badge.label}</span></td>
                        <td>{Number(row.ewmaHits ?? 0).toFixed(3)}</td>
                        <td>{row.lastHits ?? 0}</td>
                        <td>{row.totalHits ?? 0}</td>
                        <td>{row.totalRuns ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
              <div style={{fontSize:12,color:"var(--ink-3)",marginTop:10}}>
                EWMA = exponentiell gewichteter Mittelwert der Search-Hits je Keyword (mehr Gewicht auf aktuelle Läufe).
              </div>
            </>
          )}
        </div>
      )}
      <p className="lede" style={{marginBottom:20}}>
        Alle Quellen sind über eine einheitliche Adapter-Schnittstelle angebunden. Ohne Backend liefert die App
        konsistente Demo-Daten; mit verbundenem Supabase-Backend werden die realen Endpunkte serverseitig
        abgefragt (API-Keys, OAuth, CORS) und aus Sicht von Nordzucker nach Geschäftsauswirkung, öffentlicher Stimmung und Thema klassifiziert.
      </p>
      <div className="grid source-grid" style={{marginBottom:16}}>
        {items.map(s=>{ const bd=badge(s); return (
          <div className="card" key={s.id}>
            <div className="card-h source-card-head">
              <div className="source-card-top">
                <span className="kpi-ico" style={{background:`${s.color}1a`,color:s.color}}><Plug size={16}/></span>
                <div><div className="card-t">{s.label}</div><div className="card-s">{s.auth}</div></div>
              </div>
              <span className="pill" style={{color:bd.c,background:bd.b}}>{bd.t}</span>
            </div>
            <p style={{fontSize:12.5,color:"var(--ink-2)",lineHeight:1.55,margin:"0 0 10px"}}>{s.note}</p>
            <div className="source-badges" style={{marginBottom:10}}>
              <span className="src-badge on" style={{background:`${s.color}1a`,color:s.color}}>Priorität: {s.priority ?? 999}</span>
              <span className={`src-badge ${(s.volume ?? 0) > 0 ? "on" : "off"}`}>30 Tage: {s.volume ?? 0} Erwähnungen</span>
              <span className="src-badge off">{fmtSync(s.lastSync)}</span>
            </div>
            <div className="mono-endpoint">
              <span style={{color:"var(--green)"}}>GET</span> {s.endpoint}
            </div>
          </div>
        );})}
      </div>
      <div className="card">
        <div className="card-h"><div style={{display:"flex",alignItems:"center",gap:10}}>
          <span className="kpi-ico" style={{background:"var(--violet-bg)",color:"var(--violet)"}}><Sparkles size={16}/></span>
          <div><div className="card-t">KI-Analyse-Schnittstelle</div><div className="card-s">{LIVE ? "ai-query Edge Function · RAG" : "LLM-API · im Backend"}</div></div>
        </div>{LIVE
          ? <span className="pill pos"><span className="dot live"/>Verbunden</span>
          : <span className="pill neu">Demo-Modus</span>}</div>
        <p style={{fontSize:12.5,color:"var(--ink-2)",lineHeight:1.55,margin:"0 0 10px"}}>
          Sentiment-Auswertung, Empfehlungen, Prognosen und der KI-Assistent laufen über die <code>ai-query</code> Edge Function:
          Die Frage wird embedded, relevante Mentions per pgvector geholt (RAG) und an Claude übergeben. Der Anthropic-Key bleibt serverseitig.
        </p>
        <div className="mono-endpoint">
          <span style={{color:"var(--green)"}}>POST</span> https://api.anthropic.com/v1/messages
        </div>
      </div>
      <div style={{marginTop:16}}>
        <SettingsAdmin appSettings={appSettings} sourceHealth={sourceHealth} onSaveSettings={onSaveSettings} />
      </div>
    </>
  );
}

/* =========================  BI CUBE  ========================= */
function BICube({ mentions }) {
  const [quarter, setQuarter] = useState("ALL");
  const [region, setRegion] = useState("ALL");
  const [product, setProduct] = useState("ALL");

  const quarters = useMemo(
    () => Array.from(new Set(mentions.map(m => m.quarter))).sort((a, b) => b.localeCompare(a)),
    [mentions],
  );
  const regions = useMemo(
    () => Array.from(new Set(mentions.map(m => m.region))).sort((a, b) => a.localeCompare(b)),
    [mentions],
  );
  const products = useMemo(
    () => Array.from(new Set(mentions.map(m => m.product))).sort((a, b) => a.localeCompare(b)),
    [mentions],
  );

  const cubeData = useMemo(() => {
    const comboMap = new Map();
    const productMap = new Map();
    const heatMap = new Map();
    let count = 0;
    let sentimentSum = 0;
    let pos = 0;

    for (const m of mentions) {
      if ((quarter !== "ALL" && m.quarter !== quarter) ||
        (region !== "ALL" && m.region !== region) ||
        (product !== "ALL" && m.product !== product)) {
        continue;
      }

      count += 1;
      sentimentSum += m.sentiment;
      if (m.sentiment > 0.15) pos += 1;

      const comboKey = `${m.quarter}|${m.region}|${m.product}`;
      const combo = comboMap.get(comboKey) ?? {
        quarter: m.quarter,
        region: m.region,
        product: m.product,
        vol: 0,
        sum: 0,
        pos: 0,
      };
      combo.vol += 1;
      combo.sum += m.sentiment;
      if (m.sentiment > 0.15) combo.pos += 1;
      comboMap.set(comboKey, combo);

      const prod = productMap.get(m.product) ?? { product: m.product, vol: 0, sum: 0 };
      prod.vol += 1;
      prod.sum += m.sentiment;
      productMap.set(m.product, prod);

      const heatKey = `${m.quarter}|${m.product}`;
      const heat = heatMap.get(heatKey) ?? { quarter: m.quarter, product: m.product, volume: 0 };
      heat.volume += 1;
      heatMap.set(heatKey, heat);
    }

    const cubeRows = Array.from(comboMap.values())
      .map((r) => ({
        quarter: r.quarter,
        region: r.region,
        product: r.product,
        volume: r.vol,
        net: Math.round(r.sum / r.vol * 100),
        positiveShare: Math.round(r.pos / r.vol * 100),
      }))
      .sort((a, b) => b.volume - a.volume);

    const topProducts = Array.from(productMap.values())
      .map((r) => ({ product: r.product, vol: r.vol, net: Math.round(r.sum / r.vol * 100) }))
      .sort((a, b) => b.vol - a.vol)
      .slice(0, 7);

    const heatCells = Array.from(heatMap.values())
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 9);
    const maxHeat = Math.max(...heatCells.map((h) => h.volume), 1);

    return {
      count,
      net: count ? Math.round(sentimentSum / count * 100) : 0,
      posShare: count ? Math.round(pos / count * 100) : 0,
      combinations: cubeRows.length,
      cubeRows,
      topProducts,
      heatCells,
      maxHeat,
    };
  }, [mentions, quarter, region, product]);

  return (
    <>
      <p className="lede" style={{ marginBottom: 20 }}>
        BI-Cube für explorative Analysen über Quartal, Region und Produktkategorie. Die Orts- und Produktdimensionen
        werden aktuell aus Textsignalen abgeleitet und sollten für wissenschaftliche Auswertungen als heuristische
        Klassifikation dokumentiert werden.
      </p>

      <div className="cube-hero">
        <div className="cube-chip" style={{animationDelay:"40ms"}}>
          <div className="k">Aktueller Schnitt</div>
          <div className="v">{quarter === "ALL" ? "Alle Quartale" : quarter}</div>
          <div className="m">{region === "ALL" ? "alle Regionen" : region}</div>
        </div>
        <div className="cube-chip" style={{animationDelay:"90ms"}}>
          <div className="k">Produktfokus</div>
          <div className="v">{product === "ALL" ? "Alle Produkte" : product}</div>
          <div className="m">{cubeData.combinations} aktive Kombinationen</div>
        </div>
        <div className="cube-chip" style={{animationDelay:"140ms"}}>
          <div className="k">Datenpunkte</div>
          <div className="v">{cubeData.count.toLocaleString("de-DE")}</div>
          <div className="m">für diesen Cube-Slice</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h">
          <div>
            <div className="card-t">Cube-Filter</div>
            <div className="card-s">Dimensionen: Quartal, Region, Produkt</div>
          </div>
        </div>
        <div className="filters-grid">
          <select className="btn" value={quarter} onChange={e => setQuarter(e.target.value)}>
            <option value="ALL">Alle Quartale</option>
            {quarters.map(q => <option key={q} value={q}>{q}</option>)}
          </select>
          <select className="btn" value={region} onChange={e => setRegion(e.target.value)}>
            <option value="ALL">Alle Regionen</option>
            {regions.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select className="btn" value={product} onChange={e => setProduct(e.target.value)}>
            <option value="ALL">Alle Produkte</option>
            {products.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      <div className="grid g-3" style={{ marginBottom: 16 }}>
        <div className="card kpi">
          <div className="lab"><Activity size={14} /> Geschäftsauswirkung (gefiltert)
            <InfoHint title="Geschäftsauswirkung (gefiltert)" text="Impact nur für den aktuell gesetzten Cube-Slice. Damit lassen sich regionale oder produktspezifische Chancen und Risiken gezielt isolieren." />
          </div>
          <div className="val" style={{ color: sentColor(cubeData.net / 100) }}>{cubeData.net > 0 ? "+" : ""}{cubeData.net}</div>
        </div>
        <div className="card kpi">
          <div className="lab"><MessageSquare size={14} /> Beobachtungen
            <InfoHint title="Beobachtungen" text="Anzahl Datensätze im aktiven Filter. Bei kleinem Volumen sind Aussagen eher indikativ; bei großem Volumen deutlich belastbarer." />
          </div>
          <div className="val">{cubeData.count.toLocaleString("de-DE")}</div>
        </div>
        <div className="card kpi">
          <div className="lab"><CheckCircle2 size={14} /> Geschäftlich positiv
            <InfoHint title="Geschäftlich positiv (Cube)" text="Prozent positiver Impacts im gefilterten Ausschnitt. Ein hoher Wert bei kleinem Datenvolumen sollte immer gegen mehrere Filterkombinationen gegengeprüft werden." />
          </div>
          <div className="val">{cubeData.posShare}%</div>
        </div>
      </div>

      <div className="grid g-split-12-1" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-h"><div><div style={{display:"flex",alignItems:"center",gap:6}}><div className="card-t">Cube-Ansicht (Top-Kombinationen)</div>
            <InfoHint title="Cube-Ansicht" text="Zeigt die stärksten Kombinationen aus Quartal, Region und Produkt. Nutze sie, um Hotspots mit hohem Volumen und gleichzeitig negativem Netto-Wert schnell zu priorisieren." />
          </div><div className="card-s">Quartal × Region × Produkt</div></div></div>
          <div className="tbl-shell tbl-scroll">
          <table className="tbl tbl-wide">
            <thead>
              <tr><th>Quartal</th><th>Region</th><th>Produkt</th><th>Volumen</th><th>Netto</th><th>Positiv</th></tr>
            </thead>
            <tbody>
              {cubeData.cubeRows.slice(0, 20).map((r, i) => (
                <tr key={`${r.quarter}-${r.region}-${r.product}-${i}`}>
                  <td>{r.quarter}</td>
                  <td>{r.region}</td>
                  <td>{r.product}</td>
                  <td>{r.volume}</td>
                  <td style={{ color: sentColor(r.net / 100), fontWeight: 600 }}>{r.net > 0 ? "+" : ""}{r.net}</td>
                  <td>{r.positiveShare}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>

        <div className="card">
          <div className="card-h"><div><div style={{display:"flex",alignItems:"center",gap:6}}><div className="card-t">Top Produktkategorien</div>
            <InfoHint title="Top Produktkategorien" text="Balken zeigen Volumen je Produktkategorie. Für Business-Entscheidungen immer zusammen mit Impact-Wert aus Tabelle/Cube lesen, nicht nur nach Menge priorisieren." />
          </div><div className="card-s">Volumen + Sentiment</div></div></div>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={cubeData.topProducts} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f8" vertical={false} />
              <XAxis dataKey="product" tick={{ fontSize: 10, fill: "#8694a8" }} axisLine={false} tickLine={false} interval={0} angle={-18} textAnchor="end" height={56} />
              <YAxis tick={{ fontSize: 11, fill: "#8694a8" }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="vol" name="Volumen" fill="#0a6cd4" radius={[6, 6, 0, 0]} isAnimationActive animationDuration={420} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <div className="card-h"><div><div style={{display:"flex",alignItems:"center",gap:6}}><div className="card-t">Heatmap-Snapshot</div>
          <InfoHint title="Heatmap-Snapshot" text="Schneller Blick auf volumenstarke Zellen. Eine hohe Balkenfüllung bedeutet viele Erwähnungen, nicht automatisch positiven Impact." />
        </div><div className="card-s">Stärkste Quartal × Produkt-Zellen</div></div></div>
        <div className="cube-heat">
          {cubeData.heatCells.map((cell, idx) => (
            <div className="cube-cell" key={`${cell.quarter}-${cell.product}`} style={{animationDelay:`${40 + idx * 35}ms`}}>
              <div className="l">{cell.quarter}</div>
              <div className="n">{cell.product}</div>
              <div className="m">{cell.volume} Erwähnungen</div>
              <div className="f"><span style={{width:`${Math.round(cell.volume / cubeData.maxHeat * 100)}%`}}/></div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* =========================  ROOT APP  ========================= */
const NAV = [
  { id:"dashboard", label:"Dashboard", icon:LayoutDashboard, sec:"Übersicht" },
  { id:"trends",    label:"Trends & Risiken", icon:TrendingUp, sec:"Übersicht" },
  { id:"bi",        label:"BI Cube", icon:FileText, sec:"Übersicht" },
  { id:"recs",      label:"Empfehlungen & Prognosen", icon:Lightbulb, sec:"Analyse" },
  { id:"chat",      label:"KI-Assistent", icon:MessageSquare, sec:"Analyse" },
  { id:"sources",   label:"Datenquellen", icon:Database, sec:"System" },
];
const TITLES = {
  dashboard:["Übersicht","Stimmungs-Dashboard"], trends:["Übersicht","Trends & Risiken"],
  bi:["Übersicht","BI Cube & Dimensionen"],
  recs:["Analyse","Empfehlungen & Prognosen"],
  chat:["Analyse","KI-Assistent"], sources:["System","Datenquellen & Schnittstellen"],
};

export default function App(){
  const CACHE_KEY = "scf_mentions_cache_v1";
  const CACHE_TTL_MS = 5 * 60 * 1000;
  const [view, setView] = useState("dashboard");
  const [range, setRange] = useState(7);
  const [open, setOpen] = useState(false);
  const [mentions, setMentions] = useState([]);
  const [sourceHealth, setSourceHealth] = useState([]);
  const [appSettings, setAppSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [sec, title] = TITLES[view];

  useEffect(()=>{ (async()=>{
    setLoading(true);
    setLoadError("");
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached){
        try {
          const parsed = JSON.parse(cached);
          if (parsed?.ts && Array.isArray(parsed?.mentions) && (Date.now() - parsed.ts) < CACHE_TTL_MS){
            const fastMentions = parsed.mentions.map((m) => {
              const d = new Date(m.date);
              return { ...m, date: d, ts: d.getTime() };
            });
            setMentions(fastMentions);
            setLoading(false);
          }
        } catch {
          // ignore invalid cache
        }
      }

      // Schneller Start: 30 Tage reichen für alle aktuellen Dashboard-Filter.
      const [data, sourceStatus, settings] = await Promise.all([
        loadMentions(30),
        loadSourceHealth(30).catch(() => []),
        loadAppSettings().catch(() => ({})),
      ]);
      setMentions(data);
      setSourceHealth(sourceStatus);
      setAppSettings(settings);
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), mentions: data }));
    } catch (e) {
      console.error("Daten konnten nicht geladen werden:", e);
      setLoadError(String(e?.message || e));
    } finally { setLoading(false); }
  })(); }, []);

  const topicCatalog = useMemo(
    () => resolveTopicCatalog(appSettings, mentions),
    [appSettings, mentions],
  );
  const agg = useMemo(
    () => (mentions.length ? aggregate(mentions, range, topicCatalog) : null),
    [mentions, range, topicCatalog],
  );
  const liveSignals = useMemo(
    () => deriveSignals(mentions, range, appSettings, topicCatalog),
    [mentions, range, appSettings, topicCatalog],
  );
  const biMentions = useMemo(() => mentions.map(enrichMentionForBI), [mentions]);
  const activeSourceLabel = useMemo(() => {
    if (!LIVE) return "Demo-Daten aktiv";
    const activeIds = sourceHealth.filter((s) => (s.volume ?? 0) > 0).map((s) => s.id);
    if (!activeIds.length) return "Keine aktiven Quellen";
    const labelById = Object.fromEntries(SOURCE_INFO.map((s) => [s.id, s.label.replace(/ API.*$/, "")]));
    return activeIds.map((id) => labelById[id] ?? id).join(" · ");
  }, [sourceHealth]);
  const hasLiveSources = useMemo(() => sourceHealth.some((s) => (s.volume ?? 0) > 0), [sourceHealth]);

  const handleSaveSettings = async (entries, adminSecret) => {
    const result = await saveAppSettings(entries, adminSecret);
    if (result?.settings) {
      setAppSettings((current) => {
        const next = { ...current };
        for (const row of result.settings) next[row.key] = row.value;
        return next;
      });
    }
    return result;
  };

  const dataSummary = useMemo(()=>{
    if (!agg) return "";
    const topics = agg.byTopic.slice(0,6).map(t=>`${t.label}: Impact ${t.net>0?"+":""}${t.net} (${t.vol} Erw.)`).join("; ");
    const signalTxt = liveSignals.length
      ? liveSignals.map((s, i) => `(${i + 1}) ${s.title}`).join("; ")
      : "keine belastbaren Signale im aktuellen Fenster";
    return `Zeitraum: letzte ${range} Tage.
Öffentliche Stimmung gesamt: ${agg.curPublicNet} (Δ ${agg.publicNetDelta} ggü. Vorperiode).
Geschäftsauswirkung für Nordzucker: ${agg.curNet} (Δ ${agg.netDelta} ggü. Vorperiode).
Erwähnungen: ${agg.curVol} (Δ ${agg.volDelta}%). Geschäftlich positiver Anteil: ${agg.posShare}%.
Geschäftsauswirkung nach Thema: ${topics}.
Aktive Signale: ${signalTxt}.`;
  }, [agg, range, liveSignals]);

  const exportReport = useMemo(
    () => buildExportReport({ agg, liveSignals, range, title, view }),
    [agg, liveSignals, range, title, view],
  );

  const exportCSV = () => {
    if (!agg || !exportReport) return;
    let rows = [];
    let fileName = `nordzucker_mentions_${range}t.csv`;
    if (view==="bi"){
      rows = biMentions.map(m=>(
        { Datum:m.date.toISOString().slice(0,10), Quartal:m.quarter, Region:m.region, Produkt:m.product,
          Quelle:m.source, Thema:m.topicLabel, BusinessImpact:m.sentiment, BusinessLabel:m.sentimentLabel,
          PublicSentiment:m.publicSentiment, PublicLabel:m.publicSentimentLabel, ImpactReason:m.impactReason, Text:m.text }
      ));
      fileName = "nordzucker_bi_cube.csv";
    } else {
      rows = agg.cur.map(m=>({ Datum:m.date.toISOString().slice(0,10), Quelle:m.source, Autor:m.author,
        Thema:m.topicLabel, BusinessImpact:m.sentiment, BusinessLabel:m.sentimentLabel,
        PublicSentiment:m.publicSentiment, PublicLabel:m.publicSentimentLabel, ImpactReason:m.impactReason, Text:m.text }));
    }

    const table = tableFromObjects(rows);
    const csv = toCSVSectioned([
      {
        title: "Executive Status",
        header: ["Ampel", "Bewertung", "Einordnung"],
        rows: [[exportReport.status.tone, exportReport.status.label, exportReport.status.detail]],
      },
      {
        title: "Nordzucker Reporting Summary",
        header: ["Kennzahl", "Wert"],
        rows: exportReport.summaryRows,
      },
      {
        title: "Handlungsempfehlungen",
        header: ["Score", "Prioritaet", "Owner", "Zeithorizont", "Empfehlung", "Begruendung", "Erfolgskriterium"],
        rows: exportReport.recommendations.map((item) => [item.score, item.priority, item.owner, item.horizon, item.action, item.reason, item.successKpi]),
      },
      {
        title: "30-60-90 Tage Plan",
        header: ["Horizont", "Ziel", "Owner", "Massnahmen"],
        rows: exportReport.actionPlan.map((item) => [item.horizon, item.objective, item.owner, item.actions]),
      },
      {
        title: "Datentabelle",
        header: table.header,
        rows: table.body,
      },
    ]);
    dlBlob(fileName, csv, "text/csv;charset=utf-8;");
  };
  const exportPDF = () => window.print();
  return (
    <div className="scf">
      <style>{STYLE}</style>

      {/* sidebar */}
      <aside className={`side no-print ${open?"open":""}`}>
        <div className="brand">
          <svg width="30" height="30" viewBox="0 0 32 32" fill="none">
            <path d="M4 22 L14 8" stroke="#6cbf4b" strokeWidth="3.4" strokeLinecap="round"/>
            <path d="M9 24 L19 10" stroke="#3aa0e0" strokeWidth="3.4" strokeLinecap="round"/>
            <path d="M14 26 L24 12" stroke="#0a6cd4" strokeWidth="3.4" strokeLinecap="round"/>
          </svg>
          <div><div className="wm">Nordzucker</div><div className="sub">Smart Customer Feedback</div></div>
        </div>
        <nav className="nav">
          {["Übersicht","Analyse","System"].map(group=>(
            <React.Fragment key={group}>
              <div className="nav-sec">{group}</div>
              {NAV.filter(n=>n.sec===group).map(n=>(
                <div key={n.id} className={`nav-item ${view===n.id?"on":""}`}
                  onClick={()=>{ setView(n.id); setOpen(false); }}>
                  <n.icon size={17} className="ico"/>{n.label}
                </div>
              ))}
            </React.Fragment>
          ))}
        </nav>
        <div className="side-foot">
          <div className="src-row"><span className={`dot ${LIVE && hasLiveSources?"live":"idle"}`}/>{activeSourceLabel}</div>
          <div className="src-row"><span className="dot idle"/>Instagram (Review)</div>
          <div className="src-row"><span className={`dot ${LIVE?"live":"idle"}`}/>{LIVE ? "KI-Analyse verbunden" : "KI-Backend offline"}</div>
        </div>
      </aside>
      {open && <div className="no-print" onClick={()=>setOpen(false)}
        style={{position:"fixed",inset:0,background:"rgba(0,0,0,.35)",zIndex:40}}/>}

      {/* main */}
      <div className="main">
        <header className="topbar no-print">
          <button className="menu-btn" onClick={()=>setOpen(o=>!o)}>{open?<X size={18}/>:<Menu size={18}/>}</button>
          <div><div className="crumb">{sec}</div><h1>{title}</h1></div>
          <div className="spacer"/>
          {(view==="dashboard"||view==="trends") && (
            <div className="range">
              {[7,14,30,90].map(r=>(<button key={r} className={range===r?"on":""} onClick={()=>setRange(r)}>{r} Tage</button>))}
            </div>
          )}
          {view!=="chat" && view!=="sources" && (
            <>
              <button className="btn" onClick={exportCSV}><FileText size={14}/> CSV</button>
              <button className="btn" onClick={exportPDF}><Download size={14}/> PDF</button>
            </>
          )}
        </header>

        <main className="content">
          {exportReport && (
            <div className="print-cover">
              <div className="print-cover-h">
                <div>
                  <h2>Executive Report</h2>
                  <div className="meta">Nordzucker Smart Customer Feedback · {title}</div>
                </div>
                <div className="meta">Erstellt am {exportReport.generatedAt} · Zeitraum letzte {range} Tage</div>
              </div>
              <div className="print-cover-grid">
                <div className="print-status">
                  <div className="lab">Ampelstatus</div>
                  <div className={`val ${exportReport.status.tone}`}>{exportReport.status.label}</div>
                  <div className="desc">{exportReport.status.detail}</div>
                </div>
                <div className="print-snapshot">
                  <h3>Management Snapshot</h3>
                  <ul>
                    <li>Business Impact: {signed(agg.curNet)} (Delta {signed(agg.netDelta)})</li>
                    <li>Public Sentiment: {signed(agg.curPublicNet)} (Delta {signed(agg.publicNetDelta)})</li>
                    <li>Erwaehnungen: {agg.curVol} (Delta {signed(agg.volDelta)}%)</li>
                    <li>Positiver Business-Anteil: {agg.posShare}%</li>
                  </ul>
                </div>
              </div>
              <div className="print-plan">
                <h3>30-60-90 Tage Aktionsplan</h3>
                <table className="print-plan-table">
                  <thead><tr><th style={{width:"16%"}}>Horizont</th><th style={{width:"24%"}}>Ziel</th><th style={{width:"20%"}}>Owner</th><th>Massnahmen</th></tr></thead>
                  <tbody>
                    {exportReport.actionPlan.map((item) => (
                      <tr key={item.horizon}>
                        <td style={{fontWeight:700}}>{item.horizon}</td>
                        <td>{item.objective}</td>
                        <td>{item.owner}</td>
                        <td>{item.actions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* print-only report header */}
          <div className="report-head">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
              <div><div style={{fontFamily:"Space Grotesk",fontWeight:700,fontSize:20,color:"var(--nz-700)"}}>Nordzucker · Smart Customer Feedback</div>
                <div style={{fontSize:13,color:"var(--ink-2)"}}>{title} — letzte {range} Tage</div></div>
              <div style={{fontSize:12,color:"var(--ink-3)"}}>Erstellt {NOW.toLocaleDateString("de-DE")}</div>
            </div>
          </div>
          {exportReport && (
            <div className="print-report">
              <div className="print-grid">
                <div className="print-kpi"><div className="k">Business Impact</div><div className="v">{signed(agg.curNet)}</div></div>
                <div className="print-kpi"><div className="k">Public Sentiment</div><div className="v">{signed(agg.curPublicNet)}</div></div>
                <div className="print-kpi"><div className="k">Erwaehnungen</div><div className="v">{agg.curVol}</div></div>
                <div className="print-kpi"><div className="k">Positiver Anteil</div><div className="v">{agg.posShare}%</div></div>
              </div>
              <div className="print-panel" style={{marginBottom:10}}>
                <h3>Executive Summary</h3>
                <table className="print-table">
                  <tbody>
                    {exportReport.summaryRows.map(([key, value]) => (
                      <tr key={key}><td style={{width:"34%",fontWeight:600}}>{key}</td><td>{value}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="print-panel">
                <h3>Handlungsempfehlungen</h3>
                <table className="print-table">
                  <thead><tr><th style={{width:"9%"}}>Score</th><th style={{width:"11%"}}>Prioritaet</th><th style={{width:"16%"}}>Owner</th><th style={{width:"12%"}}>Horizont</th><th style={{width:"22%"}}>Massnahme</th><th>Begruendung / KPI</th></tr></thead>
                  <tbody>
                    {exportReport.recommendations.map((item, idx) => (
                      <tr key={`${item.action}-${idx}`}>
                        <td><span className="print-score">{item.score}</span></td>
                        <td><span className={`print-prio ${item.priority === "Hoch" ? "high" : "mid"}`}>{item.priority}</span></td>
                        <td>{item.owner}</td>
                        <td>{item.horizon}</td>
                        <td style={{fontWeight:600}}>{item.action}</td>
                        <td>
                          <div>{item.reason}</div>
                          <div style={{marginTop:4,fontSize:10.5,color:"#415775"}}>KPI: {item.successKpi}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {loading ? (
            <div className="card"><div className="empty"><Loader2 size={26} className="spin" style={{color:"var(--nz-500)"}}/>
              <div>Daten werden aus den Quellen aggregiert…</div></div></div>
          ) : loadError ? (
            <div className="card"><div className="empty">
              <AlertTriangle size={28} style={{color:"var(--neg)"}}/>
              <div style={{fontWeight:600,color:"var(--ink)"}}>Daten konnten nicht geladen werden</div>
              <div style={{maxWidth:560,fontSize:12.5}}>{loadError}</div>
              <div style={{maxWidth:560,fontSize:12.5,color:"var(--ink-2)"}}>
                Hinweis: Wenn Supabase aktiv ist, braucht das Dashboard Leserechte auf den Tabellen für den verwendeten API-Key.
              </div>
            </div></div>
          ) : !agg ? (
            <div className="card"><div className="empty">
              <Database size={28} style={{color:"var(--nz-500)"}}/>
              <div style={{fontWeight:600,color:"var(--ink)"}}>Noch keine Daten im gewählten Zeitraum</div>
              <div style={{maxWidth:560,fontSize:12.5,color:"var(--ink-2)"}}>
                Es wurden aktuell keine Erwähnungen geladen. Starte einen Ingest-Lauf oder erweitere den Zeitraum.
              </div>
            </div></div>
          ) : (
            <>
              {view==="dashboard" && <Dashboard agg={agg} range={range} signals={liveSignals}/>}
              {view==="trends"    && <Trends mentions={mentions} range={range} signals={liveSignals} appSettings={appSettings} topicCatalog={topicCatalog}/>}
              {view==="bi"        && <BICube mentions={biMentions}/>}
              {view==="recs"      && <Recommendations dataSummary={dataSummary}/>}
              {view==="chat"      && <Assistant dataSummary={dataSummary}/>}
              {view==="sources"   && <Sources sourceHealth={sourceHealth} appSettings={appSettings} onSaveSettings={handleSaveSettings}/>} 
            </>
          )}
        </main>
      </div>
    </div>
  );
}
