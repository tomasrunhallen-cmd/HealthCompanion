"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import BottomNav from "@/components/BottomNav";
import { getDiaryEntries, getGarminData, type DiaryEntry, type GarminData } from "@/lib/api";
import {
  cn, dateRangeISO, dayState, DAY_STATE_COLORS, DAY_STATE_LABELS, minsToHoursStr,
  type DayState,
} from "@/lib/utils";

const RANGES = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "365d", days: 365 },
];

const MOOD_NUM: Record<string, number> = {
  Balanserad: 0,
  Lite: 1,
  Mycket: 2,
};

// ── Heatmap calendar ──────────────────────────────────────────────────────────

function CalendarHeatmap({
  entries,
}: {
  entries: DiaryEntry[];
}) {
  const entryMap = new Map(entries.map((e) => [e.date, e]));

  // Build a 12-week grid of dates ending today
  const today = new Date();
  const dates: Date[] = [];
  for (let i = 83; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(d);
  }

  // Pad to start on a Monday
  const firstDay = dates[0].getDay(); // 0=Sun
  const padDays = firstDay === 0 ? 6 : firstDay - 1;
  const padded: (Date | null)[] = [...Array(padDays).fill(null), ...dates];

  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < padded.length; i += 7) {
    weeks.push(padded.slice(i, i + 7));
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-1 min-w-max">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {week.map((day, di) => {
              if (!day) return <div key={di} className="w-4 h-4" />;
              const iso = day.toISOString().split("T")[0];
              const entry = entryMap.get(iso);
              let state: DayState = "nodata";
              if (entry) state = dayState(entry.mania_score, entry.depression_score);
              const isToday = iso === today.toISOString().split("T")[0];
              return (
                <div
                  key={di}
                  title={`${iso}: ${DAY_STATE_LABELS[state]}`}
                  className={cn(
                    "w-4 h-4 rounded-sm transition-transform hover:scale-125 cursor-default",
                    isToday && "ring-2 ring-primary ring-offset-1"
                  )}
                  style={{ backgroundColor: DAY_STATE_COLORS[state] }}
                />
              );
            })}
          </div>
        ))}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-3">
        {(Object.entries(DAY_STATE_LABELS) as [DayState, string][]).map(([state, label]) => (
          <div key={state} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: DAY_STATE_COLORS[state] }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Last 7 days highlights ────────────────────────────────────────────────────

function RecentHighlights({ entries }: { entries: DiaryEntry[] }) {
  const recent = entries.slice(0, 7);

  return (
    <div className="space-y-2">
      {recent.map((e) => {
        const state = dayState(e.mania_score, e.depression_score);
        return (
          <div key={e.date} className="flex items-start gap-3 p-3 rounded-xl bg-card border border-border">
            <div
              className="w-2 h-full min-h-[40px] rounded-full shrink-0"
              style={{ backgroundColor: DAY_STATE_COLORS[state] }}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-sm font-medium">{e.date}</span>
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: DAY_STATE_COLORS[state] + "30", color: DAY_STATE_COLORS[state] }}>
                  {DAY_STATE_LABELS[state]}
                </span>
              </div>
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span>Mani: {e.mania_score}/17</span>
                <span>Depression: {e.depression_score}/4</span>
                {e.garmin_data?.total_sleep_minutes && (
                  <span>Sömn: {minsToHoursStr(e.garmin_data.total_sleep_minutes)}</span>
                )}
              </div>
              {e.anteckningar && (
                <p className="text-xs text-muted-foreground mt-1 truncate">{e.anteckningar}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Chart data builder ────────────────────────────────────────────────────────

function buildChartData(entries: DiaryEntry[], garmin: GarminData[]) {
  const garminMap = new Map(garmin.map((g) => [g.date, g]));
  return entries
    .slice()
    .reverse()
    .map((e) => {
      const g = garminMap.get(e.date);
      return {
        date: e.date.slice(5),  // MM-DD
        mani: e.mania_score,
        depression: e.depression_score,
        moodHigh: e.mood_high ? MOOD_NUM[e.mood_high] : null,
        moodLow: e.mood_low ? MOOD_NUM[e.mood_low] * -1 : null,
        sleep: g?.total_sleep_minutes ? Math.round(g.total_sleep_minutes / 60 * 10) / 10 : null,
        hrv: g?.hrv_last_night ?? null,
        stress: g?.avg_stress ?? null,
        hr: g?.resting_heart_rate ?? null,
      };
    });
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [rangeDays, setRangeDays] = useState(30);
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [garmin, setGarmin] = useState<GarminData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { from, to } = dateRangeISO(rangeDays);
    setLoading(true);
    Promise.all([
      getDiaryEntries({ date_from: from, date_to: to, limit: 400 }),
      getGarminData({ date_from: from, date_to: to }),
    ])
      .then(([d, g]) => { setEntries(d); setGarmin(g); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [rangeDays]);

  const chartData = buildChartData(entries, garmin);
  const hasGarmin = garmin.length > 0;

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="sticky top-0 bg-background border-b border-border z-10 px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="font-bold text-lg">Översikt</h1>
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button
                key={r.days}
                onClick={() => setRangeDays(r.days)}
                className={cn(
                  "px-3 py-1 rounded-lg text-sm transition-colors",
                  rangeDays === r.days
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 py-4 space-y-6">
        {loading ? (
          <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">Laddar...</div>
        ) : (
          <>
            {/* Heatmap calendar */}
            <section>
              <h2 className="font-semibold mb-3">Kalenderöversikt (84 dagar)</h2>
              <CalendarHeatmap entries={entries} />
            </section>

            {/* Mood + mania/depression chart */}
            <section>
              <h2 className="font-semibold mb-3">Stämning & mani-score</h2>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="mani" name="Mani" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls />
                    <Line type="monotone" dataKey="depression" name="Depression" stroke="#6366f1" strokeWidth={2} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* Sleep + HRV if Garmin data exists */}
            {hasGarmin && (
              <section>
                <h2 className="font-semibold mb-3">Sömn & HRV (Garmin)</h2>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="sleep" name="Sömn (h)" stroke="#22c55e" strokeWidth={2} dot={false} connectNulls />
                      <Line type="monotone" dataKey="hrv" name="HRV" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls />
                      <Line type="monotone" dataKey="stress" name="Stress" stroke="#ec4899" strokeWidth={2} dot={false} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}

            {/* Recent highlights */}
            <section>
              <h2 className="font-semibold mb-3">Senaste dagarna</h2>
              {entries.length === 0 ? (
                <p className="text-muted-foreground text-sm">Inga poster i valt intervall</p>
              ) : (
                <RecentHighlights entries={entries} />
              )}
            </section>
          </>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
