import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ---------- Strategy tables (4-8 decks, dealer stands on soft 17, DAS allowed, no surrender) ----------
// Columns are dealer upcards: 2,3,4,5,6,7,8,9,10,A
const COLS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "A"];

const HARD = {
  8: ["H","H","H","H","H","H","H","H","H","H"],
  9: ["H","D","D","D","D","H","H","H","H","H"],
  10: ["D","D","D","D","D","D","D","D","H","H"],
  11: ["D","D","D","D","D","D","D","D","D","H"],
  12: ["H","H","S","S","S","H","H","H","H","H"],
  13: ["S","S","S","S","S","H","H","H","H","H"],
  14: ["S","S","S","S","S","H","H","H","H","H"],
  15: ["S","S","S","S","S","H","H","H","H","H"],
  16: ["S","S","S","S","S","H","H","H","H","H"],
  17: ["S","S","S","S","S","S","S","S","S","S"],
};

const SOFT = {
  13: ["H","H","H","D","D","H","H","H","H","H"], // A,2
  14: ["H","H","H","D","D","H","H","H","H","H"], // A,3
  15: ["H","H","D","D","D","H","H","H","H","H"], // A,4
  16: ["H","H","D","D","D","H","H","H","H","H"], // A,5
  17: ["H","D","D","D","D","H","H","H","H","H"], // A,6
  18: ["S","D","D","D","D","S","S","H","H","H"], // A,7
  19: ["S","S","S","S","S","S","S","S","S","S"], // A,8
  20: ["S","S","S","S","S","S","S","S","S","S"], // A,9
};

const PAIRS = {
  2: ["P","P","P","P","P","P","H","H","H","H"],
  3: ["P","P","P","P","P","P","H","H","H","H"],
  4: ["H","H","H","P","P","H","H","H","H","H"],
  5: ["D","D","D","D","D","D","D","D","H","H"],
  6: ["P","P","P","P","P","H","H","H","H","H"],
  7: ["P","P","P","P","P","P","H","H","H","H"],
  8: ["P","P","P","P","P","P","P","P","P","P"],
  9: ["P","P","P","P","P","S","P","P","S","S"],
  10: ["S","S","S","S","S","S","S","S","S","S"],
  11: ["P","P","P","P","P","P","P","P","P","P"], // A,A
};

const ACTION_LABEL = { H: "Hit", S: "Stand", D: "Double", P: "Split" };
const ACTION_LONG = {
  H: "Hit — take another card",
  S: "Stand — keep this total",
  D: "Double down — one card, double the bet",
  P: "Split — play the pair as two hands",
};

// ---------- Sound & haptics ----------
function playNote(ctx, freq, startTime, duration, volume, type = "sine") {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

function playCorrectChime(ctx) {
  if (!ctx) return;
  const now = ctx.currentTime;
  playNote(ctx, 880, now, 0.1, 0.13);
  playNote(ctx, 1318.5, now + 0.09, 0.14, 0.13);
}

function playIncorrectBuzz(ctx) {
  if (!ctx) return;
  const now = ctx.currentTime;
  playNote(ctx, 164, now, 0.22, 0.15, "square");
}

function playMilestoneChime(ctx) {
  if (!ctx) return;
  const now = ctx.currentTime;
  playNote(ctx, 660, now, 0.12, 0.14);
  playNote(ctx, 880, now + 0.11, 0.12, 0.14);
  playNote(ctx, 1320, now + 0.22, 0.24, 0.17);
}

const MILESTONES = [10, 25, 50, 100];

function triggerHaptic(pattern) {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch (e) { /* no-op */ }
  }
}

// ---------- Card helpers ----------
// ---------- Rail stud ring (follows the rail's real outline, evenly spaced) ----------
// Walks the same rounded-rect path the rail is drawn with: down the left side,
// around the bottom-left curve, along the bottom, around the bottom-right curve,
// and back up the right side. Studs are placed at equal arc-length intervals.
function railStudPositions(w, h, topR, botR, inset, spacing) {
  if (!w || !h) return [];
  // CSS shrinks corner radii proportionally when they don't fit the box
  const f = Math.min(1, w / (botR * 2), w / (topR * 2), h / (topR + botR));
  const rb = botR * f;
  const r = Math.max(rb - inset, 1); // radius of the stud path on the curves
  const yStart = inset;
  const yArc = h - rb; // where the straight sides end and the curves begin
  const side = Math.max(yArc - yStart, 0);
  const arc = (Math.PI / 2) * r;
  const bottom = Math.max(w - 2 * rb, 0);
  const total = 2 * side + 2 * arc + bottom;
  const n = Math.max(Math.round(total / spacing), 2);
  const step = total / n;

  const pts = [];
  for (let i = 0; i <= n; i++) {
    let s = i * step;
    if (s <= side) {
      pts.push({ x: inset, y: yStart + s });
      continue;
    }
    s -= side;
    if (s <= arc) {
      const a = Math.PI - (s / arc) * (Math.PI / 2);
      pts.push({ x: rb + r * Math.cos(a), y: yArc + r * Math.sin(a) });
      continue;
    }
    s -= arc;
    if (s <= bottom) {
      pts.push({ x: rb + s, y: h - inset });
      continue;
    }
    s -= bottom;
    if (s <= arc) {
      const a = Math.PI / 2 - (s / arc) * (Math.PI / 2);
      pts.push({ x: w - rb + r * Math.cos(a), y: yArc + r * Math.sin(a) });
      continue;
    }
    s -= arc;
    pts.push({ x: w - inset, y: yArc - s });
  }
  return pts;
}

function RailStuds() {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    update();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // 20 / 190 match the rail's border radii; 8 centers studs in the wood band
  const pts = useMemo(
    () => railStudPositions(size.w, size.h, 20, 190, 8, 28),
    [size.w, size.h]
  );

  return (
    <div ref={ref} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {pts.map((p, i) => (
        <span
          key={i}
          style={{
            ...styles.rivet,
            left: p.x,
            top: p.y,
            transform: "translate(-50%, -50%)",
          }}
        />
      ))}
    </div>
  );
}

const RANKS = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
const SUITS = [
  { sym: "♠", color: "#1a1a1a" },
  { sym: "♥", color: "#a61b29" },
  { sym: "♦", color: "#a61b29" },
  { sym: "♣", color: "#1a1a1a" },
];

function drawCard() {
  const rank = RANKS[Math.floor(Math.random() * RANKS.length)];
  const suit = SUITS[Math.floor(Math.random() * SUITS.length)];
  return { rank, suit: suit.sym, color: suit.color };
}

function rankValue(rank) {
  if (rank === "A") return 11;
  if (["10", "J", "Q", "K"].includes(rank)) return 10;
  return parseInt(rank, 10);
}

function pairKey(rank) {
  if (rank === "A") return 11;
  if (["10", "J", "Q", "K"].includes(rank)) return 10;
  return parseInt(rank, 10);
}

function handValue(cards) {
  let total = cards.reduce((s, c) => s + rankValue(c.rank), 0);
  let aces = cards.filter((c) => c.rank === "A").length;
  let soft = aces > 0;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  // "soft" only true if an ace is still counted as 11
  soft = cards.some((c) => c.rank === "A") && total <= 21 && (() => {
    let t = cards.reduce((s, c) => s + rankValue(c.rank), 0);
    let a = cards.filter((c) => c.rank === "A").length;
    while (t > 21 && a > 1) { t -= 10; a -= 1; }
    return t === total && cards.reduce((s,c)=>s+rankValue(c.rank),0) - total === (cards.filter(c=>c.rank==="A").length - a) * 10 ? true : true;
  })();
  return { total, soft: aces > 0 };
}

// ---------- Dealing by chart cell ----------
// Real card odds make a few spots (hard 17-20) show up constantly and others
// (2,2 vs 5) almost never. So the dealer walks the strategy card itself: it
// always deals one of the least-seen spots, which means you work through every
// cell before anything repeats. Suits, card order, and the hole card are random.
const TEN_RANKS = ["10", "J", "Q", "K"];
const CHART_TABLES = [
  { key: "hard", table: HARD },
  { key: "soft", table: SOFT },
  { key: "pairs", table: PAIRS },
];
const ALL_CELLS = CHART_TABLES.flatMap(({ key, table }) =>
  Object.keys(table).flatMap((row) =>
    COLS.map((_, col) => ({ key: `${key}-${row}-${col}`, table: key, row, col }))
  )
);
const TOTAL_CELLS = ALL_CELLS.length;

function pickOne(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function makeCard(value) {
  const rank = value === 11 ? "A" : value === 10 ? pickOne(TEN_RANKS) : String(value);
  const suit = pickOne(SUITS);
  return { rank, suit: suit.sym, color: suit.color };
}

// Two card values that land exactly on this cell of the chart
function playerValuesForCell(tableKey, row) {
  const r = Number(row);
  if (tableKey === "pairs") return [r, r];
  if (tableKey === "soft") return [11, r - 11]; // A + 2..9
  // hard: two non-ace cards that aren't a pair. The "8" row covers 5-8 and the
  // "17" row covers 17-19, matching how the chart groups them.
  const totals = r === 8 ? [5, 6, 7, 8] : r === 17 ? [17, 18, 19] : [r];
  const combos = [];
  for (const t of totals) {
    for (let x = 2; x <= 10; x++) {
      const y = t - x;
      if (y > x && y <= 10) combos.push([x, y]);
    }
  }
  return pickOne(combos);
}

function dealCell(cellStats, avoidKey) {
  const seen = (c) => (cellStats[c.key] ? cellStats[c.key].attempts : 0);
  const min = Math.min(...ALL_CELLS.map(seen));
  let pool = ALL_CELLS.filter((c) => seen(c) === min && c.key !== avoidKey);
  if (pool.length === 0) pool = ALL_CELLS.filter((c) => seen(c) === min);
  const cell = pickOne(pool);

  const [a, b] = playerValuesForCell(cell.table, cell.row);
  const playerCards = Math.random() < 0.5 ? [makeCard(a), makeCard(b)] : [makeCard(b), makeCard(a)];
  const upValue = cell.col === COLS.length - 1 ? 11 : Number(COLS[cell.col]);
  return { playerCards, dealerCards: [makeCard(upValue), drawCard()], cellKey: cell.key };
}

function isPair(cards) {
  return cards.length === 2 && pairKey(cards[0].rank) === pairKey(cards[1].rank);
}

function correctAction(playerCards, dealerUpRank) {
  const colIdx = COLS.indexOf(dealerUpRank === "A" ? "A" : (["10","J","Q","K"].includes(dealerUpRank) ? "10" : dealerUpRank));
  if (isPair(playerCards)) {
    const key = pairKey(playerCards[0].rank);
    return PAIRS[key][colIdx];
  }
  const { total, soft } = handValue(playerCards);
  if (soft && total >= 13 && total <= 20) {
    return SOFT[total][colIdx];
  }
  const hardTotal = Math.min(Math.max(total, 8), 17);
  if (total <= 8) return "H";
  if (total >= 17) return "S";
  return HARD[hardTotal][colIdx];
}

// ---------- UI subcomponents ----------
function PlayingCard({ card, hidden }) {
  if (hidden) {
    return (
      <div style={styles.cardBack}>
        <div style={styles.cardBackPattern} />
      </div>
    );
  }
  return (
    <div style={styles.card}>
      <div style={{ ...styles.cardRank, color: card.color }}>{card.rank}</div>
      <div style={{ ...styles.cardSuit, color: card.color }}>{card.suit}</div>
      <div style={{ ...styles.cardRankBR, color: card.color }}>{card.rank}</div>
    </div>
  );
}

function FlipCard({ card, hidden }) {
  return (
    <div style={styles.flipOuter}>
      <div style={{ ...styles.flipInner, transform: hidden ? "rotateY(0deg)" : "rotateY(180deg)" }}>
        <div style={{ ...styles.flipFace }}>
          <div style={styles.cardBack}>
            <div style={styles.cardBackPattern} />
          </div>
        </div>
        <div style={{ ...styles.flipFace, ...styles.flipFaceBack }}>
          <div style={styles.card}>
            <div style={{ ...styles.cardRank, color: card.color }}>{card.rank}</div>
            <div style={{ ...styles.cardSuit, color: card.color }}>{card.suit}</div>
            <div style={{ ...styles.cardRankBR, color: card.color }}>{card.rank}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChartTable({ title, tableKey, table, rowLabel, highlight, mode, cellStats }) {
  const rows = Object.keys(table);
  return (
    <div style={styles.chartBlock}>
      <div style={styles.chartTitle}>{title}</div>
      <div style={styles.chartGrid}>
        <div style={styles.chartHeaderCell}></div>
        {COLS.map((c) => (
          <div key={c} style={styles.chartHeaderCell}>{c}</div>
        ))}
        {rows.map((r) => (
          <React.Fragment key={r}>
            <div style={styles.chartRowLabel}>{rowLabel(r)}</div>
            {table[r].map((action, i) => {
              const isHot = highlight && highlight.row === r && highlight.col === i;
              let bg, label, fontWeight;
              if (mode === "heat") {
                const stat = cellStats[`${tableKey}-${r}-${i}`];
                if (stat && stat.attempts > 0) {
                  const acc = stat.correct / stat.attempts;
                  bg = `hsl(${Math.round(acc * 120)}, 58%, 30%)`;
                  label = String(Math.round(acc * 100));
                } else {
                  bg = "#232c28";
                  label = "–";
                }
                fontWeight = 600;
              } else {
                bg = cellColor(action);
                label = action;
                fontWeight = 600;
              }
              if (isHot) { bg = "#cba135"; fontWeight = 800; }
              return (
                <div
                  key={i}
                  style={{
                    ...styles.chartCell,
                    background: bg,
                    color: isHot ? "#0a2b21" : "#f2ead6",
                    fontWeight,
                    boxShadow: isHot ? "0 0 0 2px #f2ead6 inset, 0 0 12px rgba(203,161,53,0.7)" : "none",
                  }}
                >
                  {label}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function cellColor(action) {
  switch (action) {
    case "H": return "#4a3728";
    case "S": return "#0d3b2e";
    case "D": return "#6b3a12";
    case "P": return "#5c1f2e";
    default: return "#333";
  }
}

function cellLabel(tableKey, row, col) {
  const dealer = COLS[col];
  if (tableKey === "hard") return `Hard ${row === "8" ? "≤8" : row} vs ${dealer}`;
  if (tableKey === "soft") return `Soft ${row} (A,${Number(row) - 11}) vs ${dealer}`;
  if (tableKey === "pairs") {
    const p = row === "11" ? "A" : row === "10" ? "10" : row;
    return `${p},${p} vs ${dealer}`;
  }
  return `${tableKey} ${row} vs ${dealer}`;
}

// ---------- Main component ----------
export default function BlackjackTrainer() {
  const initialDeal = useRef(null);
  if (initialDeal.current === null) initialDeal.current = dealCell({}, null);
  const [playerCards, setPlayerCards] = useState(initialDeal.current.playerCards);
  const [dealerCards, setDealerCards] = useState(initialDeal.current.dealerCards);
  const [answered, setAnswered] = useState(false);
  const [lastResult, setLastResult] = useState(null); // { correct, chosen, correctAction }
  const [stats, setStats] = useState({ total: 0, correct: 0, streak: 0, best: 0 });
  const [showChart, setShowChart] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [cellStats, setCellStats] = useState({}); // key "table-row-col" -> {attempts, correct}
  const [dealId, setDealId] = useState(0);
  const [showSummary, setShowSummary] = useState(false);
  const [copied, setCopied] = useState(false);
  const [celebration, setCelebration] = useState(null); // { id, milestone }
  const audioCtxRef = useRef(null);
  const celebrationTimeoutRef = useRef(null);
  const loadedRef = useRef(false);
  const cellStatsRef = useRef({});
  const lastCellRef = useRef(initialDeal.current.cellKey);
  cellStatsRef.current = cellStats;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (window.storage && window.storage.get) {
          const result = await window.storage.get("session-data", false);
          if (!cancelled && result && result.value) {
            const parsed = JSON.parse(result.value);
            if (parsed.stats) setStats(parsed.stats);
            if (parsed.cellStats) setCellStats(parsed.cellStats);
          }
        }
      } catch (e) {
        // no saved session yet, or storage unavailable — start fresh
      } finally {
        if (!cancelled) loadedRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const saveSession = useCallback((nextStats, nextCellStats) => {
    if (!loadedRef.current) return; // don't clobber saved data before the initial load finishes
    if (!(window.storage && window.storage.set)) return;
    window.storage
      .set("session-data", JSON.stringify({ stats: nextStats, cellStats: nextCellStats }), false)
      .catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      if (celebrationTimeoutRef.current) clearTimeout(celebrationTimeoutRef.current);
    };
  }, []);

  const ensureAudio = useCallback(() => {
    if (!audioCtxRef.current) {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        audioCtxRef.current = new Ctx();
      } catch (e) { /* audio unavailable */ }
    }
    if (audioCtxRef.current && audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  }, []);

  const { total: playerTotal, soft } = useMemo(() => handValue(playerCards), [playerCards]);
  const dealerUp = dealerCards[0];
  const pair = isPair(playerCards);
  const correct = useMemo(() => correctAction(playerCards, dealerUp.rank), [playerCards, dealerUp]);

  const newHand = useCallback(() => {
    const deal = dealCell(cellStatsRef.current, lastCellRef.current);
    lastCellRef.current = deal.cellKey;
    setPlayerCards(deal.playerCards);
    setDealerCards(deal.dealerCards);
    setAnswered(false);
    setLastResult(null);
    setDealId((n) => n + 1);
    if (soundOn) {
      const ctx = ensureAudio();
      if (ctx) {
        [0, 0.12, 0.24, 0.36].forEach((t) => playNote(ctx, 1100, ctx.currentTime + t, 0.05, 0.06));
      }
    }
  }, [soundOn, ensureAudio]);

  const triggerCelebration = useCallback((milestone) => {
    if (celebrationTimeoutRef.current) clearTimeout(celebrationTimeoutRef.current);
    setCelebration({ id: Date.now(), milestone });
    celebrationTimeoutRef.current = setTimeout(() => setCelebration(null), 1800);
  }, []);

  const handleChoice = (choice) => {
    if (answered) return;
    const isCorrect = choice === correct;
    const newStreak = isCorrect ? stats.streak + 1 : 0;
    const newStats = {
      total: stats.total + 1,
      correct: stats.correct + (isCorrect ? 1 : 0),
      streak: newStreak,
      best: Math.max(stats.best, newStreak),
    };
    setLastResult({ chosen: choice, correctAction: correct, isCorrect });
    setAnswered(true);
    setStats(newStats);

    const key = `${highlight.table}-${highlight.row}-${highlight.col}`;
    const existingCell = cellStats[key] || { attempts: 0, correct: 0 };
    const newCellStats = {
      ...cellStats,
      [key]: { attempts: existingCell.attempts + 1, correct: existingCell.correct + (isCorrect ? 1 : 0) },
    };
    setCellStats(newCellStats);
    saveSession(newStats, newCellStats);

    const isMilestone = isCorrect && MILESTONES.includes(newStreak);

    if (soundOn) {
      const ctx = ensureAudio();
      if (isCorrect) playCorrectChime(ctx); else playIncorrectBuzz(ctx);
      if (isMilestone) playMilestoneChime(ctx);
    }
    triggerHaptic(isMilestone ? [20, 30, 20, 30, 50] : isCorrect ? 25 : [30, 40, 30]);
    if (isMilestone) triggerCelebration(newStreak);
  };

  const resetHeatmap = () => {
    setCellStats({});
    saveSession(stats, {});
  };

  const confettiPieces = useMemo(() => {
    if (!celebration) return [];
    const colors = ["#cba135", "#f2ead6", "#a61b29", "#3c8a5b"];
    return Array.from({ length: 26 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      color: colors[i % colors.length],
      delay: Math.random() * 0.3,
      duration: 1.1 + Math.random() * 0.6,
      drift: Math.round((Math.random() - 0.5) * 120),
    }));
  }, [celebration]);

  const accuracy = stats.total ? Math.round((stats.correct / stats.total) * 100) : 0;

  // how much of the strategy card you've seen, and which lap of it you're on
  const coverage = useMemo(() => {
    let seen = 0;
    let min = Infinity;
    for (const c of ALL_CELLS) {
      const n = cellStats[c.key] ? cellStats[c.key].attempts : 0;
      if (n > 0) seen += 1;
      if (n < min) min = n;
    }
    return { seen, pass: min + 1 };
  }, [cellStats]);

  const weakestCell = useMemo(() => {
    let best = null;
    for (const key of Object.keys(cellStats)) {
      const { attempts, correct } = cellStats[key];
      if (attempts < 1) continue;
      const acc = correct / attempts;
      if (
        !best ||
        acc < best.acc ||
        (acc === best.acc && attempts > best.attempts)
      ) {
        const [tableKey, row, col] = key.split("-");
        best = { key, tableKey, row, col: Number(col), attempts, correct, acc };
      }
    }
    return best;
  }, [cellStats]);

  const summaryText = useMemo(() => {
    const lines = [
      "Blackjack Basic Strategy — Session Summary",
      `Hands played: ${stats.total}`,
      `Accuracy: ${accuracy}%`,
      `Best streak: ${stats.best}`,
    ];
    if (weakestCell && weakestCell.attempts >= 2) {
      lines.push(
        `Weakest spot: ${cellLabel(weakestCell.tableKey, weakestCell.row, weakestCell.col)} (${Math.round(weakestCell.acc * 100)}% over ${weakestCell.attempts} hands)`
      );
    }
    return lines.join("\n");
  }, [stats, accuracy, weakestCell]);

  const copySummary = () => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(summaryText).then(
        () => { setCopied(true); setTimeout(() => setCopied(false), 1800); },
        () => {}
      );
    }
  };

  const startNewSession = () => {
    const resetStats = { total: 0, correct: 0, streak: 0, best: 0 };
    setStats(resetStats);
    setShowSummary(false);
    saveSession(resetStats, cellStats);
    newHand();
  };

  // highlight info for chart
  const highlight = useMemo(() => {
    const dealerRank = dealerUp.rank === "A" ? "A" : (["10","J","Q","K"].includes(dealerUp.rank) ? "10" : dealerUp.rank);
    const colIdx = COLS.indexOf(dealerRank);
    if (pair) {
      const key = pairKey(playerCards[0].rank);
      return { table: "pairs", row: String(key), col: colIdx };
    }
    if (soft && playerTotal >= 13 && playerTotal <= 20) {
      return { table: "soft", row: String(playerTotal), col: colIdx };
    }
    const hardTotal = Math.min(Math.max(playerTotal, 8), 17);
    return { table: "hard", row: String(hardTotal), col: colIdx };
  }, [playerCards, dealerUp, pair, soft, playerTotal]);

  return (
    <div style={styles.page}>
      <style>{`
        * { box-sizing: border-box; }
        button:focus-visible, .focusable:focus-visible { outline: 3px solid #cba135; outline-offset: 2px; }
        @keyframes dealIn {
          0% { transform: translateY(-160px) rotate(-12deg); opacity: 0; }
          60% { opacity: 1; }
          100% { transform: translateY(0) rotate(0deg); opacity: 1; }
        }
        @keyframes confettiFall {
          0% { transform: translateY(-20px) translateX(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(360px) translateX(var(--drift, 0px)) rotate(340deg); opacity: 0; }
        }
        @keyframes glowPop {
          0% { transform: scale(0.7); opacity: 0; }
          30% { transform: scale(1.08); opacity: 1; }
          65% { transform: scale(1); opacity: 1; }
          100% { transform: scale(1); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
      `}</style>

      <div style={styles.vignette} />

      <button
        style={styles.soundToggle}
        onClick={() => setSoundOn((v) => !v)}
        aria-label={soundOn ? "Mute sound" : "Unmute sound"}
      >
        {soundOn ? "🔊" : "🔇"}
      </button>

      <div style={styles.header}>
        <div style={styles.eyebrow}>TABLE 7 · SINGLE-PLAYER</div>
        <h1 style={styles.title}>Basic Strategy Trainer</h1>
        <div style={styles.subtitle}>4–8 decks · dealer stands on soft 17 · DAS allowed</div>
        <div style={styles.subtitleSmall}>Your stats and heat map are saved automatically</div>
      </div>

      <div style={styles.statsBar}>
        <Stat label="HANDS" value={stats.total} />
        <Stat label="ACCURACY" value={`${accuracy}%`} accent />
        <Stat label="STREAK" value={stats.streak} />
        <Stat label="BEST" value={stats.best} />
      </div>

      <div style={styles.coverage}>
        Strategy card: {coverage.seen} of {TOTAL_CELLS} spots seen · pass {coverage.pass}
      </div>

      <button style={styles.summaryTrigger} onClick={() => setShowSummary(true)}>
        View session summary
      </button>

      <div style={styles.tableScene}>
        <div style={styles.tableApron} />
        <div style={styles.tableOuterRim}>
          <div style={styles.tableRail}>
            <RailStuds />

            <div style={styles.table}>
              <div style={styles.dealerRow}>
                <div style={styles.rowLabel}>DEALER {answered ? handValue(dealerCards).total : ""}</div>
                <div style={styles.cardsRow}>
                  <div key={`d0-${dealId}`} style={{ ...styles.dealAnim, animationDelay: "0.12s" }}>
                    <PlayingCard card={dealerCards[0]} />
                  </div>
                  <div key={`d1-${dealId}`} style={{ ...styles.dealAnim, animationDelay: "0.36s" }}>
                    <FlipCard card={dealerCards[1]} hidden={!answered} />
                  </div>
                </div>
              </div>

              <div style={styles.divider}>
                <span>{dealerUp.rank === "A" ? "Ace showing" : `Dealer shows ${dealerUp.rank}`}</span>
              </div>

              <div style={styles.payoutArcWrap}>
                <svg viewBox="0 0 460 60" style={{ width: "100%", height: 46, display: "block" }}>
                  <defs>
                    <path id="payoutArc" d="M 20 50 Q 230 4 440 50" fill="none" />
                  </defs>
                  <text>
                    <textPath
                      href="#payoutArc"
                      startOffset="50%"
                      textAnchor="middle"
                      fill="rgba(224,196,120,0.55)"
                      fontFamily="'Playfair Display', serif"
                      fontWeight="700"
                      fontSize="14"
                      letterSpacing="2"
                    >
                      BLACKJACK PAYS 3 TO 2
                    </textPath>
                  </text>
                </svg>
              </div>

              <div style={styles.playerRow}>
                <div style={styles.bettingCircle} />
                <div style={styles.cardsRow}>
                  {playerCards.map((c, i) => (
                    <div key={`p${i}-${dealId}`} style={{ ...styles.dealAnim, animationDelay: `${i * 0.24}s` }}>
                      <PlayingCard card={c} />
                    </div>
                  ))}
                </div>
                <div style={styles.rowLabel}>
                  YOU {playerTotal}{soft && !pair ? " (soft)" : ""}{pair ? " · PAIR" : ""}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {!answered ? (
        <div style={styles.actions}>
          <ActionButton label="Hit" onClick={() => handleChoice("H")} />
          <ActionButton label="Stand" onClick={() => handleChoice("S")} />
          <ActionButton label="Double" onClick={() => handleChoice("D")} />
          <ActionButton label="Split" onClick={() => handleChoice("P")} disabled={!pair} />
        </div>
      ) : (
        <div style={styles.feedback}>
          <div
            style={{
              ...styles.feedbackBanner,
              background: lastResult.isCorrect ? "rgba(203,161,53,0.15)" : "rgba(166,27,41,0.15)",
              borderColor: lastResult.isCorrect ? "#cba135" : "#a61b29",
            }}
          >
            <div style={{ ...styles.feedbackHead, color: lastResult.isCorrect ? "#e9cd7a" : "#e08a90" }}>
              {lastResult.isCorrect ? "Correct" : "Not quite"}
            </div>
            <div style={styles.feedbackBody}>
              {lastResult.isCorrect
                ? `${ACTION_LABEL[lastResult.chosen]} is the book play here.`
                : `You chose ${ACTION_LABEL[lastResult.chosen]}. Basic strategy says: ${ACTION_LONG[correct]}.`}
            </div>
          </div>
          <button style={styles.nextButton} onClick={newHand}>Next hand →</button>
        </div>
      )}

      <button style={styles.chartToggle} onClick={() => setShowChart((v) => !v)}>
        {showChart ? "Hide strategy chart" : "Show strategy chart"}
      </button>

      {showChart && (
        <div style={styles.chartPanel}>
          <div style={styles.panelSectionTitle}>Strategy chart</div>
          <ChartTable
            title="HARD TOTALS"
            tableKey="hard"
            table={HARD}
            rowLabel={(r) => (r === "8" ? "≤8" : r === "17" ? "17+" : r)}
            highlight={highlight.table === "hard" ? highlight : null}
            mode="chart"
            cellStats={cellStats}
          />
          <ChartTable
            title="SOFT TOTALS"
            tableKey="soft"
            table={SOFT}
            rowLabel={(r) => `A,${r - 11}`}
            highlight={highlight.table === "soft" ? highlight : null}
            mode="chart"
            cellStats={cellStats}
          />
          <ChartTable
            title="PAIRS"
            tableKey="pairs"
            table={PAIRS}
            rowLabel={(r) => (r === "11" ? "A,A" : r === "10" ? "10,10" : `${r},${r}`)}
            highlight={highlight.table === "pairs" ? highlight : null}
            mode="chart"
            cellStats={cellStats}
          />
          <div style={styles.legend}>
            <LegendDot color={cellColor("H")} label="Hit" />
            <LegendDot color={cellColor("S")} label="Stand" />
            <LegendDot color={cellColor("D")} label="Double" />
            <LegendDot color={cellColor("P")} label="Split" />
            <LegendDot color="#cba135" label="This hand" dark />
          </div>

          <div style={styles.panelDivider} />

          <div style={styles.panelSectionTitle}>Heat map — your accuracy by cell</div>
          <ChartTable
            title="HARD TOTALS"
            tableKey="hard"
            table={HARD}
            rowLabel={(r) => (r === "8" ? "≤8" : r === "17" ? "17+" : r)}
            highlight={highlight.table === "hard" ? highlight : null}
            mode="heat"
            cellStats={cellStats}
          />
          <ChartTable
            title="SOFT TOTALS"
            tableKey="soft"
            table={SOFT}
            rowLabel={(r) => `A,${r - 11}`}
            highlight={highlight.table === "soft" ? highlight : null}
            mode="heat"
            cellStats={cellStats}
          />
          <ChartTable
            title="PAIRS"
            tableKey="pairs"
            table={PAIRS}
            rowLabel={(r) => (r === "11" ? "A,A" : r === "10" ? "10,10" : `${r},${r}`)}
            highlight={highlight.table === "pairs" ? highlight : null}
            mode="heat"
            cellStats={cellStats}
          />
          <div style={styles.legend}>
            <LegendDot color="#232c28" label="Not seen yet" />
            <LegendDot color="hsl(0, 58%, 30%)" label="Struggling" />
            <LegendDot color="hsl(60, 58%, 30%)" label="Mixed" />
            <LegendDot color="hsl(120, 58%, 30%)" label="Solid" />
            <LegendDot color="#cba135" label="This hand" dark />
            <button style={styles.resetLink} onClick={resetHeatmap}>Reset heat map</button>
          </div>
        </div>
      )}

      {celebration && (
        <div style={styles.celebrationOverlay} key={celebration.id}>
          {confettiPieces.map((p) => (
            <span
              key={p.id}
              style={{
                ...styles.confettiPiece,
                left: `${p.left}%`,
                background: p.color,
                animationDelay: `${p.delay}s`,
                animationDuration: `${p.duration}s`,
                "--drift": `${p.drift}px`,
              }}
            />
          ))}
          <div style={styles.milestoneText}>{celebration.milestone} in a row!</div>
        </div>
      )}

      {showSummary && (
        <div style={styles.modalOverlay} onClick={() => setShowSummary(false)}>
          <div style={styles.summaryCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.summaryEyebrow}>SESSION SUMMARY</div>
            <div style={styles.summaryTitle}>Table 7 Scorecard</div>

            <div style={styles.summaryStatsGrid}>
              <div style={styles.summaryStatBlock}>
                <div style={styles.summaryStatValue}>{stats.total}</div>
                <div style={styles.summaryStatLabel}>HANDS PLAYED</div>
              </div>
              <div style={styles.summaryStatBlock}>
                <div style={{ ...styles.summaryStatValue, color: "#cba135" }}>{accuracy}%</div>
                <div style={styles.summaryStatLabel}>ACCURACY</div>
              </div>
              <div style={styles.summaryStatBlock}>
                <div style={styles.summaryStatValue}>{stats.best}</div>
                <div style={styles.summaryStatLabel}>BEST STREAK</div>
              </div>
              <div style={styles.summaryStatBlock}>
                <div style={styles.summaryStatValue}>{stats.correct}/{stats.total}</div>
                <div style={styles.summaryStatLabel}>CORRECT</div>
              </div>
            </div>

            <div style={styles.summaryDivider} />

            <div style={styles.summaryWeakest}>
              <div style={styles.summaryWeakestLabel}>WEAKEST SPOT</div>
              {weakestCell && weakestCell.attempts >= 2 ? (
                <>
                  <div style={styles.summaryWeakestValue}>
                    {cellLabel(weakestCell.tableKey, weakestCell.row, weakestCell.col)}
                  </div>
                  <div style={styles.summaryWeakestSub}>
                    {Math.round(weakestCell.acc * 100)}% correct over {weakestCell.attempts} hands
                  </div>
                </>
              ) : (
                <div style={styles.summaryWeakestSub}>Play a few more hands to surface a weak spot.</div>
              )}
            </div>

            <div style={styles.summaryActions}>
              <button style={styles.summaryCopyButton} onClick={copySummary}>
                {copied ? "Copied ✓" : "Copy summary"}
              </button>
              <button style={styles.summaryResetButton} onClick={startNewSession}>
                New session
              </button>
            </div>

            <button style={styles.summaryHeatResetButton} onClick={resetHeatmap}>
              Reset heat map only
            </button>

            <button style={styles.summaryClose} onClick={() => setShowSummary(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div style={styles.statBlock}>
      <div style={styles.statValue(accent)}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  );
}

function ActionButton({ label, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...styles.actionButton,
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

function LegendDot({ color, label, dark }) {
  return (
    <div style={styles.legendItem}>
      <span style={{ ...styles.legendSwatch, background: color, border: dark ? "1px solid #0a2b21" : "none" }} />
      <span>{label}</span>
    </div>
  );
}

// ---------- Styles ----------
const styles = {
  page: {
    position: "relative",
    minHeight: "100vh",
    background: "radial-gradient(ellipse at top, #0f4433 0%, #0a2b21 55%, #071e17 100%)",
    color: "#f2ead6",
    fontFamily: "'JetBrains Mono', monospace",
    padding: "28px 16px 60px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    overflow: "hidden",
  },
  vignette: {
    position: "fixed",
    inset: 0,
    pointerEvents: "none",
    background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.45) 100%)",
  },
  header: { textAlign: "center", marginBottom: 18, zIndex: 1 },
  eyebrow: { fontSize: 11, letterSpacing: "0.2em", color: "#8fae9d", marginBottom: 6 },
  title: {
    fontFamily: "'Playfair Display', serif",
    fontWeight: 900,
    fontSize: "clamp(28px, 6vw, 42px)",
    margin: 0,
    color: "#f2ead6",
    textShadow: "0 2px 12px rgba(0,0,0,0.4)",
  },
  subtitle: { fontSize: 12, color: "#8fae9d", marginTop: 6 },
  subtitleSmall: { fontSize: 10, color: "#5f7a6c", marginTop: 4, letterSpacing: "0.04em" },
  coverage: {
    fontSize: 11,
    color: "#8fae9d",
    letterSpacing: "0.06em",
    marginBottom: 12,
    textAlign: "center",
    zIndex: 1,
  },
  statsBar: {
    display: "flex",
    gap: 10,
    marginBottom: 22,
    flexWrap: "wrap",
    justifyContent: "center",
    zIndex: 1,
  },
  statBlock: {
    background: "rgba(0,0,0,0.25)",
    border: "1px solid rgba(242,234,214,0.15)",
    borderRadius: 10,
    padding: "8px 16px",
    textAlign: "center",
    minWidth: 76,
  },
  statValue: (accent) => ({
    fontSize: 20,
    fontWeight: 700,
    color: accent ? "#cba135" : "#f2ead6",
  }),
  statLabel: { fontSize: 9, letterSpacing: "0.12em", color: "#8fae9d", marginTop: 2 },
  tableScene: {
    position: "relative",
    width: "100%",
    maxWidth: 500,
    paddingBottom: 22,
  },
  tableApron: {
    position: "absolute",
    left: "5%",
    right: "5%",
    bottom: 2,
    height: 30,
    backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.15), rgba(0,0,0,0.65)), url('/textures/wood.jpg')`,
    backgroundSize: "cover",
    backgroundPosition: "center 30%",
    backgroundBlendMode: "multiply",
    borderRadius: "0 0 190px 190px",
    boxShadow: "inset 0 4px 8px rgba(0,0,0,0.55), 0 10px 20px rgba(0,0,0,0.5)",
    zIndex: 0,
  },
  tableOuterRim: {
    position: "relative",
    background: "linear-gradient(175deg, #1c1c1e 0%, #050505 100%)",
    borderRadius: "24px 24px 198px 198px",
    padding: 5,
    transform: "perspective(900px) rotateX(5deg)",
    transformOrigin: "50% 100%",
    boxShadow:
      "inset 0 1px 1px rgba(255,255,255,0.06), 0 20px 32px -6px rgba(0,0,0,0.55)",
    zIndex: 1,
  },
  tableRail: {
    position: "relative",
    width: "100%",
    backgroundImage: `
      linear-gradient(175deg, rgba(255,255,255,0.22) 0%, transparent 35%),
      linear-gradient(5deg, rgba(0,0,0,0.4) 0%, transparent 45%),
      url('/textures/wood.jpg')
    `,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundBlendMode: "soft-light, multiply, normal",
    borderRadius: "20px 20px 190px 190px",
    padding: 16,
    boxShadow: "inset 0 1px 2px rgba(255,255,255,0.15), inset 0 -8px 16px rgba(0,0,0,0.55)",
  },
  rivet: {
    position: "absolute",
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "radial-gradient(circle at 35% 30%, #f6e2a0, #c9a13a 55%, #7a5a1e)",
    boxShadow: "0 1px 2px rgba(0,0,0,0.6), inset 0 0 1px rgba(255,255,255,0.4)",
    zIndex: 2,
  },
  table: {
    width: "100%",
    backgroundImage: `
      radial-gradient(ellipse at 50% 0%, rgba(255,255,255,0.16), transparent 60%),
      radial-gradient(ellipse at 50% 105%, rgba(0,0,0,0.5), transparent 65%),
      linear-gradient(rgba(5,35,22,0.42), rgba(4,25,16,0.5)),
      url('/textures/felt.jpg')
    `,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundBlendMode: "soft-light, multiply, multiply, normal",
    border: "2px solid rgba(224,196,120,0.4)",
    borderRadius: "10px 10px 176px 176px",
    padding: "24px 18px 32px",
    boxShadow: "inset 0 3px 10px rgba(0,0,0,0.5), inset 0 -24px 32px -14px rgba(0,0,0,0.45)",
  },
  dealerRow: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8 },
  playerRow: { position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginTop: 8 },
  payoutArcWrap: {
    width: "100%",
    maxWidth: 300,
    margin: "0 auto",
    opacity: 0.95,
  },
  bettingCircle: {
    position: "absolute",
    bottom: -2,
    left: "50%",
    transform: "translateX(-50%)",
    width: 140,
    height: 60,
    border: "1.5px solid rgba(224,196,120,0.45)",
    borderRadius: "50%",
    zIndex: 0,
    pointerEvents: "none",
  },
  rowLabel: { position: "relative", zIndex: 1, fontSize: 12, letterSpacing: "0.14em", color: "#f2ead6", fontWeight: 700 },
  cardsRow: { position: "relative", zIndex: 1, display: "flex", gap: 10, minHeight: 92 },
  divider: {
    textAlign: "center",
    fontSize: 11,
    color: "#e8d3d6",
    margin: "14px 0",
    letterSpacing: "0.08em",
  },
  card: {
    width: 60,
    height: 84,
    background: "#f2ead6",
    borderRadius: 8,
    boxShadow: "0 4px 10px rgba(0,0,0,0.35)",
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  cardRank: { position: "absolute", top: 6, left: 8, fontSize: 14, fontWeight: 700 },
  cardRankBR: { position: "absolute", bottom: 6, right: 8, fontSize: 14, fontWeight: 700, transform: "rotate(180deg)" },
  cardSuit: { fontSize: 26 },
  cardBack: {
    width: 60,
    height: 84,
    borderRadius: 8,
    background: "repeating-linear-gradient(45deg, #7a1f2b, #7a1f2b 6px, #6b1a24 6px, #6b1a24 12px)",
    border: "2px solid #cba135",
    boxShadow: "0 4px 10px rgba(0,0,0,0.35)",
  },
  cardBackPattern: {},
  dealAnim: {
    animation: "dealIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
  },
  flipOuter: {
    width: 60,
    height: 84,
    perspective: 600,
  },
  flipInner: {
    position: "relative",
    width: "100%",
    height: "100%",
    transformStyle: "preserve-3d",
    transition: "transform 0.5s ease-out",
  },
  flipFace: {
    position: "absolute",
    inset: 0,
    backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden",
  },
  flipFaceBack: {
    transform: "rotateY(180deg)",
  },
  actions: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
    width: "100%",
    maxWidth: 480,
    marginTop: 22,
    zIndex: 1,
  },
  actionButton: {
    background: "linear-gradient(180deg, #cba135, #a9822a)",
    color: "#0a2b21",
    border: "none",
    borderRadius: 12,
    padding: "16px 0",
    fontFamily: "'JetBrains Mono', monospace",
    fontWeight: 700,
    fontSize: 15,
    letterSpacing: "0.04em",
  },
  feedback: { width: "100%", maxWidth: 480, marginTop: 22, zIndex: 1 },
  feedbackBanner: { border: "1px solid", borderRadius: 12, padding: "14px 16px" },
  feedbackHead: { fontWeight: 700, fontSize: 14, letterSpacing: "0.06em", marginBottom: 4 },
  feedbackBody: { fontSize: 13, color: "#e6ddc6", lineHeight: 1.5 },
  nextButton: {
    marginTop: 12,
    width: "100%",
    background: "transparent",
    color: "#f2ead6",
    border: "1px solid rgba(242,234,214,0.3)",
    borderRadius: 12,
    padding: "12px 0",
    fontFamily: "'JetBrains Mono', monospace",
    fontWeight: 600,
    fontSize: 13,
  },
  summaryTrigger: {
    background: "transparent",
    color: "#8fae9d",
    border: "1px solid rgba(242,234,214,0.2)",
    borderRadius: 20,
    padding: "7px 16px",
    fontSize: 11,
    letterSpacing: "0.08em",
    marginBottom: 20,
    zIndex: 1,
    fontFamily: "'JetBrains Mono', monospace",
  },
  celebrationOverlay: {
    position: "fixed",
    inset: 0,
    pointerEvents: "none",
    overflow: "hidden",
    zIndex: 15,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  confettiPiece: {
    position: "absolute",
    top: -20,
    width: 8,
    height: 14,
    borderRadius: 2,
    animationName: "confettiFall",
    animationTimingFunction: "ease-in",
    animationFillMode: "forwards",
  },
  milestoneText: {
    position: "relative",
    fontFamily: "'Playfair Display', serif",
    fontWeight: 900,
    fontSize: 26,
    color: "#f2ead6",
    textShadow: "0 0 24px rgba(203,161,53,0.85), 0 4px 16px rgba(0,0,0,0.5)",
    animation: "glowPop 1.7s ease-out forwards",
    background: "rgba(10,43,33,0.4)",
    padding: "14px 28px",
    borderRadius: 16,
    border: "1px solid rgba(203,161,53,0.6)",
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(4,12,9,0.72)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 20,
    padding: 16,
  },
  summaryCard: {
    width: "100%",
    maxWidth: 380,
    background: "linear-gradient(180deg, #123e2f, #0a2b21)",
    border: "1px solid #cba135",
    borderRadius: 18,
    padding: "26px 24px",
    boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
    textAlign: "center",
  },
  summaryEyebrow: { fontSize: 10, letterSpacing: "0.22em", color: "#8fae9d" },
  summaryTitle: {
    fontFamily: "'Playfair Display', serif",
    fontWeight: 900,
    fontSize: 24,
    color: "#f2ead6",
    marginTop: 4,
    marginBottom: 18,
  },
  summaryStatsGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
    marginBottom: 6,
  },
  summaryStatBlock: {
    background: "rgba(0,0,0,0.22)",
    border: "1px solid rgba(242,234,214,0.12)",
    borderRadius: 10,
    padding: "10px 6px",
  },
  summaryStatValue: { fontSize: 22, fontWeight: 700, color: "#f2ead6" },
  summaryStatLabel: { fontSize: 9, letterSpacing: "0.1em", color: "#8fae9d", marginTop: 2 },
  summaryDivider: {
    height: 1,
    background: "rgba(242,234,214,0.15)",
    margin: "18px 0 14px",
  },
  summaryWeakest: { textAlign: "left" },
  summaryWeakestLabel: { fontSize: 10, letterSpacing: "0.14em", color: "#8fae9d", marginBottom: 4 },
  summaryWeakestValue: { fontSize: 16, fontWeight: 700, color: "#e08a90" },
  summaryWeakestSub: { fontSize: 12, color: "#c9dcd0", marginTop: 2 },
  summaryActions: {
    display: "flex",
    gap: 10,
    marginTop: 22,
  },
  summaryCopyButton: {
    flex: 1,
    background: "linear-gradient(180deg, #cba135, #a9822a)",
    color: "#0a2b21",
    border: "none",
    borderRadius: 10,
    padding: "11px 0",
    fontWeight: 700,
    fontSize: 13,
    fontFamily: "'JetBrains Mono', monospace",
  },
  summaryResetButton: {
    flex: 1,
    background: "transparent",
    color: "#f2ead6",
    border: "1px solid rgba(242,234,214,0.3)",
    borderRadius: 10,
    padding: "11px 0",
    fontWeight: 600,
    fontSize: 13,
    fontFamily: "'JetBrains Mono', monospace",
  },
  summaryHeatResetButton: {
    marginTop: 10,
    width: "100%",
    background: "transparent",
    border: "1px dashed rgba(242,234,214,0.25)",
    borderRadius: 10,
    padding: "9px 0",
    color: "#8fae9d",
    fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace",
  },
  summaryClose: {
    marginTop: 14,
    background: "transparent",
    border: "none",
    color: "#8fae9d",
    fontSize: 12,
    textDecoration: "underline",
    fontFamily: "'JetBrains Mono', monospace",
  },
  soundToggle: {
    position: "absolute",
    top: 18,
    right: 18,
    background: "rgba(0,0,0,0.25)",
    border: "1px solid rgba(242,234,214,0.15)",
    borderRadius: 10,
    padding: "6px 10px",
    fontSize: 16,
    lineHeight: 1,
    zIndex: 2,
  },
  panelSectionTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 15,
    fontWeight: 700,
    color: "#e6ddc6",
    textAlign: "center",
    marginBottom: 2,
  },
  panelDivider: {
    height: 1,
    width: "100%",
    background: "rgba(242,234,214,0.15)",
    margin: "10px 0 4px",
  },
  resetLink: {
    background: "transparent",
    border: "none",
    color: "#8fae9d",
    fontSize: 11,
    textDecoration: "underline",
    fontFamily: "'JetBrains Mono', monospace",
    padding: 0,
  },
  chartToggle: {
    marginTop: 26,
    background: "transparent",
    color: "#8fae9d",
    border: "1px solid rgba(242,234,214,0.2)",
    borderRadius: 20,
    padding: "8px 18px",
    fontSize: 11,
    letterSpacing: "0.08em",
    zIndex: 1,
  },
  chartPanel: {
    marginTop: 18,
    width: "100%",
    maxWidth: 560,
    display: "flex",
    flexDirection: "column",
    gap: 18,
    zIndex: 1,
  },
  chartBlock: { width: "100%" },
  chartTitle: { fontSize: 11, letterSpacing: "0.14em", color: "#8fae9d", marginBottom: 6 },
  chartGrid: {
    display: "grid",
    gridTemplateColumns: "34px repeat(10, 1fr)",
    gap: 2,
  },
  chartHeaderCell: {
    fontSize: 10,
    textAlign: "center",
    color: "#8fae9d",
    padding: "4px 0",
  },
  chartRowLabel: {
    fontSize: 10,
    color: "#c9dcd0",
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingRight: 4,
  },
  chartCell: {
    fontSize: 10,
    textAlign: "center",
    padding: "6px 0",
    borderRadius: 3,
    transition: "background 0.2s, box-shadow 0.2s",
  },
  legend: { display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "center", marginTop: 4 },
  legendItem: { display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#c9dcd0" },
  legendSwatch: { width: 12, height: 12, borderRadius: 3, display: "inline-block" },
};
