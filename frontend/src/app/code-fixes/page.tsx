"use client";

import { useEffect, useRef, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useAppStore } from "@/lib/store";
import {
  Code2,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronUp,
  FileCode,
  ShieldAlert,
  TrendingDown,
  Shield,
  Copy,
  Check,
  Sparkles,
  GitBranch,
} from "lucide-react";
import Link from "next/link";

export default function CodeFixesPage() {
  const {
    codeFixes,
    codeFixesLoading,
    runCodeAnalysis,
    projectConfig,
    loadProjectInfo,
    aiInfo,
  } = useAppStore();

  const [expandedFix, setExpandedFix] = useState<number | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const hasFetchedFixes = useRef(false);
  const hasFetchedProject = useRef(false);

  useEffect(() => {
    if (!hasFetchedProject.current && !projectConfig) {
      hasFetchedProject.current = true;
      loadProjectInfo();
    }
  }, [projectConfig, loadProjectInfo]);

  useEffect(() => {
    if (!hasFetchedFixes.current && !codeFixes && !codeFixesLoading) {
      hasFetchedFixes.current = true;
      runCodeAnalysis(projectConfig?.repoUrl || undefined);
    }
  }, [codeFixes, codeFixesLoading, runCodeAnalysis, projectConfig]);

  const fixes = codeFixes?.fixes || [];
  const meta = codeFixes?.meta || {};
  const riskProjection = codeFixes?.riskProjection || null;
  const projectName = projectConfig?.name || "Radar Target";
  const hasRepoUrl = !!projectConfig?.repoUrl;

  const handleCopy = (index: number, code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 1800);
  };

  if (!hasRepoUrl) {
    return (
      <div style={{ display: "flex" }}>
        <Sidebar />
        <main style={{ marginLeft: 286, padding: "32px 36px", flex: 1, width: "calc(100% - 286px)" }}>
          <div style={{ marginBottom: 28 }}>
            <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 4 }}>Code Intelligence &amp; Fixes</h1>
            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
              Line-level automated fix generation powered by RadarAI
            </p>
          </div>
          <div className="glass-card" style={{ padding: 48, textAlign: "center", maxWidth: 540, margin: "40px auto 0" }}>
            <div style={{
              width: 52, height: 52, borderRadius: "18px",
              background: "rgba(245, 158, 11, 0.15)", display: "flex",
              alignItems: "center", justifyContent: "center", margin: "0 auto 16px",
            }}>
              <GitBranch size={26} color="var(--accent-amber)" />
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>GitHub Repository Required</div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 24, lineHeight: 1.6 }}>
              To correlate failing test assertions with source files and propose line-level fixes, RadarAI needs access to your project&apos;s GitHub repository.
            </p>
            <Link href="/">
              <button className="btn-primary">Configure Repository in Dashboard</button>
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div style={{ display: "flex" }}>
      <Sidebar />
      <main style={{ marginLeft: 286, padding: "32px 36px", flex: 1, width: "calc(100% - 286px)" }}>
        {/* Samsung One UI Viewing Area Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 28 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span className="badge" style={{ background: "rgba(59, 130, 246, 0.12)", color: "#60a5fa" }}>
                <Code2 size={12} /> RADAR REPAIR ENGINE
              </span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Target: {projectName}</span>
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em" }}>
              Code Intelligence &amp; Fixes
            </h1>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Link href="/">
              <button className="btn-secondary">
                <RefreshCw size={13} /> Re-scan After Fix
              </button>
            </Link>
            <button
              className="btn-primary"
              onClick={() => runCodeAnalysis(projectConfig?.repoUrl || undefined, true)}
              disabled={codeFixesLoading}
            >
              {codeFixesLoading ? (
                <><Loader2 size={14} className="animate-spin" /> Analyzing Code…</>
              ) : (
                <><Sparkles size={14} /> Re-Analyze Repository</>
              )}
            </button>
          </div>
        </div>

        {codeFixesLoading ? (
          <div className="glass-card" style={{ padding: 60, textAlign: "center" }}>
            <Loader2 size={32} color="var(--accent-blue)" className="animate-spin" style={{ margin: "0 auto 16px" }} />
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Analyzing Repository Source Structure…</div>
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
              Tracing failed checks to source files, identifying root causes, and formulating pull-request ready fixes.
            </div>
          </div>
        ) : codeFixes?.error ? (
          <div className="glass-card" style={{ padding: 48, textAlign: "center" }}>
            <ShieldAlert size={28} color="var(--accent-red)" style={{ margin: "0 auto 14px" }} />
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Analysis Encountered an Error</div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", maxWidth: 500, margin: "0 auto" }}>
              {codeFixes.message || "Unable to download or analyze repository files. Check repository access settings."}
            </p>
          </div>
        ) : fixes.length === 0 ? (
          <div className="glass-card" style={{ padding: 48, textAlign: "center" }}>
            <FileCode size={28} color="var(--text-muted)" style={{ margin: "0 auto 14px" }} />
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>No Source Remediation Required</div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              All tests are either passing or defects relate to server configuration rather than application source code.
            </p>
          </div>
        ) : (
          <>
            {/* 3 One UI Stat Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
              <div className="stat-card">
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>Files Inspected</div>
                <div style={{ fontSize: 28, fontWeight: 800 }}>{meta.filesAnalyzed}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>From {meta.totalRepoFiles} total repository files</div>
              </div>
              <div className="stat-card">
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>Targeted Fixes</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: "var(--accent-blue)" }}>{fixes.length}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>Targeting {meta.failedTests} test failures</div>
              </div>
              <div className="stat-card">
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>Intelligence Engine</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 18, fontWeight: 800, color: "var(--accent-violet)" }}>
                  <Sparkles size={18} /> {codeFixes.source === "ai" ? (aiInfo?.label || "AI Model") : "Deterministic Engine"}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>
                  Completed in {meta.pipelineDurationMs ? `${(meta.pipelineDurationMs / 1000).toFixed(1)}s` : "--"}
                </div>
              </div>
            </div>

            {/* Risk Projection Card */}
            {riskProjection && (
              <div className="glass-card" style={{
                padding: "22px 26px", marginBottom: 24,
                borderColor: "rgba(16, 185, 129, 0.35)",
                background: "rgba(16, 185, 129, 0.05)",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Shield size={18} color="var(--accent-green)" />
                    <span style={{ fontSize: 14, fontWeight: 700 }}>Release Risk Mitigation Projection</span>
                  </div>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Simulating application of all {fixes.length} fixes</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
                  <div style={{ textAlign: "center", minWidth: 90 }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: 2 }}>CURRENT RISK</div>
                    <div style={{
                      fontSize: 32, fontWeight: 800,
                      color: riskProjection.currentRiskScore >= 60 ? "var(--accent-red)" : "var(--accent-amber)",
                    }}>
                      {riskProjection.currentRiskScore}%
                    </div>
                  </div>

                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div className="progress-bar" style={{ height: 10, marginBottom: 8 }}>
                      <div className="progress-bar-fill" style={{
                        width: `${riskProjection.projectedRiskScore}%`,
                        background: "var(--accent-green)",
                      }} />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: "var(--accent-green)" }}>
                      <TrendingDown size={15} />
                      <span>−{riskProjection.totalReduction}% Projected Risk Reduction</span>
                    </div>
                  </div>

                  <div style={{ textAlign: "center", minWidth: 90 }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: 2 }}>PROJECTED RISK</div>
                    <div style={{ fontSize: 32, fontWeight: 800, color: "var(--accent-green)" }}>
                      {riskProjection.projectedRiskScore}%
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Fixes List */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {fixes.map((fix: { file: string; testTitle: string; explanation: string; diff?: string; codeSnippet?: string; language?: string; confidence?: number }, i: number) => {
                const isExpanded = expandedFix === i;
                const snippet = fix.diff || fix.codeSnippet || "";

                return (
                  <div
                    key={i}
                    className="glass-card"
                    style={{
                      padding: "20px 24px",
                      borderRadius: "20px",
                      borderColor: isExpanded ? "var(--border-hover)" : "var(--border-color)",
                      transition: "all 0.2s ease",
                    }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
                      onClick={() => setExpandedFix(isExpanded ? null : i)}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                          <span className="badge" style={{ background: "rgba(59, 130, 246, 0.15)", color: "#60a5fa" }}>
                            {fix.file}
                          </span>
                          {fix.confidence && (
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                              {Math.round(fix.confidence * 100)}% confidence
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
                          Resolves: {fix.testTitle}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        {isExpanded ? <ChevronUp size={18} color="var(--text-muted)" /> : <ChevronDown size={18} color="var(--text-muted)" />}
                      </div>
                    </div>

                    {isExpanded && (
                      <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border-color)", display: "flex", flexDirection: "column", gap: 14 }}>
                        <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                          {fix.explanation}
                        </p>
                        {snippet && (
                          <div>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>
                                Suggested Remediation Diff
                              </span>
                              <button
                                onClick={() => handleCopy(i, snippet)}
                                style={{
                                  background: "none", border: "none", color: "var(--accent-blue)",
                                  cursor: "pointer", fontSize: 11.5, display: "flex", alignItems: "center", gap: 4,
                                }}
                              >
                                {copiedIndex === i ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy Diff</>}
                              </button>
                            </div>
                            <pre className="code-block">{snippet}</pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
