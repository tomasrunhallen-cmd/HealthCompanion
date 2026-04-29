"use client";

import { useCallback, useRef, useState } from "react";
import {
  Upload, Watch, LogOut, CheckCircle, AlertCircle, FileText,
} from "lucide-react";
import BottomNav from "@/components/BottomNav";
import { cn } from "@/lib/utils";
import {
  previewCSV, commitCSV, setupGarmin, syncGarmin, getGarminStatus,
  clearToken, type CSVPreviewResponse, type CSVImportResult, type GarminStatus,
} from "@/lib/api";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

// ── Section wrapper ───────────────────────────────────────────────────────────

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="font-semibold text-sm">{title}</h2>
      </div>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  );
}

// ── CSV Import section ────────────────────────────────────────────────────────

function CSVImportSection() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CSVPreviewResponse | null>(null);
  const [result, setResult] = useState<CSVImportResult | null>(null);
  const [onConflict, setOnConflict] = useState<"skip" | "overwrite" | "abort">("skip");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"pick" | "preview" | "done">("pick");

  const handleFile = useCallback(async (f: File) => {
    setFile(f);
    setError(null);
    setLoading(true);
    try {
      const prev = await previewCSV(f);
      setPreview(prev);
      setStep("preview");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Fel vid parsing");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (f && f.name.endsWith(".csv")) handleFile(f);
    },
    [handleFile]
  );

  async function handleCommit() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const r = await commitCSV(file, onConflict);
      setResult(r);
      setStep("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Import misslyckades");
    } finally {
      setLoading(false);
    }
  }

  if (step === "done" && result) {
    return (
      <SettingsSection title="CSV-import">
        <div className="text-center py-4">
          <CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-3" />
          <p className="font-medium">Import klar!</p>
          <div className="flex justify-center gap-4 mt-2 text-sm text-muted-foreground">
            <span className="text-green-600">+{result.inserted} nya</span>
            <span className="text-blue-600">↻{result.updated} uppdaterade</span>
            <span className="text-muted-foreground">{result.skipped} hoppade</span>
          </div>
          {result.errors.length > 0 && (
            <p className="text-xs text-destructive mt-2">{result.errors.length} fel</p>
          )}
          <button onClick={() => { setStep("pick"); setFile(null); setPreview(null); setResult(null); }}
            className="mt-4 text-sm text-primary underline">
            Importera ny fil
          </button>
        </div>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title="CSV-import">
      {step === "pick" && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:border-primary transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm font-medium">Dra och släpp CSV-fil</p>
          <p className="text-xs text-muted-foreground mt-1">eller klicka för att välja</p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </div>
      )}

      {loading && (
        <div className="text-center py-4 text-sm text-muted-foreground">Bearbetar...</div>
      )}

      {step === "preview" && preview && !loading && (
        <div className="space-y-3">
          <div className="flex gap-3 text-sm">
            <span className="text-green-600">{preview.parseable_rows} rader OK</span>
            {preview.parse_errors.length > 0 && (
              <span className="text-destructive">{preview.parse_errors.length} fel/varningar</span>
            )}
          </div>

          {preview.parse_errors.length > 0 && (
            <div className="bg-muted rounded-lg p-3 max-h-32 overflow-y-auto space-y-1">
              {preview.parse_errors.map((e, i) => (
                <p key={i} className="text-xs text-muted-foreground">
                  {e.row ? `Rad ${e.row}: ` : ""}{e.error || e.warning}
                </p>
              ))}
            </div>
          )}

          {preview.preview.length > 0 && (
            <div className="bg-muted rounded-lg p-3 max-h-48 overflow-y-auto space-y-1">
              <p className="text-xs font-medium mb-2">Förhandsgranskning (max 50 rader)</p>
              {preview.preview.map((row) => (
                <div key={row.row_number} className="flex items-center gap-2 text-xs">
                  <span className={row.already_exists ? "text-amber-500" : "text-green-600"}>
                    {row.already_exists ? "↻" : "+"}
                  </span>
                  <span className="font-medium">{row.date}</span>
                  {row.already_exists && <span className="text-muted-foreground">(finns redan)</span>}
                </div>
              ))}
            </div>
          )}

          {/* Conflict resolution */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">Vid dubbletter:</p>
            <div className="flex gap-2">
              {(["skip", "overwrite", "abort"] as const).map((opt) => (
                <button key={opt} onClick={() => setOnConflict(opt)}
                  className={cn("flex-1 h-9 rounded-lg text-xs transition-colors",
                    onConflict === opt ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  )}>
                  {opt === "skip" ? "Hoppa över" : opt === "overwrite" ? "Skriv över" : "Avbryt"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={() => { setStep("pick"); setFile(null); setPreview(null); }}
              className="flex-1 h-10 rounded-xl border border-border text-sm">
              Avbryt
            </button>
            <button onClick={handleCommit}
              className="flex-1 h-10 bg-primary text-primary-foreground rounded-xl text-sm font-medium">
              Importera {preview.parseable_rows} rader
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 bg-destructive/10 rounded-lg p-3 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}
    </SettingsSection>
  );
}

// ── Garmin section ────────────────────────────────────────────────────────────

function GarminSection() {
  const [status, setStatus] = useState<GarminStatus | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getGarminStatus().then(setStatus).catch(() => {});
  }, []);

  async function handleSetup() {
    setLoading(true); setError(null);
    try {
      await setupGarmin(username, password);
      const s = await getGarminStatus();
      setStatus(s);
      setShowSetup(false);
      setMessage("Garmin-credentials sparade");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Fel");
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    setSyncing(true); setError(null); setMessage(null);
    try {
      const r = await syncGarmin();
      setMessage(r.message);
      const s = await getGarminStatus();
      setStatus(s);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Sync misslyckades");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <SettingsSection title="Garmin Connect">
      <div className="flex items-center gap-3">
        <Watch className="w-8 h-8 text-muted-foreground" />
        <div className="flex-1">
          <p className="text-sm font-medium">
            {status?.credentials_configured ? "Ansluten" : "Ej ansluten"}
          </p>
          {status?.last_sync && (
            <p className="text-xs text-muted-foreground">
              Senast synkad: {new Date(status.last_sync).toLocaleString("sv-SE")}
            </p>
          )}
        </div>
      </div>

      {message && <p className="text-xs text-green-600">{message}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {status?.credentials_configured ? (
        <button
          onClick={handleSync}
          disabled={syncing}
          className="w-full h-10 bg-primary text-primary-foreground rounded-xl text-sm font-medium disabled:opacity-50"
        >
          {syncing ? "Synkar..." : "Synka nu (senaste 7 dagarna)"}
        </button>
      ) : (
        <button
          onClick={() => setShowSetup(!showSetup)}
          className="w-full h-10 border border-border rounded-xl text-sm"
        >
          Konfigurera Garmin
        </button>
      )}

      {showSetup && (
        <div className="space-y-2 pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground">
            Ditt lösenord lagras krypterat lokalt med Fernet AES-128.
          </p>
          <input
            type="email" placeholder="Garmin-användarnamn (e-post)"
            value={username} onChange={(e) => setUsername(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            type="password" placeholder="Garmin-lösenord"
            value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={handleSetup} disabled={loading || !username || !password}
            className="w-full h-10 bg-primary text-primary-foreground rounded-xl text-sm font-medium disabled:opacity-50"
          >
            {loading ? "Sparar..." : "Spara credentials"}
          </button>
        </div>
      )}
    </SettingsSection>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter();

  function handleLogout() {
    clearToken();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="sticky top-0 bg-background border-b border-border z-10 px-4 py-3">
        <h1 className="font-bold text-lg">Inställningar</h1>
      </div>

      <div className="px-4 py-4 space-y-4">
        <CSVImportSection />
        <GarminSection />

        {/* Export */}
        <SettingsSection title="Exportera data">
          <p className="text-sm text-muted-foreground">
            Exportera all data i samma CSV-format som ursprungsappen (du är aldrig låst).
          </p>
          <a
            href={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/diary/export`}
            className="w-full h-10 flex items-center justify-center gap-2 border border-border rounded-xl text-sm"
          >
            <FileText className="w-4 h-4" />
            Exportera som CSV
          </a>
        </SettingsSection>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="w-full h-12 flex items-center justify-center gap-2 border border-destructive/30 text-destructive rounded-xl text-sm"
        >
          <LogOut className="w-4 h-4" />
          Logga ut
        </button>
      </div>

      <BottomNav />
    </div>
  );
}
