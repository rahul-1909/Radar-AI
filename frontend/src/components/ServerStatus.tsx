"use client";

import { useEffect } from "react";
import { Loader2, WifiOff, RefreshCw } from "lucide-react";
import { useAppStore } from "@/lib/store";

/**
 * Clean Minimal Server Notification Bar
 */
export default function ServerStatus() {
  const { serverStatus, checkServer } = useAppStore();

  useEffect(() => {
    checkServer();
  }, [checkServer]);

  if (serverStatus === "online" || serverStatus === "checking") return null;

  const waking = serverStatus === "waking";
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        gap: 8,
        maxWidth: "calc(100vw - 32px)",
        padding: "8px 16px",
        borderRadius: 9999,
        fontSize: 12,
        fontWeight: 500,
        background: "var(--bg-card)",
        color: "var(--text-primary)",
        border: `1px solid ${waking ? "rgba(245, 158, 11, 0.4)" : "rgba(239, 68, 68, 0.4)"}`,
        boxShadow: "var(--shadow-md)",
      }}
    >
      {waking ? (
        <>
          <Loader2 size={14} className="animate-spin" color="var(--accent-amber)" />
          <span>Waking backend node — this takes a moment on cold start…</span>
        </>
      ) : (
        <>
          <WifiOff size={14} color="var(--accent-red)" />
          <span>Backend service unreachable.</span>
          <button
            onClick={() => checkServer()}
            style={{
              background: "rgba(255, 255, 255, 0.08)",
              border: "1px solid var(--border-color)",
              color: "var(--text-primary)",
              cursor: "pointer",
              fontSize: 11.5,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 9999,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <RefreshCw size={10} /> Retry
          </button>
        </>
      )}
    </div>
  );
}
