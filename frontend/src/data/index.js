// Schaltet automatisch zwischen Demo-Daten und Supabase-Backend um.
// Live-Modus aktiv, sobald VITE_SUPABASE_URL gesetzt ist.
import { mockMentions, SOURCE_INFO } from "./mock";

const HAS_LIVE_CONFIG = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
let backendReachable = HAS_LIVE_CONFIG;
const backendStatusListeners = new Set();

export const LIVE = HAS_LIVE_CONFIG;
export { SOURCES, TOPICS, ANCHOR, DAYMS, SOURCE_INFO } from "./mock";

export class BackendOffline extends Error {
  constructor(){ super("BACKEND_OFFLINE"); this.name = "BackendOffline"; }
}

function isConnectivityError(error) {
  const msg = String(error?.message ?? error ?? "").toLowerCase();
  return (
    msg.includes("failed to fetch")
    || msg.includes("networkerror")
    || msg.includes("network request failed")
    || msg.includes("err_name_not_resolved")
    || msg.includes("load failed")
  );
}

function emitBackendStatus() {
  const current = isBackendLive();
  backendStatusListeners.forEach((listener) => {
    try { listener(current); } catch {
      // Listener-Fehler sollen die Datenabfrage nicht unterbrechen.
    }
  });
}

function setBackendReachable(next) {
  if (backendReachable === next) return;
  backendReachable = next;
  emitBackendStatus();
}

async function withLiveFallback(runLive, fallbackFactory) {
  if (!HAS_LIVE_CONFIG) return fallbackFactory();
  try {
    const value = await runLive();
    setBackendReachable(true);
    return value;
  } catch (error) {
    if (isConnectivityError(error)) {
      setBackendReachable(false);
      return fallbackFactory();
    }
    setBackendReachable(true);
    throw error;
  }
}

async function runLiveOnly(runLive) {
  if (!HAS_LIVE_CONFIG) throw new BackendOffline();
  try {
    const value = await runLive();
    setBackendReachable(true);
    return value;
  } catch (error) {
    if (isConnectivityError(error)) {
      setBackendReachable(false);
      throw new BackendOffline();
    }
    throw error;
  }
}

export function isBackendLive() {
  return HAS_LIVE_CONFIG && backendReachable;
}

export function subscribeBackendLive(listener) {
  backendStatusListeners.add(listener);
  listener(isBackendLive());
  return () => backendStatusListeners.delete(listener);
}

export async function loadMentions(range = 90){
  return withLiveFallback(async () => {
    const { supabaseMentions } = await import("./supabase");
    return supabaseMentions(range);
  }, () => mockMentions());
}

export async function loadSourceHealth(range = 90){
  return withLiveFallback(async () => {
    const { supabaseSourceHealth } = await import("./supabase");
    return supabaseSourceHealth(range);
  }, () => {
    return SOURCE_INFO.map((s) => ({
      id: s.id,
      label: s.label,
      status: s.status,
      lastSync: null,
      volume: 0,
    }));
  });
}

export async function loadAppSettings(){
  return withLiveFallback(async () => {
    const { supabaseAppSettings } = await import("./supabase");
    return supabaseAppSettings();
  }, () => ({}));
}

export async function loadYoutubeTermStats(limit = 20){
  return withLiveFallback(async () => {
    const { supabaseYoutubeTermStats } = await import("./supabase");
    return supabaseYoutubeTermStats(limit);
  }, () => []);
}

export async function loadYoutubeQuotaToday(){
  return withLiveFallback(async () => {
    const { supabaseYoutubeQuotaToday } = await import("./supabase");
    return supabaseYoutubeQuotaToday();
  }, () => null);
}

export async function loadYoutubeQuotaHistory(days = 7){
  return withLiveFallback(async () => {
    const { supabaseYoutubeQuotaHistory } = await import("./supabase");
    return supabaseYoutubeQuotaHistory(days);
  }, () => []);
}

export async function saveAppSettings(entries, adminSecret){
  return runLiveOnly(async () => {
    const { supabaseSaveAppSettings } = await import("./supabase");
    return supabaseSaveAppSettings(entries, adminSecret);
  });
}

export async function aiChat(payload){
  return runLiveOnly(async () => {
    const { ragChat } = await import("./supabase");
    return ragChat(payload);
  });
}

export async function aiConversationHistory(sessionId, limit = 20){
  return runLiveOnly(async () => {
    const { ragConversationHistory } = await import("./supabase");
    return ragConversationHistory(sessionId, limit);
  });
}

export async function aiConversationMessages(sessionId, conversationId, limit = 120){
  return runLiveOnly(async () => {
    const { ragConversationMessages } = await import("./supabase");
    return ragConversationMessages(sessionId, conversationId, limit);
  });
}

export async function aiRecommendations(summary, effort){
  return runLiveOnly(async () => {
    const { ragRecommendations } = await import("./supabase");
    return ragRecommendations(summary, undefined, effort);
  });
}
