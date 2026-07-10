// Deterministische Demo-Daten — identisch zum ursprünglichen Prototyp.
// Wird genutzt, solange kein Supabase-Backend konfiguriert ist.

export const DAYMS = 86400000;
export const ANCHOR = new Date("2026-06-11T12:00:00");

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);
  t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

export const SOURCES = [
  { id: "reddit",    label: "Reddit",    weight: 0.30 },
  { id: "youtube",   label: "YouTube",   weight: 0.26 },
  { id: "news",      label: "News",      weight: 0.20 },
  { id: "twitter",   label: "X",         weight: 0.16 },
  { id: "instagram", label: "Instagram", weight: 0.08 },
];

export const TOPICS = [
  { id: "zuckersteuer", label: "Zuckersteuer / Politik", lean: -0.45 },
  { id: "zuckerfrei",   label: "Zuckerfrei / Diät",      lean: -0.10 },
  { id: "softdrinks",   label: "Softdrinks / Cola",      lean: -0.20 },
  { id: "suesswaren",   label: "Süßwaren / Snacks",      lean:  0.25 },
  { id: "backen",       label: "Backen / Haushalt",      lean:  0.40 },
  { id: "gesundheit",   label: "Gesundheit / Diabetes",  lean: -0.35 },
  { id: "saisonal",     label: "Saisonal / Sommer",      lean:  0.55 },
  { id: "preise",       label: "Preise / Inflation",     lean: -0.25 },
  { id: "nachhaltig",   label: "Nachhaltigkeit",         lean:  0.30 },
];

const SNIPPETS = {
  zuckersteuer: ["Eine Zuckersteuer wäre überfällig, Großbritannien zeigt wie es geht.","Warum zahlt am Ende immer der Verbraucher für die Zuckersteuer?","Steuer auf Zucker bringt nichts, Eigenverantwortung zählt."],
  zuckerfrei:   ["Seit dem Zuckerverzicht fühle ich mich deutlich fitter.","Zuckerfreie Alternativen schmecken einfach nicht gleich.","30 Tage ohne Zucker — mein Erfahrungsbericht."],
  softdrinks:   ["Selbst Stars stellen jetzt die Cola demonstrativ zur Seite.","Light-Cola ist auch nicht gesünder, nur weniger Zucker.","Der Zuckergehalt in Softdrinks ist einfach absurd hoch."],
  suesswaren:   ["Diese Schokolade mit weniger Zucker ist überraschend gut.","Naschen gehört für mich zum Feierabend dazu.","Neue Snack-Linie setzt auf reduzierten Zuckeranteil."],
  backen:       ["Ohne ordentlich Zucker schmeckt der Kuchen einfach nicht.","Haushaltszucker bleibt beim Backen unersetzlich.","Endlich wieder Plätzchen-Saison, Zucker raus!"],
  gesundheit:   ["Zu viel Zucker treibt das Diabetes-Risiko nach oben.","Ärzte warnen erneut vor verstecktem Zucker in Fertigprodukten.","Mein Arzt sagt, ich soll den Zucker drastisch reduzieren."],
  saisonal:     ["Sommer heißt Cocktails — und die brauchen Zuckersirup!","Selbstgemachtes Eis mit ordentlich Zucker, herrlich.","Limonaden-Saison ist eröffnet, der Zucker fließt."],
  preise:       ["Die Zuckerpreise im Supermarkt sind echt explodiert.","Inflation trifft jetzt auch das Backregal hart.","Warum kostet Zucker plötzlich fast das Doppelte?"],
  nachhaltig:   ["Regionaler Rübenzucker hat eine bessere Klimabilanz.","Schön zu sehen, dass Zuckerhersteller auf CO2-Ziele setzen.","Nachhaltige Landwirtschaft beim Zuckeranbau überzeugt mich."],
};
const AUTHORS = ["@food_lab","@maja_kocht","Norddeutsche Z.","@fitmitlena","@sugar_skeptic","Verbrauchermag.","@papa_backt","@health_now","@summer_drinks","@bjoern_ernaehrt","Wirtschaftswoche","@clean_eating_de"];
const MIN_DEMO_MENTIONS = 237;

export function mockMentions(){
  const rng = mulberry32(20260611);
  const out = []; let id = 1;
  for (let d = 59; d >= 0; d--){
    const day = new Date(ANCHOR.getTime() - d * DAYMS);
    const recent = d < 21;
    let count = 4 + Math.floor(rng() * 4);
    if (recent) count += Math.floor(rng() * 2);
    for (let i = 0; i < count; i++){
      let r = rng(), src = SOURCES[0].id, acc = 0;
      for (const s of SOURCES){ acc += s.weight; if (r <= acc){ src = s.id; break; } }
      let topic = TOPICS[Math.floor(rng() * TOPICS.length)];
      if (recent && rng() < 0.30) topic = TOPICS.find(t => t.id === "saisonal");
      let sent = topic.lean + (rng() - 0.5) * 0.8;
      let b2b = false;
      if (d <= 6 && d >= 2 && rng() < 0.5){
        topic = TOPICS.find(t => t.id === "softdrinks");
        sent = -0.55 - rng() * 0.35; b2b = true;
      }
      sent = Math.max(-1, Math.min(1, sent));
      const pool = SNIPPETS[topic.id];
      out.push({
        id: id++, source: src, author: AUTHORS[Math.floor(rng()*AUTHORS.length)],
        date: day, ts: day.getTime(), text: pool[Math.floor(rng()*pool.length)],
        topic: topic.id, topicLabel: topic.label, sentiment: +sent.toFixed(2), b2b,
        sentimentLabel: sent > 0.15 ? "positiv" : sent < -0.15 ? "negativ" : "neutral",
        publicSentiment: +sent.toFixed(2),
        publicSentimentLabel: sent > 0.15 ? "positiv" : sent < -0.15 ? "negativ" : "neutral",
        impactReason: b2b ? "b2b_opportunity" : "neutral_context",
      });
    }
  }
  if (out.length < MIN_DEMO_MENTIONS) {
    const newest = out[0]?.date ?? ANCHOR;
    while (out.length < MIN_DEMO_MENTIONS) {
      const topic = TOPICS[Math.floor(rng() * TOPICS.length)];
      const sent = Math.max(-1, Math.min(1, topic.lean + (rng() - 0.5) * 0.8));
      const pool = SNIPPETS[topic.id];
      out.push({
        id: id++,
        source: SOURCES[Math.floor(rng() * SOURCES.length)].id,
        author: AUTHORS[Math.floor(rng() * AUTHORS.length)],
        date: newest,
        ts: newest.getTime(),
        text: pool[Math.floor(rng() * pool.length)],
        topic: topic.id,
        topicLabel: topic.label,
        sentiment: +sent.toFixed(2),
        b2b: false,
        sentimentLabel: sent > 0.15 ? "positiv" : sent < -0.15 ? "negativ" : "neutral",
        publicSentiment: +sent.toFixed(2),
        publicSentimentLabel: sent > 0.15 ? "positiv" : sent < -0.15 ? "negativ" : "neutral",
        impactReason: "neutral_context",
      });
    }
  }
  return out.sort((a,b) => b.ts - a.ts);
}

export const MOCK_COMP = (() => {
  const rng = mulberry32(7);
  const names = [
    { id:"nordzucker", name:"Nordzucker", base: 6, sov: 31, color:"#004b93" },
    { id:"suedzucker", name:"Südzucker", base: 2, sov: 38, color:"#8a6d3b" },
    { id:"pfeifer",    name:"Pfeifer & Langen", base: 9, sov: 18, color:"#6d5ce7" },
    { id:"cosun",      name:"Cosun Beet", base: 4, sov: 13, color:"#16a37b" },
  ];
  const series = [];
  for (let w = 11; w >= 0; w--){
    const row = { week: `KW${22 - w}` };
    names.forEach(n => { row[n.id] = Math.round(n.base + (rng()-0.5)*14); });
    series.push(row);
  }
  return { names, series };
})();

// Anzeige-Metadaten für die Ansicht „Datenquellen“.
export const SOURCE_INFO = [
  { id:"twitter", label:"X API v2", status:"active", auth:"Bearer Token",
    endpoint:"https://api.twitter.com/2/tweets/search/recent",
    note:"Keyword-basierte Tweet-Suche inkl. Public Metrics (Likes, Replies, Retweets) fur Trend- und Wettbewerbsmonitoring." },
  { id:"reddit", label:"Reddit API", status:"active", auth:"OAuth2 (script app)",
    endpoint:"https://oauth.reddit.com/r/{sub}/search",
    note:"Subreddits: r/de, r/Ernaehrung, r/Finanzen. Volltext-Kommentare, kostenlos für nicht-kommerzielle Nutzung." },
  { id:"youtube", label:"YouTube Data API v3", status:"active", auth:"API-Key (Quota)",
    endpoint:"https://www.googleapis.com/youtube/v3/commentThreads",
    note:"Kommentare unter Videos zu Zucker/Softdrinks. Quota-basiert, sehr ergiebig für Sentiment." },
  { id:"news", label:"NewsAPI / GDELT", status:"active", auth:"API-Key",
    endpoint:"https://newsapi.org/v2/everything",
    note:"Presseartikel zu Zuckermarkt, Preisen, Politik. Ergänzt das Wettbewerbs-Benchmarking." },
  { id:"instagram", label:"Instagram Graph API", status:"review", auth:"Business-Account + App-Review",
    endpoint:"https://graph.facebook.com/v22.0/ig_hashtag_search",
    note:"Nur Hashtag-Suche (max. 30 Hashtags/Woche). Erfordert Business-Account + Meta App-Review (~60 Tage). Basic Display API seit 12/2024 abgeschaltet." },
];
