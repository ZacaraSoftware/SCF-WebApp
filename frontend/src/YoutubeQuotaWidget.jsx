import React, { useEffect, useState } from "react";
import { loadYoutubeQuotaToday } from "./data";

export const YoutubeQuotaWidget = () => {
  const [quotaData, setQuotaData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchQuotaData = async () => {
      try {
        const today = new Date().toISOString().split("T")[0];
        const todayData = await loadYoutubeQuotaToday().catch(() => null);

        if (todayData) {
          setQuotaData(todayData);
        } else {
          // No data for today yet, set default
          setQuotaData({
            date: today,
            quota_available: 10000,
            quota_consumed: 0,
            quota_remaining: 10000,
            utilization_percent: 0,
            ingest_runs_completed: 0,
            videos_collected: 0,
            comments_collected: 0,
          });
        }

      } catch (e) {
        console.warn("Failed to fetch quota data:", e);
      } finally {
        setLoading(false);
      }
    };

    fetchQuotaData();
    // Refresh every 60 seconds
    const interval = setInterval(fetchQuotaData, 60000);
    return () => clearInterval(interval);
  }, []);

  if (loading || !quotaData) {
    return <div style={{ color: "var(--ink-3)", fontSize: 12.5 }}>Lade Quota-Daten...</div>;
  }

  const utilization = quotaData.utilization_percent || 0;
  const remaining = quotaData.quota_remaining || 10000;
  const isLow = remaining < 3000;
  const isCritical = remaining < 1000;
  const tone = isCritical
    ? { border: "#e0574a", bg: "#fcebe9", fg: "#aa2f25", accent: "#e0574a" }
    : isLow
    ? { border: "#e1a53a", bg: "#fcf3e2", fg: "#9b6f1e", accent: "#e1a53a" }
    : { border: "#16a37b", bg: "#e6f6f0", fg: "#0f7a5e", accent: "#16a37b" };

  const statusText = isCritical
    ? "Kritisch: weniger als 1.000 Units verfügbar, der nächste Lauf reduziert automatisch die Tiefe."
    : isLow
    ? "Reduziert: weniger als 3.000 Units verfügbar, die Sammlung wird vorsichtiger gefahren."
    : "Optimal: volle Sammlung aktiv, genug Budget für breite YouTube-Abdeckung.";

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="card" style={{ border: `1px solid ${tone.border}`, background: tone.bg, boxShadow: "none" }}>
        <div className="card-h" style={{ marginBottom: 10 }}>
          <div>
            <div className="card-t">YouTube API Quota</div>
            <div className="card-s">Heute: {quotaData.date}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: tone.fg, lineHeight: 1 }}>
              {remaining.toLocaleString()}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink-2)" }}>von 10.000 verfügbar</div>
          </div>
        </div>

        <div style={{ marginBottom: 8 }}>
          <div style={{ width: "100%", background: "#dbe3ee", borderRadius: 999, height: 10, overflow: "hidden" }}>
            <div
              style={{
                width: `${Math.min(utilization, 100)}%`,
                height: "100%",
                background: `linear-gradient(90deg, ${tone.accent}, ${tone.border})`,
                transition: "width .3s ease",
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12, color: "var(--ink-2)" }}>
            <span>{quotaData.quota_consumed.toLocaleString()} verbraucht</span>
            <span>{utilization.toFixed(1)}% genutzt</span>
          </div>
        </div>

        <div style={{
          marginTop: 10,
          borderTop: "1px solid rgba(13,27,46,.12)",
          paddingTop: 10,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 8,
        }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: "var(--ink)" }}>{quotaData.ingest_runs_completed || 0}</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-2)" }}>Ingest-Läufe</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: "var(--ink)" }}>{quotaData.videos_collected || 0}</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-2)" }}>Videos</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: "var(--ink)" }}>{quotaData.comments_collected || 0}</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-2)" }}>Kommentare</div>
          </div>
        </div>

        <div style={{
          marginTop: 10,
          borderRadius: 10,
          padding: "8px 10px",
          fontSize: 12,
          color: tone.fg,
          background: "rgba(255,255,255,.62)",
          border: `1px solid ${tone.border}55`,
        }}>
          {statusText}
        </div>
      </div>

    </div>
  );
};

