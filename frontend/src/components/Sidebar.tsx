"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FlaskConical,
  Sparkles,
  Activity,
  Code2,
  MessageSquare,
  Radio,
  Cpu,
} from "lucide-react";
import { useAppStore } from "@/lib/store";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/test-studio", label: "Test Studio", icon: FlaskConical },
  { href: "/insights", label: "Insights & Health", icon: Sparkles },
  { href: "/code-fixes", label: "Code Intelligence", icon: Code2 },
  { href: "/ask", label: "Ask Radar AI", icon: MessageSquare },
  { href: "/timeline", label: "Agent Pipeline", icon: Activity },
];

export default function Sidebar() {
  const pathname = usePathname();
  const aiInfo = useAppStore((s) => s.aiInfo);
  const progress = useAppStore((s) => s.progress);

  return (
    <aside className="sidebar">
      {/* Samsung One UI Header Section */}
      <div style={{ padding: "24px 20px 18px", borderBottom: "1px solid var(--border-color)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              position: "relative",
              width: 38,
              height: 38,
              borderRadius: "14px",
              background: "linear-gradient(135deg, #2563eb, #3b82f6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 14px rgba(37, 99, 235, 0.4)",
            }}
          >
            <Radio size={20} color="#ffffff" />
            <span
              style={{
                position: "absolute",
                top: -2,
                right: -2,
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: "#10b981",
                border: "2px solid #101626",
              }}
            />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
              Radar<span style={{ color: "var(--accent-blue)" }}>AI</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>
              Release Intelligence
            </div>
          </div>
        </div>

        {/* Live Scan Pill when pipeline is running */}
        {progress && (
          <div
            style={{
              marginTop: 14,
              padding: "6px 12px",
              borderRadius: 9999,
              background: "rgba(59, 130, 246, 0.12)",
              border: "1px solid rgba(59, 130, 246, 0.25)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11,
              color: "#93c5fd",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--accent-blue)",
                boxShadow: "0 0 8px var(--accent-blue)",
              }}
            />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {progress}
            </span>
          </div>
        )}
      </div>

      {/* Navigation Pill List */}
      <nav style={{ padding: "14px 4px", flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-link ${isActive ? "active" : ""}`}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "9px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: isActive ? "rgba(59, 130, 246, 0.2)" : "rgba(255, 255, 255, 0.04)",
                  color: isActive ? "#60a5fa" : "var(--text-secondary)",
                  transition: "all 0.2s ease",
                }}
              >
                <Icon size={16} />
              </div>
              <span style={{ flex: 1 }}>{item.label}</span>
              {isActive && (
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: "var(--accent-blue)",
                    boxShadow: "0 0 6px var(--accent-blue)",
                  }}
                />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Samsung One UI Bottom AI Status Widget */}
      <div style={{ padding: "14px 16px", borderTop: "1px solid var(--border-color)", margin: "0 6px 6px" }}>
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "18px",
            background: "rgba(255, 255, 255, 0.03)",
            border: "1px solid var(--border-color)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: "var(--text-secondary)" }}>
              <Cpu size={13} color="var(--accent-violet)" />
              <span>AI Engine</span>
            </div>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: aiInfo?.mode === "live" ? "var(--accent-green)" : "var(--accent-amber)",
                boxShadow: aiInfo?.mode === "live" ? "0 0 6px var(--accent-green)" : "none",
              }}
            />
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.3 }}>
            {aiInfo
              ? aiInfo.mode === "live"
                ? `${aiInfo.label}${aiInfo.fallbacks?.length ? ` (+${aiInfo.fallbacks.length} fb)` : ""}`
                : "Rule-Based Mode"
              : "Detecting engine..."}
          </div>
        </div>
      </div>
    </aside>
  );
}
