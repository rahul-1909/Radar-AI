"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useAppStore } from "@/lib/store";
import {
  ClipboardList,
  Search,
  FlaskConical,
  Zap,
  BarChart3,
  ShieldCheck,
  Clock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  RefreshCw,
  Radio,
  Layers,
} from "lucide-react";

interface AgentActivity {
  id: string;
  agent: string;
  status: string;
  startedAt: string;
  completedAt: string;
  duration: string;
  durationMs?: number;
  summary: string;
  output: Record<string, unknown>;
}

const agentIconMap: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  "Requirement Intelligence Agent": ClipboardList,
  "Code Analysis Agent": Search,
  "Test Generation Agent": FlaskConical,
  "Regression Optimization Agent": Zap,
  "Risk Prediction Agent": BarChart3,
  "CI/CD Gatekeeper Agent": ShieldCheck,
};

function formatTotalDuration(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function TimelinePage() {
  const { dashboard, dashboardLoading, dashboardError, loadDashboard, projectConfig, loadProjectInfo } = useAppStore();
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!dashboard && !dashboardLoading && !dashboardError) loadDashboard();
    if (!projectConfig) loadProjectInfo();
  }, [dashboard, dashboardLoading, dashboardError, loadDashboard, projectConfig, loadProjectInfo]);

  const timeline: AgentActivity[] = dashboard?.agentTimeline || [];
  const completedCount = timeline.filter(a => a.status === "completed").length;
  const totalDurationMs = timeline.reduce((sum, a) => sum + (a.durationMs || 0), 0);
  const totalDuration = dashboard?.pipelineDuration || formatTotalDuration(totalDurationMs);
  const projectName = dashboard?.project?.name || projectConfig?.name || "Radar Target";

  return (
    <div style={{ display: "flex" }}>
      <Sidebar />
      <main style={{ marginLeft: 286, padding: "32px 36px", flex: 1, width: "calc(100% - 286px)" }}>
        {/* Samsung One UI Viewing Area Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 28 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span className="badge" style={{ background: "rgba(59, 130, 246, 0.12)", color: "#60a5fa" }}>
                <Radio size={12} /> LANGGRAPH MULTI-AGENT STATEGRAPH
              </span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Target: {projectName}</span>
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em" }}>
              Agent Execution Pipeline
            </h1>
          </div>
          <button className="btn-primary" onClick={() => loadDashboard()} disabled={dashboardLoading}>
            <RefreshCw size={14} className={dashboardLoading ? "animate-spin" : ""} />
            {dashboardLoading ? "Running…" : "Re-trigger Pipeline"}
          </button>
        </div>

        {/* 3 Samsung One UI Stat Widgets */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
          <div className="stat-card">
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>Orchestrated Agents</div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>{timeline.length}</div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>LangGraph state nodes</div>
          </div>
          <div className="stat-card">
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>Pipeline Nodes Completed</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: "var(--accent-green)" }}>{completedCount} of {timeline.length}</div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>100% execution coverage</div>
          </div>
          <div className="stat-card">
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>End-to-End Latency</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: "var(--accent-blue)" }}>{totalDuration}</div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>From start to gatekeeper verdict</div>
          </div>
        </div>

        {dashboardLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {[1, 2, 3, 4].map(i => <div key={i} className="skeleton" style={{ height: 90 }} />)}
          </div>
        ) : timeline.length === 0 ? (
          <div className="glass-card" style={{ padding: 50, textAlign: "center" }}>
            <Layers size={32} color="var(--text-muted)" style={{ margin: "0 auto 14px" }} />
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>No Pipeline Telemetry Available</div>
            {dashboardError && <div style={{ fontSize: 12.5, color: "var(--accent-red)", marginBottom: 14 }}>{dashboardError}</div>}
            <button className="btn-primary" onClick={() => loadDashboard()}>
              <RefreshCw size={14} /> Run Radar Pipeline
            </button>
          </div>
        ) : (
          <div className="glass-card" style={{ padding: "28px" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {timeline.map((activity, index) => {
                const IconComponent = agentIconMap[activity.agent] || Cpu;
                const isOpen = expanded === activity.id;
                const isCompleted = activity.status === "completed";

                return (
                  <div key={activity.id} className="timeline-item">
                    <div className={`timeline-dot ${isCompleted ? "completed" : ""}`}>
                      {isCompleted
                        ? <CheckCircle2 size={12} color="#10b981" />
                        : <Clock size={12} color="var(--text-muted)" />
                      }
                    </div>

                    <div
                      style={{
                        padding: "18px 22px", cursor: "pointer",
                        background: "rgba(255, 255, 255, 0.02)", borderRadius: "18px",
                        border: "1px solid var(--border-color)",
                        transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                      }}
                      onClick={() => setExpanded(isOpen ? null : activity.id)}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{
                            width: 30, height: 30, borderRadius: "10px",
                            background: "rgba(59, 130, 246, 0.12)", display: "flex",
                            alignItems: "center", justifyContent: "center",
                          }}>
                            <IconComponent size={15} color="var(--accent-blue)" />
                          </div>
                          <span style={{ fontSize: 14, fontWeight: 700 }}>{activity.agent}</span>
                          <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>Node {index + 1} of {timeline.length}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
                            <Clock size={12} /> {activity.duration}
                          </span>
                          <span className={`badge ${isCompleted ? "badge-approved" : "badge-medium"}`}>
                            {activity.status.toUpperCase()}
                          </span>
                          {isOpen ? <ChevronUp size={16} color="var(--text-muted)" /> : <ChevronDown size={16} color="var(--text-muted)" />}
                        </div>
                      </div>

                      <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.55, marginBottom: 8 }}>
                        {activity.summary}
                      </p>

                      <div style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", gap: 16 }}>
                        <span>Initiated: {new Date(activity.startedAt).toLocaleTimeString()}</span>
                        <span>Completed: {new Date(activity.completedAt).toLocaleTimeString()}</span>
                      </div>

                      {isOpen && (
                        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border-color)" }}>
                          <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8, color: "var(--text-muted)", textTransform: "uppercase" }}>
                            Agent Output Payload
                          </div>
                          <pre className="code-block" style={{ maxHeight: 280 }}>
                            {JSON.stringify(activity.output, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{
              marginTop: 10, padding: "16px 20px", background: "rgba(255, 255, 255, 0.02)",
              borderRadius: "16px", border: "1px solid var(--border-color)",
              textAlign: "center", fontSize: 12.5, color: "var(--text-muted)",
            }}>
              RadarAI multi-agent graph finalized &middot; {timeline.length} nodes &middot; Total Latency: {totalDuration}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
