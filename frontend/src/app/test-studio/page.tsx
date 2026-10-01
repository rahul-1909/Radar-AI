"use client";

import { Fragment, useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useAppStore } from "@/lib/store";
import {
  Wrench,
  AlertTriangle,
  Globe,
  Monitor,
  Download,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  FlaskConical,
  Loader2,
  CheckCircle2,
  XCircle,
  Sparkles,
  Shield,
  Gauge,
  Accessibility,
  Rocket,
  Search,
  Copy,
  Check,
} from "lucide-react";

type TestType = "all" | "functional" | "api" | "ui" | "security" | "performance" | "accessibility" | "deployment";
type StatusFilter = "all" | "passed" | "failed";

interface TestResult {
  id: string;
  title: string;
  type: string;
  priority: string;
  passed: boolean | null;
  expected: string;
  actual: string;
  explanation: string;
  duration: number;
  steps?: string[];
  code?: string;
  aiGenerated?: boolean;
  source?: string;
}

const typeConfig: Record<string, { color: string; icon: React.ComponentType<{ size?: number; color?: string }> }> = {
  functional: { color: "var(--accent-blue)", icon: Wrench },
  edge: { color: "var(--accent-amber)", icon: AlertTriangle },
  api: { color: "var(--accent-cyan)", icon: Globe },
  ui: { color: "var(--accent-violet)", icon: Monitor },
  security: { color: "var(--accent-red)", icon: Shield },
  performance: { color: "var(--accent-amber)", icon: Gauge },
  accessibility: { color: "var(--accent-green)", icon: Accessibility },
  deployment: { color: "var(--accent-cyan)", icon: Rocket },
};

export default function TestStudioPage() {
  const { generatedTests, testsLoading, testsError, runTestGeneration, projectConfig, loadProjectInfo, dashboard } = useAppStore();
  const [filter, setFilter] = useState<TestType>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedTest, setExpandedTest] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!generatedTests && !testsLoading && !testsError) runTestGeneration();
    if (!projectConfig) loadProjectInfo();
  }, [generatedTests, testsLoading, testsError, runTestGeneration, projectConfig, loadProjectInfo]);

  const tests: TestResult[] = generatedTests?.generation?.tests || [];
  
  // Filtering logic
  const typeFiltered = filter === "all" ? tests : tests.filter(t => t.type === filter);
  const statusFiltered = statusFilter === "all" ? typeFiltered
    : statusFilter === "passed" ? typeFiltered.filter(t => t.passed === true)
    : typeFiltered.filter(t => t.passed === false || t.passed === null);

  const filteredTests = searchQuery.trim()
    ? statusFiltered.filter(t => 
        t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.explanation?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.expected?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.actual?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : statusFiltered;

  const summary = generatedTests?.summary || null;
  const projectName = generatedTests?.generation?.projectContext?.name || dashboard?.project?.name || projectConfig?.name || "Radar Target";
  const websiteUrl = generatedTests?.generation?.projectContext?.url || projectConfig?.websiteUrl || "";

  const realTests = tests.filter(t => !t.aiGenerated);
  const passed = realTests.filter(t => t.passed).length;
  const failed = realTests.filter(t => !t.passed).length;
  const total = realTests.length;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  const downloadTests = () => {
    const blob = new Blob([JSON.stringify(filteredTests, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `radar-tests-${projectName.replace(/\s+/g, "-").toLowerCase()}-${filter}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyCode = (id: string, code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const allTypes = [...new Set(tests.map(t => t.type))];
  const filterTabs: TestType[] = ["all", ...allTypes.filter(t => t !== "edge") as TestType[]];

  return (
    <div style={{ display: "flex" }}>
      <Sidebar />
      <main style={{ marginLeft: 286, padding: "32px 36px", flex: 1, width: "calc(100% - 286px)" }}>
        {/* Samsung One UI Viewing Area Header */}
        <div style={{ marginBottom: 28, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span className="badge" style={{ background: "rgba(59, 130, 246, 0.12)", color: "#60a5fa" }}>
                <FlaskConical size={12} /> RADAR TEST SUITE
              </span>
              {websiteUrl && (
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Target: {websiteUrl}
                </span>
              )}
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em" }}>
              Automated Test Studio
            </h1>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn-secondary" onClick={downloadTests}>
              <Download size={14} /> Export Results JSON
            </button>
            <button className="btn-primary" onClick={() => runTestGeneration()} disabled={testsLoading}>
              {testsLoading ? <><Loader2 size={14} className="animate-spin" /> Executing…</> : <><RefreshCw size={14} /> Re-execute Tests</>}
            </button>
          </div>
        </div>

        {/* Samsung One UI Status Banner */}
        {total > 0 && (
          <div className="glass-card" style={{
            marginBottom: 24, padding: "20px 26px",
            borderColor: passRate >= 80 ? "rgba(16, 185, 129, 0.35)" : passRate >= 60 ? "rgba(245, 158, 11, 0.35)" : "rgba(239, 68, 68, 0.35)",
            background: passRate >= 80 ? "rgba(16, 185, 129, 0.05)" : passRate >= 60 ? "rgba(245, 158, 11, 0.05)" : "rgba(239, 68, 68, 0.05)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{
                width: 44, height: 44, borderRadius: "16px",
                background: passRate >= 80 ? "rgba(16, 185, 129, 0.15)" : passRate >= 60 ? "rgba(245, 158, 11, 0.15)" : "rgba(239, 68, 68, 0.15)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {passRate >= 80 ? <CheckCircle2 size={24} color="#10b981" /> : passRate >= 60 ? <AlertTriangle size={24} color="#f59e0b" /> : <XCircle size={24} color="#ef4444" />}
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: passRate >= 80 ? "#10b981" : passRate >= 60 ? "#f59e0b" : "#ef4444" }}>
                  {passRate >= 80 ? "All Quality Baselines Healthy" : passRate >= 60 ? "Moderate Warnings Detected" : "Critical Test Failures"}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 2 }}>
                  {passed} of {total} verified checks passed &middot; {failed} failed
                  {summary?.totalDuration ? ` &middot; ${(summary.totalDuration / 1000).toFixed(1)}s elapsed` : ""}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <div style={{ width: 140 }}>
                <div className="progress-bar">
                  <div className="progress-bar-fill" style={{
                    width: `${passRate}%`,
                    background: passRate >= 80 ? "#10b981" : passRate >= 60 ? "#f59e0b" : "#ef4444",
                  }} />
                </div>
              </div>
              <div style={{ fontSize: 26, fontWeight: 800, color: passRate >= 80 ? "#10b981" : passRate >= 60 ? "#f59e0b" : "#ef4444" }}>
                {passRate}%
              </div>
            </div>
          </div>
        )}

        {/* 5 One UI Quick Stats Widgets */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 24 }}>
          <div className="stat-card" style={{ cursor: "pointer", borderColor: filter === "all" && statusFilter === "all" ? "var(--accent-blue)" : undefined }} onClick={() => { setFilter("all"); setStatusFilter("all"); }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>TOTAL CHECKS</div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{total}</div>
          </div>
          <div className="stat-card" style={{ cursor: "pointer", borderColor: statusFilter === "passed" ? "#10b981" : undefined }} onClick={() => setStatusFilter(statusFilter === "passed" ? "all" : "passed")}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>PASSED</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#10b981" }}>{passed}</div>
          </div>
          <div className="stat-card" style={{ cursor: "pointer", borderColor: statusFilter === "failed" ? "#ef4444" : undefined }} onClick={() => setStatusFilter(statusFilter === "failed" ? "all" : "failed")}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>FAILED</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#ef4444" }}>{failed}</div>
          </div>
          <div className="stat-card">
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>PASS RATIO</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: passRate >= 80 ? "#10b981" : passRate >= 60 ? "#f59e0b" : "#ef4444" }}>{passRate}%</div>
          </div>
          <div className="stat-card">
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>RUNTIME</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text-secondary)" }}>{summary?.totalDuration ? `${(summary.totalDuration / 1000).toFixed(1)}s` : "--"}</div>
          </div>
        </div>

        {/* Samsung One UI Search & Pill Filter Bar */}
        <div className="glass-card" style={{ padding: "18px 22px", marginBottom: 24, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{
              flex: 1, minWidth: 260, position: "relative", display: "flex", alignItems: "center",
            }}>
              <Search size={16} color="var(--text-muted)" style={{ position: "absolute", left: 14 }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by check name, error explanation, or expected condition…"
                style={{
                  width: "100%", padding: "10px 14px 10px 38px",
                  borderRadius: 9999, background: "var(--bg-input)",
                  border: "1px solid var(--border-color)", color: "var(--text-primary)",
                  fontSize: 13, outline: "none",
                }}
              />
            </div>
            <div className="oneui-tabs">
              <button
                className={`oneui-tab-btn ${statusFilter === "all" ? "active" : ""}`}
                onClick={() => setStatusFilter("all")}
              >
                All Status
              </button>
              <button
                className={`oneui-tab-btn ${statusFilter === "passed" ? "active" : ""}`}
                onClick={() => setStatusFilter("passed")}
              >
                Passed ({passed})
              </button>
              <button
                className={`oneui-tab-btn ${statusFilter === "failed" ? "active" : ""}`}
                onClick={() => setStatusFilter("failed")}
              >
                Failed ({failed})
              </button>
            </div>
          </div>

          {/* Test Type Pill Tabs */}
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
            {filterTabs.map((type) => {
              const count = type === "all" ? tests.length : tests.filter(t => t.type === type).length;
              const isActive = filter === type;
              return (
                <button
                  key={type}
                  onClick={() => setFilter(type)}
                  style={{
                    padding: "7px 16px",
                    borderRadius: 9999,
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    border: isActive ? "1px solid rgba(59, 130, 246, 0.4)" : "1px solid var(--border-color)",
                    background: isActive ? "rgba(59, 130, 246, 0.18)" : "rgba(255, 255, 255, 0.03)",
                    color: isActive ? "#60a5fa" : "var(--text-secondary)",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    whiteSpace: "nowrap",
                    transition: "all 0.2s ease",
                  }}
                >
                  <span style={{ textTransform: "capitalize" }}>{type}</span>
                  <span style={{
                    fontSize: 11, padding: "1px 6px", borderRadius: 9999,
                    background: isActive ? "rgba(59, 130, 246, 0.3)" : "rgba(255, 255, 255, 0.08)",
                  }}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Tests List */}
        {testsLoading && tests.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton" style={{ height: 70 }} />)}
          </div>
        ) : filteredTests.length === 0 ? (
          <div className="glass-card" style={{ padding: 48, textAlign: "center" }}>
            <FlaskConical size={32} color="var(--text-muted)" style={{ margin: "0 auto 12px" }} />
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>No matching tests found</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Adjust your filters or query to display results.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {filteredTests.map((test) => {
              const isExpanded = expandedTest === test.id;
              const config = typeConfig[test.type] || typeConfig.functional;
              const Icon = config.icon;
              const isPassed = test.passed === true;

              return (
                <div
                  key={test.id}
                  className="glass-card"
                  style={{
                    padding: "18px 22px",
                    borderRadius: "20px",
                    borderColor: isExpanded ? "var(--border-hover)" : "var(--border-color)",
                    transition: "all 0.2s ease",
                  }}
                >
                  {/* Test Item Header */}
                  <div
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
                    onClick={() => setExpandedTest(isExpanded ? null : test.id)}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0, flex: 1 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: "10px",
                        background: isPassed ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                      }}>
                        {isPassed ? <CheckCircle2 size={16} color="#10b981" /> : <XCircle size={16} color="#ef4444" />}
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 8 }}>
                          <span>{test.title}</span>
                          {test.aiGenerated && (
                            <span className="badge" style={{ background: "rgba(139, 92, 246, 0.15)", color: "#c084fc", fontSize: 10 }}>
                              <Sparkles size={10} /> AI Test
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ textTransform: "capitalize", color: config.color, fontWeight: 600 }}>{test.type}</span>
                          <span>&middot;</span>
                          <span style={{ textTransform: "uppercase" }}>{test.priority} Priority</span>
                          {test.duration > 0 && (
                            <>
                              <span>&middot;</span>
                              <span>{test.duration}ms</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                      <span className={`badge ${isPassed ? "badge-approved" : "badge-blocked"}`}>
                        {isPassed ? "PASSED" : "FAILED"}
                      </span>
                      {isExpanded ? <ChevronUp size={16} color="var(--text-muted)" /> : <ChevronDown size={16} color="var(--text-muted)" />}
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border-color)", display: "flex", flexDirection: "column", gap: 14 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                        <div style={{ padding: "12px 16px", borderRadius: "14px", background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border-color)" }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>
                            Expected Condition
                          </div>
                          <div style={{ fontSize: 12.5, color: "var(--text-primary)" }}>{test.expected}</div>
                        </div>
                        <div style={{ padding: "12px 16px", borderRadius: "14px", background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border-color)" }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>
                            Actual Outcome
                          </div>
                          <div style={{ fontSize: 12.5, color: isPassed ? "#10b981" : "#ef4444" }}>{test.actual}</div>
                        </div>
                      </div>

                      {test.explanation && (
                        <div style={{ padding: "14px 18px", borderRadius: "14px", background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border-color)" }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>
                            Diagnostic Evaluation
                          </div>
                          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.6 }}>{test.explanation}</div>
                        </div>
                      )}

                      {test.steps && test.steps.length > 0 && (
                        <div style={{ padding: "14px 18px", borderRadius: "14px", background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border-color)" }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8 }}>
                            Execution Steps
                          </div>
                          <ol style={{ paddingLeft: 18, fontSize: 12.5, color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 4 }}>
                            {test.steps.map((s, idx) => <li key={idx}>{s}</li>)}
                          </ol>
                        </div>
                      )}

                      {test.code && (
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>
                              Test Implementation Code
                            </span>
                            <button
                              onClick={() => handleCopyCode(test.id, test.code!)}
                              style={{
                                background: "none", border: "none", color: "var(--accent-blue)",
                                cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 4,
                              }}
                            >
                              {copiedId === test.id ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy Code</>}
                            </button>
                          </div>
                          <pre className="code-block">{test.code}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
