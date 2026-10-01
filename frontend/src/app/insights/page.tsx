"use client";

import { useEffect, useRef, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useAppStore } from "@/lib/store";
import {
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Zap,
  BarChart3,
  Timer,
  Gauge,
  ThumbsUp,
  ThumbsDown,
  Clock,
  Activity,
  Award,
  ArrowRight,
  Sparkles,
} from "lucide-react";

interface RiskFactor {
  name: string;
  score: number;
  weight: number;
  description: string;
  failCount: number;
  totalTests: number;
  severity: string;
  issues: string[];
}

interface DetailedRecommendation {
  text: string;
  priority: string;
  category: string;
  effort: string;
}

interface TrendEntry {
  label: string;
  score: number;
  level: string;
  timestamp: string;
}

interface TrendData {
  entries: TrendEntry[];
  direction: string;
  avgScore: number;
  minScore: number;
  maxScore: number;
  totalRuns: number;
}

interface CategoryBreakdown {
  name: string;
  passed: number;
  failed: number;
  total: number;
  passRate: number;
}

function severityColor(severity: string) {
  switch (severity) {
    case "critical": return "var(--accent-red)";
    case "high": return "#f97316";
    case "medium": return "var(--accent-amber)";
    case "low": return "var(--accent-green)";
    default: return "var(--text-muted)";
  }
}

function levelColor(level: string) {
  switch (level) {
    case "high": return "var(--accent-red)";
    case "medium": return "var(--accent-amber)";
    case "low": return "var(--accent-green)";
    default: return "var(--text-muted)";
  }
}

function priorityBadge(priority: string) {
  const colors: Record<string, string> = {
    critical: "rgba(239, 68, 68, 0.15)",
    high: "rgba(249, 115, 22, 0.15)",
    medium: "rgba(245, 158, 11, 0.15)",
    low: "rgba(16, 185, 129, 0.15)",
  };
  const textColors: Record<string, string> = {
    critical: "var(--accent-red)",
    high: "#f97316",
    medium: "var(--accent-amber)",
    low: "var(--accent-green)",
  };
  return { bg: colors[priority] || colors.medium, color: textColors[priority] || textColors.medium };
}

function effortLabel(effort: string) {
  return effort === "low" ? "Quick fix" : effort === "high" ? "Major effort" : "Moderate effort";
}

export default function InsightsPage() {
  const {
    riskReport, riskLoading, riskError, runRiskPrediction,
    dashboard, loadDashboard,
    projectConfig, loadProjectInfo,
    metrics, loadMetrics, submitFeedback,
  } = useAppStore();

  const [expandedFactors, setExpandedFactors] = useState<Set<number>>(new Set());
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [feedbackSent, setFeedbackSent] = useState<string | null>(null);
  const [feedbackResult, setFeedbackResult] = useState<string | null>(null);

  const initialLoad = useRef(false);
  useEffect(() => {
    if (initialLoad.current) return;
    initialLoad.current = true;
    const state = useAppStore.getState();
    if (!state.riskReport) runRiskPrediction();
    if (!state.dashboard && !state.dashboardLoading) loadDashboard();
    if (!state.projectConfig) loadProjectInfo();
    if (!state.metrics) loadMetrics();
  }, [runRiskPrediction, loadDashboard, loadProjectInfo, loadMetrics]);

  const handleFeedback = async (outcome: 'smooth' | 'minor' | 'major') => {
    setFeedbackSent(outcome);
    const predictionId = dashboard?.predictionId || 'latest';
    const result = await submitFeedback(predictionId, outcome);
    if (result) {
      setFeedbackResult(result.correct ? 'Prediction aligned with deployment outcome ✓' : 'Prediction feedback recorded ✗');
    }
  };

  const risk = riskReport?.risk;
  const gatekeeper = riskReport?.gatekeeper;
  const trend: TrendData | null = riskReport?.trend || null;
  const testSummary = riskReport?.testSummary;
  const projectName = dashboard?.project?.name || projectConfig?.name || "Radar Target";

  const factors: RiskFactor[] = risk?.factors || [];
  const detailedRecs: DetailedRecommendation[] = risk?.detailedRecommendations || [];
  const recommendations: string[] = risk?.recommendations || [];
  const categoryBreakdown: CategoryBreakdown[] = risk?.categoryBreakdown || [];

  const toggleFactor = (i: number) => {
    setExpandedFactors(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <div style={{ display: "flex" }}>
      <Sidebar />
      <main style={{ marginLeft: 286, padding: "32px 36px", flex: 1, width: "calc(100% - 286px)" }}>
        {/* Samsung One UI Viewing Area Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 28 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span className="badge" style={{ background: "rgba(139, 92, 246, 0.12)", color: "#c084fc" }}>
                <Sparkles size={12} /> RELEASE DIAGNOSTICS &amp; HEALTH
              </span>
              {trend && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Cycle #{trend.totalRuns}</span>}
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em" }}>
              Release Insights &amp; Health
            </h1>
          </div>
          <button
            className="btn-primary"
            onClick={() => runRiskPrediction()}
            disabled={riskLoading}
          >
            <RefreshCw size={14} className={riskLoading ? "animate-spin" : ""} />
            {riskLoading ? "Analyzing..." : "Re-evaluate Health"}
          </button>
        </div>

        {riskLoading ? (
          <div className="glass-card" style={{ padding: 60, textAlign: "center" }}>
            <Loader2 size={32} color="var(--accent-blue)" className="animate-spin" style={{ margin: "0 auto 16px" }} />
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Computing Full Risk Diagnostics…</div>
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Analyzing crawler results, API tests, and deterministic risk weights.</div>
          </div>
        ) : !risk ? (
          <div className="glass-card" style={{ padding: 60, textAlign: "center" }}>
            <BarChart3 size={36} color="var(--text-muted)" style={{ margin: "0 auto 16px" }} />
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>{riskError ? "Analysis Interrupted" : "No Analysis Generated"}</div>
            <div style={{ fontSize: 13, color: riskError ? "var(--accent-red)" : "var(--text-muted)", marginBottom: 20, maxWidth: 440, margin: "0 auto 20px" }}>
              {riskError || "Execute a Radar quality assessment to generate multi-dimensional release health insights."}
            </div>
            <button className="btn-primary" onClick={() => runRiskPrediction()}>
              <Zap size={14} /> Run Analysis
            </button>
          </div>
        ) : (
          <>
            {/* 4 Samsung One UI Widget Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
              {/* Risk Score */}
              <div className="stat-card" style={{ textAlign: "center" }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Risk Score</div>
                <div style={{ fontSize: 36, fontWeight: 800, color: levelColor(risk.riskLevel), lineHeight: 1 }}>{risk.riskScore}</div>
                <div style={{ fontSize: 12, color: levelColor(risk.riskLevel), fontWeight: 700, marginTop: 6, textTransform: "uppercase" }}>{risk.riskLevel} risk</div>
              </div>

              {/* Pass Rate */}
              {testSummary && (
                <div className="stat-card" style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Test Pass Rate</div>
                  <div style={{ fontSize: 36, fontWeight: 800, color: testSummary.passRate >= 80 ? "var(--accent-green)" : testSummary.passRate >= 60 ? "var(--accent-amber)" : "var(--accent-red)", lineHeight: 1 }}>
                    {testSummary.passRate}%
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>{testSummary.passed} of {testSummary.total} checks</div>
                </div>
              )}

              {/* Trend */}
              {trend && (
                <div className="stat-card" style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Historical Trend</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 4 }}>
                    {trend.direction === "improving" && <TrendingDown size={24} color="var(--accent-green)" />}
                    {trend.direction === "worsening" && <TrendingUp size={24} color="var(--accent-red)" />}
                    {trend.direction === "stable" && <Minus size={24} color="var(--accent-amber)" />}
                    <span style={{
                      fontSize: 22, fontWeight: 800,
                      color: trend.direction === "improving" ? "var(--accent-green)" : trend.direction === "worsening" ? "var(--accent-red)" : "var(--accent-amber)",
                    }}>
                      {trend.direction === "improving" ? "Improving" : trend.direction === "worsening" ? "Worsening" : "Stable"}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6 }}>Avg: {trend.avgScore} &middot; Range: {trend.minScore}–{trend.maxScore}</div>
                </div>
              )}

              {/* Issues */}
              <div className="stat-card" style={{ textAlign: "center" }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Issues Detected</div>
                <div style={{ fontSize: 36, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1 }}>
                  {factors.reduce((s, f) => s + f.failCount, 0)}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
                  across {factors.length} audit domains
                </div>
              </div>
            </div>

            {/* Gatekeeper Decision Banner */}
            {gatekeeper && (
              <div className="glass-card" style={{
                padding: "24px 28px", marginBottom: 24,
                borderColor: gatekeeper.decision === "BLOCKED" ? "rgba(239, 68, 68, 0.35)" : "rgba(16, 185, 129, 0.35)",
                background: gatekeeper.decision === "BLOCKED" ? "rgba(239, 68, 68, 0.05)" : "rgba(16, 185, 129, 0.05)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: "16px",
                    background: gatekeeper.decision === "BLOCKED" ? "rgba(239, 68, 68, 0.15)" : "rgba(16, 185, 129, 0.15)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {gatekeeper.decision === "BLOCKED"
                      ? <ShieldAlert size={24} color="var(--accent-red)" />
                      : <ShieldCheck size={24} color="var(--accent-green)" />
                    }
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em" }}>
                      Gate Decision: DEPLOYMENT {gatekeeper.decision}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                      {projectName} &middot; Risk Score: {gatekeeper.riskScore}/100 &middot; {gatekeeper.riskLevel?.toUpperCase()}
                    </div>
                  </div>
                </div>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.65, marginBottom: 16 }}>
                  {gatekeeper.reasoning}
                </p>
                {gatekeeper.conditions?.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                      {gatekeeper.decision === "BLOCKED"
                        ? <><AlertTriangle size={15} color="var(--accent-red)" /> Release Blockers to Resolve ({gatekeeper.conditions.length})</>
                        : <><CheckCircle2 size={15} color="var(--accent-green)" /> Release Verification Checklist ({gatekeeper.conditions.length})</>
                      }
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {gatekeeper.conditions.map((cond: string, i: number) => (
                        <div key={i} style={{
                          display: "flex", alignItems: "flex-start", gap: 10,
                          padding: "10px 16px", background: "rgba(255, 255, 255, 0.02)",
                          borderRadius: "12px", border: "1px solid var(--border-color)",
                          fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5,
                        }}>
                          <span style={{
                            color: gatekeeper.decision === "BLOCKED" ? "var(--accent-red)" : "var(--accent-green)",
                            fontWeight: 700, flexShrink: 0, marginTop: 1,
                          }}>
                            #{i + 1}
                          </span>
                          <span>{cond}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Risk Breakdown by Category */}
            <div className="glass-card" style={{ padding: "26px", marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700 }}>Weighted Risk Dimensions</h2>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{factors.length} categories analyzed</span>
              </div>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>{risk?.formula}</p>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {factors.map((factor: RiskFactor, i: number) => {
                  const isExpanded = expandedFactors.has(i);
                  const barColor = severityColor(factor.severity);
                  return (
                    <div key={i} style={{
                      border: "1px solid var(--border-color)", borderRadius: "18px",
                      overflow: "hidden", background: "rgba(255, 255, 255, 0.02)",
                    }}>
                      <div
                        style={{
                          display: "flex", alignItems: "center", gap: 12, padding: "14px 18px",
                          cursor: factor.issues?.length > 0 ? "pointer" : "default",
                        }}
                        onClick={() => factor.issues?.length > 0 && toggleFactor(i)}
                      >
                        {factor.issues?.length > 0 && (
                          isExpanded
                            ? <ChevronDown size={16} color="var(--text-muted)" />
                            : <ChevronRight size={16} color="var(--text-muted)" />
                        )}
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <span style={{ fontSize: 14, fontWeight: 700 }}>{factor.name}</span>
                              <span className="badge" style={{
                                background: severityColor(factor.severity) + "22",
                                color: severityColor(factor.severity),
                                fontSize: 10,
                              }}>
                                {factor.severity}
                              </span>
                              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                                Weight: {Math.round(factor.weight * 100)}%
                              </span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                                {factor.failCount}/{factor.totalTests} failed
                              </span>
                              <span style={{ fontSize: 15, fontWeight: 800, color: barColor }}>{factor.score}%</span>
                            </div>
                          </div>
                          <div className="progress-bar" style={{ height: 6 }}>
                            <div className="progress-bar-fill" style={{
                              width: `${factor.score}%`, background: barColor,
                            }} />
                          </div>
                          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
                            {factor.description}
                          </div>
                        </div>
                      </div>

                      {isExpanded && factor.issues?.length > 0 && (
                        <div style={{
                          borderTop: "1px solid var(--border-color)",
                          padding: "12px 18px 14px",
                          background: "rgba(0, 0, 0, 0.15)",
                        }}>
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8 }}>
                            Specific Check Failures ({factor.issues.length})
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {factor.issues.map((issue, j) => (
                              <div key={j} style={{
                                display: "flex", alignItems: "center", gap: 8,
                                fontSize: 12, color: "var(--text-secondary)",
                              }}>
                                <span style={{ color: barColor, flexShrink: 0 }}>●</span>
                                <span>{issue}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Category Breakdown Rings */}
            {categoryBreakdown.length > 0 && (
              <div className="glass-card" style={{ padding: "26px", marginBottom: 24 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 18 }}>Pass Rate by Inspection Domain</h2>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
                  {categoryBreakdown.map((cat, i) => {
                    const isSelected = selectedCategory === cat.name;
                    return (
                      <div key={i}
                        onClick={() => setSelectedCategory(isSelected ? null : cat.name)}
                        style={{
                          padding: "16px", borderRadius: "18px",
                          background: isSelected ? "rgba(59, 130, 246, 0.12)" : "rgba(255, 255, 255, 0.02)",
                          border: `1px solid ${isSelected ? "rgba(59, 130, 246, 0.4)" : "var(--border-color)"}`,
                          cursor: "pointer", transition: "all 0.2s ease",
                          textAlign: "center",
                        }}>
                        <div style={{ position: "relative", width: 52, height: 52, margin: "0 auto 10px" }}>
                          <svg width="52" height="52" viewBox="0 0 52 52">
                            <circle cx="26" cy="26" r="22" fill="none" stroke="rgba(255, 255, 255, 0.08)" strokeWidth="5" />
                            <circle cx="26" cy="26" r="22" fill="none"
                              stroke={cat.passRate >= 80 ? "var(--accent-green)" : cat.passRate >= 50 ? "var(--accent-amber)" : "var(--accent-red)"}
                              strokeWidth="5"
                              strokeDasharray={`${(cat.passRate / 100) * 138.2} 138.2`}
                              strokeLinecap="round"
                              transform="rotate(-90 26 26)"
                            />
                          </svg>
                          <div style={{
                            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 12, fontWeight: 800,
                            color: cat.passRate >= 80 ? "var(--accent-green)" : cat.passRate >= 50 ? "var(--accent-amber)" : "var(--accent-red)",
                          }}>
                            {cat.passRate}%
                          </div>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{cat.name}</div>
                        <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                          <span style={{ color: "var(--accent-green)" }}>{cat.passed} passed</span>
                          {" &middot; "}
                          <span style={{ color: cat.failed > 0 ? "var(--accent-red)" : "var(--text-muted)" }}>{cat.failed} failed</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Risk Trend Chart */}
            {trend && trend.entries.length > 0 && (
              <div className="glass-card" style={{ padding: "26px", marginBottom: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                  <h2 style={{ fontSize: 16, fontWeight: 700 }}>Quality &amp; Risk Trend History</h2>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="badge" style={{
                      background: trend.direction === "improving" ? "rgba(16, 185, 129, 0.15)" : trend.direction === "worsening" ? "rgba(239, 68, 68, 0.15)" : "rgba(245, 158, 11, 0.15)",
                      color: trend.direction === "improving" ? "#34d399" : trend.direction === "worsening" ? "#f87171" : "#fbbf24",
                    }}>
                      {trend.direction.toUpperCase()} OVER {trend.totalRuns} RUNS
                    </span>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 160, padding: "0 10px" }}>
                  {trend.entries.map((entry, i) => {
                    const barHeight = Math.max(12, (entry.score / Math.max(trend.maxScore, 1)) * 130);
                    const barColor = levelColor(entry.level);
                    const isCurrent = i === trend.entries.length - 1;
                    return (
                      <div key={i} style={{
                        flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                        opacity: isCurrent ? 1 : 0.65,
                      }}>
                        <span style={{ fontSize: 11, fontWeight: isCurrent ? 800 : 600, color: barColor }}>{entry.score}</span>
                        <div style={{
                          width: "100%", maxWidth: 48, height: barHeight,
                          background: barColor,
                          borderRadius: "8px 8px 0 0",
                          boxShadow: isCurrent ? `0 0 14px ${barColor}66` : "none",
                          transition: "height 0.4s ease",
                        }} />
                        <span style={{
                          fontSize: 10, color: "var(--text-muted)",
                          fontWeight: isCurrent ? 700 : 500,
                          textAlign: "center",
                          maxWidth: 70, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {entry.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Mitigation Strategy */}
            {(detailedRecs.length > 0 || recommendations.length > 0) && (
              <div className="glass-card" style={{ padding: "26px", marginBottom: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                  <h2 style={{ fontSize: 16, fontWeight: 700 }}>Targeted Mitigation Steps</h2>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {detailedRecs.length || recommendations.length} prioritized actions
                  </span>
                </div>

                {detailedRecs.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {detailedRecs.map((rec, i) => {
                      const badge = priorityBadge(rec.priority);
                      return (
                        <div key={i} style={{
                          padding: "14px 18px", background: "rgba(255, 255, 255, 0.02)",
                          borderRadius: "16px", border: "1px solid var(--border-color)",
                          display: "flex", alignItems: "flex-start", gap: 14,
                        }}>
                          <div style={{
                            width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            background: badge.bg, color: badge.color,
                            fontSize: 12, fontWeight: 800, marginTop: 1,
                          }}>
                            {i + 1}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.5, marginBottom: 6 }}>
                              {rec.text}
                            </div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <span className="badge" style={{ background: badge.bg, color: badge.color, fontSize: 10 }}>
                                {rec.priority}
                              </span>
                              <span className="badge" style={{ background: "rgba(59, 130, 246, 0.1)", color: "#60a5fa", fontSize: 10 }}>
                                {rec.category}
                              </span>
                              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                                {effortLabel(rec.effort)}
                              </span>
                            </div>
                          </div>
                          <ArrowRight size={16} color="var(--text-muted)" style={{ flexShrink: 0, marginTop: 4 }} />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {recommendations.map((rec: string, i: number) => (
                      <div key={i} style={{
                        padding: "12px 18px", background: "rgba(255, 255, 255, 0.02)",
                        borderRadius: "14px", border: "1px solid var(--border-color)",
                        fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5,
                        display: "flex", gap: 10,
                      }}>
                        <span style={{ color: "var(--accent-blue)", fontWeight: 700, flexShrink: 0 }}>#{i + 1}</span>
                        <span>{rec}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Velocity & Automation Benefits */}
            {(metrics?.sprintVelocity || dashboard?.sprintVelocity) && (() => {
              const sv = metrics?.sprintVelocity || {};
              const latestRun = dashboard?.sprintVelocity || sv.runs?.[sv.runs?.length - 1];
              if (!latestRun && !sv.totalRuns) return null;
              return (
                <div className="glass-card" style={{ padding: "26px", marginBottom: 24 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                    <h2 style={{ fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                      <Timer size={18} color="var(--accent-blue)" /> Release Acceleration &amp; Velocity
                    </h2>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {sv.totalRuns || 1} pipeline run{(sv.totalRuns || 1) > 1 ? 's' : ''} tracked
                    </span>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 18 }}>
                    <div className="stat-card" style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 32, fontWeight: 800, color: "var(--accent-green)", lineHeight: 1 }}>
                        {latestRun?.velocityImprovement || sv.averageImprovement || 0}%
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6 }}>Velocity Gain vs Manual</div>
                    </div>
                    <div className="stat-card" style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 32, fontWeight: 800, color: "var(--accent-blue)", lineHeight: 1 }}>
                        {latestRun?.hoursSaved || sv.averageHoursSaved || 0}h
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6 }}>QA Engineering Saved</div>
                    </div>
                    <div className="stat-card" style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 32, fontWeight: 800, color: "var(--accent-amber)", lineHeight: 1 }}>
                        {latestRun?.speedMultiplier || 0}x
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6 }}>Execution Acceleration</div>
                    </div>
                    <div className="stat-card" style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 32, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1 }}>
                        {latestRun?.totalTests || sv.totalTestsRun || 0}
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6 }}>Automated Probes</div>
                    </div>
                  </div>

                  {/* Feedback Pill Buttons */}
                  <div style={{
                    padding: "16px 20px", background: "rgba(255, 255, 255, 0.02)",
                    borderRadius: "16px", border: "1px solid var(--border-color)",
                    display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14,
                  }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>How did the latest deployment perform?</div>
                      <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>RadarAI uses your feedback to fine-tune prediction calibration.</div>
                    </div>
                    {feedbackSent ? (
                      <div style={{ fontSize: 12.5, color: "var(--accent-green)", display: "flex", alignItems: "center", gap: 6 }}>
                        <CheckCircle2 size={16} /> Recorded: &quot;{feedbackSent}&quot;. {feedbackResult}
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => handleFeedback('smooth')} className="btn-secondary" style={{ fontSize: 12 }}>
                          <ThumbsUp size={13} color="var(--accent-green)" /> Smooth Deployment
                        </button>
                        <button onClick={() => handleFeedback('minor')} className="btn-secondary" style={{ fontSize: 12 }}>
                          <Minus size={13} color="var(--accent-amber)" /> Minor Issues
                        </button>
                        <button onClick={() => handleFeedback('major')} className="btn-secondary" style={{ fontSize: 12 }}>
                          <ThumbsDown size={13} color="var(--accent-red)" /> Incident Triggered
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </main>
    </div>
  );
}
