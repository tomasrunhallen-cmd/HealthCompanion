"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";
import { format, parseISO } from "date-fns";
import { sv } from "date-fns/locale";
import BottomNav from "@/components/BottomNav";
import { cn, todayISO } from "@/lib/utils";
import { getDiaryEntry, patchDiaryEntry, type DiaryEntry, type MoodLevel } from "@/lib/api";

// ── Mood level selector ───────────────────────────────────────────────────────

const MOOD_OPTIONS: { value: MoodLevel; label: string }[] = [
  { value: null, label: "–" },
  { value: "Balanserad", label: "Balanserad" },
  { value: "Lite", label: "Lite" },
  { value: "Mycket", label: "Mycket" },
];

function MoodSelector({
  label,
  value,
  onChange,
}: {
  label: string;
  value: MoodLevel;
  onChange: (v: MoodLevel) => void;
}) {
  return (
    <div className="mb-1">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="flex gap-2">
        {MOOD_OPTIONS.map((opt) => (
          <button
            key={String(opt.value)}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex-1 h-10 rounded-lg text-sm font-medium border transition-colors",
              value === opt.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted text-muted-foreground border-transparent hover:border-border"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Toggle button ─────────────────────────────────────────────────────────────

function ToggleField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
}) {
  const cycle = () => {
    if (value === null) onChange(true);
    else if (value === true) onChange(false);
    else onChange(null);
  };

  return (
    <button
      onClick={cycle}
      className={cn(
        "w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-colors touch-target",
        value === true && "bg-green-50 border-green-300 dark:bg-green-950 dark:border-green-700",
        value === false && "bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800 opacity-60",
        value === null && "bg-card border-border"
      )}
    >
      <span className="text-sm font-medium text-left">{label}</span>
      <span
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ml-2",
          value === true && "bg-green-500 text-white",
          value === false && "bg-red-400 text-white",
          value === null && "bg-muted text-muted-foreground"
        )}
      >
        {value === true ? "JA" : value === false ? "NEJ" : "–"}
      </span>
    </button>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 px-1">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type EntryField = keyof Omit<DiaryEntry, "id" | "mania_score" | "depression_score" | "garmin_data">;

export default function DiaryPage() {
  const [currentDate, setCurrentDate] = useState(todayISO());
  const [entry, setEntry] = useState<Partial<DiaryEntry>>({});
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isToday = currentDate === todayISO();

  // Load entry for current date
  useEffect(() => {
    setLoading(true);
    getDiaryEntry(currentDate)
      .then((e) => setEntry(e))
      .catch(() => setEntry({ date: currentDate }))
      .finally(() => setLoading(false));
  }, [currentDate]);

  // Debounced auto-save
  const autoSave = useCallback(
    (updated: Partial<DiaryEntry>) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        setSaving(true);
        try {
          const saved = await patchDiaryEntry(currentDate, updated);
          setEntry(saved);
          setSavedAt(new Date().toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }));
        } catch (e) {
          console.error("Auto-save failed:", e);
        } finally {
          setSaving(false);
        }
      }, 800);
    },
    [currentDate]
  );

  function setField<K extends EntryField>(key: K, value: DiaryEntry[K]) {
    const updated = { ...entry, [key]: value };
    setEntry(updated);
    autoSave({ [key]: value });
  }

  function changeDate(delta: number) {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + delta);
    const next = d.toISOString().split("T")[0];
    if (next <= todayISO()) setCurrentDate(next);
  }

  const b = (k: EntryField) => entry[k] as boolean | null;

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header */}
      <div className="sticky top-0 bg-background border-b border-border z-10 px-4 py-3">
        <div className="flex items-center justify-between">
          <button onClick={() => changeDate(-1)} className="touch-target flex items-center justify-center w-10 h-10 rounded-full hover:bg-muted">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="text-center">
            <div className="font-semibold text-sm">
              {format(parseISO(currentDate), "EEEE d MMMM", { locale: sv })}
            </div>
            {isToday && <div className="text-xs text-primary">Idag</div>}
          </div>
          <button
            onClick={() => changeDate(1)}
            disabled={isToday}
            className="touch-target flex items-center justify-center w-10 h-10 rounded-full hover:bg-muted disabled:opacity-30"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
        {/* Save indicator */}
        <div className="text-center mt-1 h-4">
          {saving ? (
            <span className="text-xs text-muted-foreground">Sparar...</span>
          ) : savedAt ? (
            <span className="text-xs text-green-500 flex items-center justify-center gap-1">
              <Check className="w-3 h-3" /> Sparad {savedAt}
            </span>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="text-muted-foreground text-sm">Laddar...</div>
        </div>
      ) : (
        <div className="px-4 py-4">
          {/* Humör */}
          <Section title="Humör">
            <MoodSelector label="Högt Humör" value={entry.mood_high ?? null} onChange={(v) => setField("mood_high", v)} />
            <MoodSelector label="Lågt Humör" value={entry.mood_low ?? null} onChange={(v) => setField("mood_low", v)} />
          </Section>

          {/* Skyddande beteenden */}
          <Section title="Skyddande beteenden">
            <ToggleField label="Medicin" value={b("medicin")} onChange={(v) => setField("medicin", v)} />
            <ToggleField label="Träning" value={b("traning")} onChange={(v) => setField("traning", v)} />
            <ToggleField label="Mindfulness" value={b("mindfulness")} onChange={(v) => setField("mindfulness", v)} />
            <ToggleField label="Bad / Kallbad" value={b("bad_kallbad")} onChange={(v) => setField("bad_kallbad", v)} />
            <ToggleField label="Utomhus på lunchen" value={b("utomhus_pa_lunchen")} onChange={(v) => setField("utomhus_pa_lunchen", v)} />
            <ToggleField label="Sluta jobb i tid" value={b("sluta_jobb_i_tid")} onChange={(v) => setField("sluta_jobb_i_tid", v)} />
            <ToggleField label="Jobba med 30 min timer" value={b("jobba_30min_timer")} onChange={(v) => setField("jobba_30min_timer", v)} />
            <ToggleField label="Använt SORK" value={b("anvant_sork")} onChange={(v) => setField("anvant_sork", v)} />
            <ToggleField label="Ett ekonomiskt hållbart val" value={b("ekonomiskt_hallbart_val")} onChange={(v) => setField("ekonomiskt_hallbart_val", v)} />
            <ToggleField label="Psykolog" value={b("psykolog")} onChange={(v) => setField("psykolog", v)} />
            <ToggleField label="Känner mig mindful" value={b("kanner_mig_mindful")} onChange={(v) => setField("kanner_mig_mindful", v)} />
          </Section>

          {/* Risk & avvikelse */}
          <Section title="Risk & avvikelse">
            <ToggleField label="Sömnavvikelse" value={b("somnavvikelse")} onChange={(v) => setField("somnavvikelse", v)} />
            <ToggleField label="Alkohol" value={b("alkohol")} onChange={(v) => setField("alkohol", v)} />
            <ToggleField label="Handlat mer än vanligt" value={b("handlat_mer_an_vanligt")} onChange={(v) => setField("handlat_mer_an_vanligt", v)} />
          </Section>

          {/* Depression / Ångest */}
          <Section title="Depression & ångest">
            <ToggleField label="Stress-symptom" value={b("stress_symptom")} onChange={(v) => setField("stress_symptom", v)} />
            <ToggleField label="Ångest" value={b("angest")} onChange={(v) => setField("angest", v)} />
            <ToggleField label="Stor oro" value={b("stor_oro")} onChange={(v) => setField("stor_oro", v)} />
          </Section>

          {/* Mani-indikatorer */}
          <Section title="Mani-indikatorer">
            <ToggleField label="Hög Energi" value={b("hog_energi")} onChange={(v) => setField("hog_energi", v)} />
            <ToggleField label="Allt Bara Funkar" value={b("allt_bara_funkar")} onChange={(v) => setField("allt_bara_funkar", v)} />
            <ToggleField label="Högt Engagemang" value={b("hogt_engagemang")} onChange={(v) => setField("hogt_engagemang", v)} />
            <ToggleField label="Energi flödar i kroppen" value={b("energi_flodar")} onChange={(v) => setField("energi_flodar", v)} />
            <ToggleField label="Många ideer på jobbet" value={b("manga_ideer")} onChange={(v) => setField("manga_ideer", v)} />
            <ToggleField label="Jag mår äntligen bra" value={b("jag_mar_antligen_bra")} onChange={(v) => setField("jag_mar_antligen_bra", v)} />
            <ToggleField label="Högt självförtroende" value={b("hogt_sjalvfortroende")} onChange={(v) => setField("hogt_sjalvfortroende", v)} />
            <ToggleField label="Ser sammanhang tydligt" value={b("ser_sammanhang")} onChange={(v) => setField("ser_sammanhang", v)} />
            <ToggleField label="Svårt att vänta när andra pratar" value={b("svart_att_vanta")} onChange={(v) => setField("svart_att_vanta", v)} />
            <ToggleField label="Lyssnar på hetsig och hög musik" value={b("lyssnar_hetsig_musik")} onChange={(v) => setField("lyssnar_hetsig_musik", v)} />
            <ToggleField label="Upplevd brådska för något" value={b("upplevd_bradska")} onChange={(v) => setField("upplevd_bradska", v)} />
            <ToggleField label="Upplevt starkt magstöd vid prat och sång" value={b("upplevt_magstodd")} onChange={(v) => setField("upplevt_magstodd", v)} />
            <ToggleField label="Dofter och färger är tydligare" value={b("dofter_tydligare")} onChange={(v) => setField("dofter_tydligare", v)} />
            <ToggleField label="Upplever att jag måste bromsa hjärnan" value={b("maste_bromsa_hjarnan")} onChange={(v) => setField("maste_bromsa_hjarnan", v)} />
            <ToggleField label="Handlat något ovanligt" value={b("handlat_ovanligt")} onChange={(v) => setField("handlat_ovanligt", v)} />
            <ToggleField label="Spontan ex inlägg på sociala medier" value={b("spontan_inlagg")} onChange={(v) => setField("spontan_inlagg", v)} />
            <ToggleField label="Jag är smartare än andra" value={b("jag_ar_smartare")} onChange={(v) => setField("jag_ar_smartare", v)} />
          </Section>

          {/* Kontext */}
          <Section title="Kontext">
            <ToggleField label="Nåt BRA har hänt" value={b("nat_bra_hant")} onChange={(v) => setField("nat_bra_hant", v)} />
            <ToggleField label="Nåt DÅLIGT har hänt" value={b("nat_daligt_hant")} onChange={(v) => setField("nat_daligt_hant", v)} />
            <ToggleField label="Social Aktivitet" value={b("social_aktivitet")} onChange={(v) => setField("social_aktivitet", v)} />
            <ToggleField label="Läkarbesök" value={b("lakarbesok")} onChange={(v) => setField("lakarbesok", v)} />
            <ToggleField label="Leta Efter Information" value={b("leta_efter_information")} onChange={(v) => setField("leta_efter_information", v)} />
          </Section>

          {/* Anteckningar */}
          <Section title="Anteckningar">
            <textarea
              value={entry.anteckningar ?? ""}
              onChange={(e) => setField("anteckningar", e.target.value || null)}
              placeholder="Hur var dagen? Tankar, händelser, känslor..."
              rows={5}
              className="w-full px-4 py-3 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </Section>

          {/* Score summary */}
          {(entry.mania_score !== undefined || entry.depression_score !== undefined) && (
            <div className="flex gap-3 mb-8">
              <div className="flex-1 bg-amber-50 dark:bg-amber-950 rounded-xl p-3 text-center">
                <div className="text-xs text-muted-foreground">Mani-score</div>
                <div className="text-2xl font-bold text-amber-600">{entry.mania_score ?? 0}/17</div>
              </div>
              <div className="flex-1 bg-indigo-50 dark:bg-indigo-950 rounded-xl p-3 text-center">
                <div className="text-xs text-muted-foreground">Depression-score</div>
                <div className="text-2xl font-bold text-indigo-600">{entry.depression_score ?? 0}/4</div>
              </div>
            </div>
          )}
        </div>
      )}

      <BottomNav />
    </div>
  );
}
