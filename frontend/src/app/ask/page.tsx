"use client";

import { useEffect, useState, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import { useAppStore } from "@/lib/store";
import {
  Send,
  Loader2,
  FileCode2,
  User,
  Radio,
  GitBranch,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";

export default function AskPage() {
  const {
    chatHistory,
    chatLoading,
    askQuestion,
    projectConfig,
    loadProjectInfo,
  } = useAppStore();

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!projectConfig) loadProjectInfo();
  }, [projectConfig, loadProjectInfo]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, chatLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || chatLoading) return;
    askQuestion(input, projectConfig?.repoUrl || undefined);
    setInput("");
  };

  const hasRepoUrl = !!projectConfig?.repoUrl;
  const projectName = projectConfig?.name || "Target Codebase";

  if (!hasRepoUrl) {
    return (
      <div style={{ display: "flex", height: "100vh" }}>
        <Sidebar />
        <main style={{ marginLeft: 286, padding: "32px 36px", flex: 1, width: "calc(100% - 286px)", display: "flex", flexDirection: "column" }}>
          <div style={{ marginBottom: 28 }}>
            <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 4 }}>Ask Radar AI</h1>
            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
              Natural language repository query &amp; architectural intelligence
            </p>
          </div>
          <div className="glass-card" style={{ padding: 48, textAlign: "center", margin: "auto", maxWidth: 540 }}>
            <div style={{
              width: 52, height: 52, borderRadius: "18px",
              background: "rgba(245, 158, 11, 0.15)", display: "flex",
              alignItems: "center", justifyContent: "center", margin: "0 auto 16px",
            }}>
              <GitBranch size={26} color="var(--accent-amber)" />
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>GitHub Repository Required</div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 24, lineHeight: 1.6 }}>
              To inspect source code and answer deep questions regarding architecture, security, or failing components, RadarAI requires a connected GitHub repository.
            </p>
            <Link href="/">
              <button className="btn-primary">Connect Repository in Dashboard</button>
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <Sidebar />
      <main style={{ marginLeft: 286, padding: "32px 36px 20px", flex: 1, width: "calc(100% - 286px)", display: "flex", flexDirection: "column" }}>
        {/* Samsung One UI Viewing Area Header */}
        <div style={{ marginBottom: 20, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <span className="badge" style={{ background: "rgba(139, 92, 246, 0.12)", color: "#c084fc" }}>
              <Sparkles size={12} /> RADAR CONVERSATIONAL INTELLIGENCE
            </span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{projectName}</span>
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em" }}>
            Ask Radar AI
          </h1>
        </div>

        {/* Samsung One UI Chat Container */}
        <div className="glass-card" style={{
          flex: 1, display: "flex", flexDirection: "column",
          overflow: "hidden", marginBottom: 12, borderRadius: "28px",
        }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "28px", display: "flex", flexDirection: "column", gap: 24 }}>
            {chatHistory.length === 0 ? (
              <div style={{ margin: "auto", textAlign: "center", maxWidth: 540 }}>
                <div style={{
                  width: 54, height: 54, borderRadius: "18px",
                  background: "linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(139, 92, 246, 0.2))",
                  display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px",
                  boxShadow: "0 8px 24px rgba(59, 130, 246, 0.2)",
                }}>
                  <Radio size={26} color="var(--accent-blue)" />
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 8, letterSpacing: "-0.01em" }}>
                  Query Your Application Architecture
                </h3>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 24, lineHeight: 1.6 }}>
                  RadarAI indexes repository files, dependencies, routes, and risk hotspots to answer complex technical inquiries.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[
                    "What happens if third-party APIs or database connections fail?",
                    "Which endpoints or files handle authentication and session cookies?",
                    "Are there any security vulnerabilities in middleware or CORS configuration?",
                    "Explain the overall system architecture and critical user journeys."
                  ].map((q, i) => (
                    <button
                      key={i}
                      onClick={() => askQuestion(q, projectConfig?.repoUrl || undefined)}
                      style={{
                        padding: "14px 18px",
                        background: "rgba(255, 255, 255, 0.02)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "16px",
                        color: "var(--text-secondary)",
                        fontSize: 13,
                        textAlign: "left",
                        cursor: "pointer",
                        transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                      }}
                      onMouseOver={(e) => {
                        e.currentTarget.style.borderColor = "rgba(59, 130, 246, 0.5)";
                        e.currentTarget.style.background = "rgba(59, 130, 246, 0.08)";
                        e.currentTarget.style.color = "var(--text-primary)";
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.borderColor = "var(--border-color)";
                        e.currentTarget.style.background = "rgba(255, 255, 255, 0.02)";
                        e.currentTarget.style.color = "var(--text-secondary)";
                      }}
                    >
                      &quot;{q}&quot;
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              chatHistory.map((msg, i) => (
                <div key={i} style={{ display: "flex", gap: 14 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: "14px", flexShrink: 0,
                    background: msg.role === "user" ? "rgba(255, 255, 255, 0.06)" : "linear-gradient(135deg, #2563eb, #3b82f6)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    border: msg.role === "user" ? "1px solid var(--border-color)" : "none",
                    boxShadow: msg.role === "user" ? "none" : "0 4px 12px rgba(37, 99, 235, 0.3)",
                  }}>
                    {msg.role === "user" ? <User size={18} color="var(--text-secondary)" /> : <Radio size={18} color="white" />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6 }}>
                      {msg.role === "user" ? "You" : "RadarAI Intelligence"}
                    </div>
                    <div style={{
                      fontSize: 13.5, lineHeight: 1.65, color: "var(--text-primary)",
                      background: msg.role === "user" ? "rgba(255, 255, 255, 0.04)" : "rgba(19, 25, 39, 0.8)",
                      padding: "16px 20px", borderRadius: "20px",
                      border: "1px solid var(--border-color)",
                    }}>
                      <ReactMarkdown
                        components={{
                          code({ inline, children, ...props }: React.ComponentPropsWithoutRef<"code"> & { inline?: boolean }) {
                            return inline ? (
                              <code style={{ background: "rgba(59, 130, 246, 0.15)", color: "#93c5fd", padding: "2px 6px", borderRadius: 4, fontSize: "0.9em" }} {...props}>{children}</code>
                            ) : (
                              <pre style={{ background: "#0e1320", padding: 14, borderRadius: 12, overflowX: "auto", border: "1px solid var(--border-color)", marginTop: 10, marginBottom: 10 }}>
                                <code {...props}>{children}</code>
                              </pre>
                            );
                          }
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    </div>

                    {/* AI File References */}
                    {msg.role === "assistant" && msg.references && msg.references.length > 0 && (
                      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {msg.references.map((ref: { file: string; lines?: string }, refIdx: number) => (
                          <div key={refIdx} style={{
                            display: "flex", alignItems: "center", gap: 6,
                            padding: "6px 12px", background: "rgba(59, 130, 246, 0.12)",
                            border: "1px solid rgba(59, 130, 246, 0.3)", borderRadius: 9999,
                            fontSize: 11.5, color: "#60a5fa", fontWeight: 600,
                          }}>
                            <FileCode2 size={13} />
                            <span>{ref.file}</span>
                            {ref.lines && <span style={{ opacity: 0.75 }}>({ref.lines})</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            {chatLoading && (
              <div style={{ display: "flex", gap: 14 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: "14px", flexShrink: 0,
                  background: "linear-gradient(135deg, #2563eb, #3b82f6)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Radio size={18} color="white" />
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8 }}>RadarAI Intelligence</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text-secondary)", fontSize: 13 }}>
                    <Loader2 size={16} className="animate-spin" color="var(--accent-blue)" />
                    <span>Analyzing repository graph and synthesizing response…</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Samsung One UI Pill Input Bar */}
          <div style={{ padding: "18px 24px", borderTop: "1px solid var(--border-color)", background: "rgba(16, 22, 38, 0.5)" }}>
            <form onSubmit={handleSubmit} style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask RadarAI about architecture, security, API endpoints, or failing tests…"
                style={{
                  flex: 1, padding: "14px 20px", borderRadius: 9999,
                  border: "1px solid var(--border-color)", background: "var(--bg-input)",
                  color: "var(--text-primary)", fontSize: 13.5, outline: "none",
                  transition: "all 0.2s",
                }}
                disabled={chatLoading}
                onFocus={(e) => e.target.style.borderColor = "var(--accent-blue)"}
                onBlur={(e) => e.target.style.borderColor = "var(--border-color)"}
              />
              <button
                type="submit"
                disabled={!input.trim() || chatLoading}
                style={{
                  width: 46, height: 46, borderRadius: "50%", border: "none",
                  background: !input.trim() || chatLoading ? "rgba(255, 255, 255, 0.08)" : "linear-gradient(135deg, #3b82f6, #2563eb)",
                  color: !input.trim() || chatLoading ? "var(--text-muted)" : "white",
                  cursor: !input.trim() || chatLoading ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: !input.trim() || chatLoading ? "none" : "0 4px 14px rgba(37, 99, 235, 0.4)",
                  transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                }}
              >
                <Send size={18} />
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
