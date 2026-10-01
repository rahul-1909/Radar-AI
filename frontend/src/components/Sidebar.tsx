"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import RadarLogo from "./RadarLogo";
import {
  LayoutDashboard,
  FlaskConical,
  Sparkles,
  Activity,
  Code2,
  MessageSquare,
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
      {/* Brand Header with Uploaded Radar Logo */}
      <div style={{ padding: "20px 18px 16px", borderBottom: "1px solid var(--border-color)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              position: "relative",
              width: 36,
              height: 36,
              borderRadius: "10px",
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid var(--border-color)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <RadarLogo size={24} color="#f8fafc" />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
              Radar<span style={{ color: "var(--text-muted)", fontWeight: 400 }}>AI</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>
              Release Gatekeeper
            </div>
          </div>
        </div>

        {/* Live Scan Notification */}
        {progress && (
          <div
            style={{
              marginTop: 12,
              padding: "6px 10px",
              borderRadius: 8,
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid var(--border-color)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11,
              color: "var(--text-secondary)",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--accent-blue)",
              }}
            />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {progress}
            </span>
          </div>
        )}
      </div>

      {/* Navigation Links */}
      <nav style={{ padding: "12px 0", flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-link ${isActive ? "active" : ""}`}
            >
              <Icon size={16} color={isActive ? "#ffffff" : "var(--text-secondary)"} />
              <span style={{ flex: 1 }}>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Engine Status Card */}
      <div style={{ padding: "12px 14px", borderTop: "1px solid var(--border-color)" }}>
        <div
          style={{
            padding: "10px 12px",
            borderRadius: "14px",
            background: "rgba(255, 255, 255, 0.02)",
            border: "1px solid var(--border-color)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Cpu size={14} color="var(--text-muted)" />
            <div style={{ fontSize: 11.5, fontWeight: 500, color: "var(--text-secondary)" }}>
              {aiInfo?.mode === "live" ? aiInfo.label : "Rule-based Engine"}
            </div>
          </div>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: aiInfo?.mode === "live" ? "var(--accent-green)" : "var(--accent-amber)",
            }}
          />
        </div>
      </div>
    </aside>
  );
}
