"use client";

import { useState } from "react";
import { Brain, RefreshCw, AlertTriangle, ChevronDown, ChevronUp, CheckCircle } from "lucide-react";
import BottomNav from "@/components/BottomNav";
import { cn, dateRangeISO, formatDate } from "@/lib/utils";
import { runAnalysis, type AnalysisResponse, type AnalysisReport } from "@/lib/api";

const PRESETS = [
  { label: "30 dagar", days: 30 },
  { label: "90 dagar", days: 90 },
  { label: "365 dagar", days: 365 },
];

// ── Collapsible section ───────────────────────────────────────────────────────

function CollapsibleSection({
  title,
  count,
  children,
  defaultOpen = true,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="font-semibold text-sm">
          {title}
          {count !== undefined && (
            <span className="ml-2 text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
              {count}
            </span>
          )}
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
}

// ── Pattern card ──────────────────────────────────────────────────────────────

function PatternCard({
  title,
  description,
  dates,
}: {
  title: string;
  description: string;
  dates?: string[];
}) {
  return (
    <div className="bg-muted/50 rounded-lg p-3">
      <div className="font-medium text-sm mb-1">{title}</div>
      <p className="text-sm text-muted-foreground">{description}</p>
      {dates && dates.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {dates.slice(0, 5).map((d) => (
            <span key={d} className="text-xs bg-background border border-border px-1.5 py-0.5 rounded">
              {d}
            </span>
          ))}
          {dates.length > 5 && (
            <span className="text-xs text-muted-foreground">+{dates.length - 5} till</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Warning card ──────────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<string, string> = {
  low: "border-yellow-300 bg-yellow-50 dark:bg-yellow-950",
  medium: "border-orange-400 bg-orange-50 dark:bg-orange-950",
  high: "border-red-500 bg-red-50 dark:bg-red-950",
};

function WarningCard({
  severity,
  description,
  recommendation,
}: {
  severity: string;
  description: string;
  recommendation: string;
}) {
  return (
    <div className={cn("rounded-xl border-2 p-3", SEVERITY_STYLES[severity] || SEVERITY_STYLES.medium)}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-orange-500" />
        <div>
          <p className="text-sm font-medium">{description}</p>
          <p className="text-xs text-muted-foreground mt-1">{recommendation}</p>
        </div>
      </div>
    </div>
  );
}

// ── Report view ───────────────────────────────────────────────────────────────

function ReportView({ data }: { data: AnalysisResponse }) {
  const r: AnalysisReport = data.report;

  return (
    <div className="space-y-4">
      {/* Meta */}
      <div className="bg-muted/50 rounded-xl p-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>Modell: {data.model_used}</span>
        <span>Tokens: {data.input_tokens.toLocaleString()}</span>
        {data.cached_tokens > 0 && <span className="text-green-600">Cache: {data.cached_tokens.toLocaleString()}</span>}
        {data.from_cache && <span className="text-blue-500">Från cache</span>}
        <span>Dagar: {r.filled_days}/{r.period_days}</span>
      </div>

      {/* Summary */}
      <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
        <p className="text-sm leading-relaxed">{r.summary}</p>
      </div>

      {/* Warnings first if any */}
      {r.warnings.length > 0 && (
        <CollapsibleSection title="Varningssignaler" count={r.warnings.length}>
          {r.warnings.map((w, i) => (
            <WarningCard key={i} severity={w.severity} description={w.description} recommendation={w.recommendation} />
          ))}
        </CollapsibleSection>
      )}

      {/* Early warnings */}
      {r.early_warning_signals.length > 0 && (
        <CollapsibleSection title="Tidiga varningssignaler" count={r.early_warning_signals.length}>
          {r.early_warning_signals.map((p, i) => (
            <PatternCard key={i} title={p.title} description={p.description} dates={p.supporting_dates} />
          ))}
        </CollapsibleSection>
      )}

      {/* Patterns */}
      {r.patterns.length > 0 && (
        <CollapsibleSection title="Identifierade mönster" count={r.patterns.length} defaultOpen={false}>
          {r.patterns.map((p, i) => (
            <PatternCard key={i} title={p.title} description={p.description} dates={p.supporting_dates} />
          ))}
        </CollapsibleSection>
      )}

      {/* Garmin correlations */}
      {r.garmin_correlations.length > 0 && (
        <CollapsibleSection title="Fysiologi & stämning (Garmin)" count={r.garmin_correlations.length} defaultOpen={false}>
          {r.garmin_correlations.map((p, i) => (
            <PatternCard key={i} title={p.title} description={p.description} dates={p.supporting_dates} />
          ))}
        </CollapsibleSection>
      )}

      {/* Protective factors */}
      {r.protective_factors.length > 0 && (
        <CollapsibleSection title="Skyddande faktorer" count={r.protective_factors.length} defaultOpen={false}>
          {r.protective_factors.map((p, i) => (
            <PatternCard key={i} title={p.title} description={p.description} dates={p.supporting_dates} />
          ))}
        </CollapsibleSection>
      )}

      {/* Recommendations */}
      {r.recommendations.length > 0 && (
        <CollapsibleSection title="Rekommendationer" count={r.recommendations.length}>
          {r.recommendations.map((rec, i) => (
            <div key={i} className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
              <p className="text-sm">{rec}</p>
            </div>
          ))}
        </CollapsibleSection>
      )}

      {/* Disclaimer */}
      {r.disclaimer && (
        <div className="bg-muted rounded-xl p-3 text-xs text-muted-foreground italic">
          {r.disclaimer}
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function AnalysisPage() {
  const [presetDays, setPresetDays] = useState(30);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResponse | null>(null);

  async function handleRun(forceRefresh = false) {
    setError(null);
    setLoading(true);
    try {
      let from: string, to: string;
      if (useCustom && customFrom && customTo) {
        from = customFrom; to = customTo;
      } else {
        const range = dateRangeISO(presetDays);
        from = range.from; to = range.to;
      }
      const res = await runAnalysis(from, to, forceRefresh);
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Okänt fel");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="sticky top-0 bg-background border-b border-border z-10 px-4 py-3">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-primary" />
          <h1 className="font-bold text-lg">AI-analys</h1>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Period selector */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="font-medium text-sm">Välj period</div>
          <div className="flex gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.days}
                onClick={() => { setPresetDays(p.days); setUseCustom(false); }}
                className={cn(
                  "flex-1 h-9 rounded-lg text-sm transition-colors",
                  !useCustom && presetDays === p.days
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setUseCustom(!useCustom)}
            className="text-xs text-primary underline"
          >
            {useCustom ? "Använd förval" : "Anpassad period"}
          </button>
          {useCustom && (
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground">Från</label>
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                  className="w-full mt-1 px-3 h-10 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div className="flex-1">
                <label className="text-xs text-muted-foreground">Till</label>
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                  className="w-full mt-1 px-3 h-10 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
            </div>
          )}

          <button
            onClick={() => handleRun(false)}
            disabled={loading}
            className="w-full h-12 bg-primary text-primary-foreground rounded-xl font-medium disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Analyserar... (kan ta 30–60s)
              </>
            ) : (
              <>
                <Brain className="w-4 h-4" />
                Analysera mönster
              </>
            )}
          </button>
          {result && !loading && (
            <button
              onClick={() => handleRun(true)}
              className="w-full text-xs text-muted-foreground underline"
            >
              Tvinga ny analys (ignorera cache)
            </button>
          )}
        </div>

        {error && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {result && !loading && <ReportView data={result} />}

        {!result && !loading && !error && (
          <div className="text-center text-muted-foreground text-sm py-12">
            <Brain className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>Välj en period och tryck "Analysera mönster"</p>
            <p className="text-xs mt-1">Claude analyserar dina dagboks- och Garmin-data och hittar mönster</p>
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
