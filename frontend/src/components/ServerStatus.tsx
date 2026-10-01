"use client";

import { useEffect } from "react";
import { Loader2, WifiOff, RefreshCw } from "lucide-react";
import { useAppStore } from "@/lib/store";

/**
 * Samsung One UI Floating Alert Pill
 * Displays server wake-up and connection state gracefully at top-center.
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
        top: 20,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        gap: 10,
        maxWidth: "calc(100vw - 32px)",
        padding: "10px 20px",
        borderRadius: 9999,
        fontSize: 12.5,
        fontWeight: 500,
        background: "rgba(19, 25, 39, 0.92)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        color: "var(--text-primary)",
        border: `1px solid ${waking ? "rgba(245, 158, 11, 0.4)" : "rgba(239, 68, 68, 0.4)"}`,
        boxShadow: "0 10px 30px -5px rgba(0, 0, 0, 0.5)",
      }}
    >
      {waking ? (
        <>
          <Loader2 size={16} className="animate-spin" color="var(--accent-amber)" />
          <span>Waking up RadarAI backend node — this takes a moment on cold start…</span>
        </>
      ) : (
        <>
          <WifiOff size={16} color="var(--accent-red)" />
          <span>RadarAI server is unreachable.</span>
          <button
            onClick={() => checkServer()}
            style={{
              background: "rgba(59, 130, 246, 0.15)",
              border: "1px solid rgba(59, 130, 246, 0.3)",
              color: "#60a5fa",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              padding: "3px 10px",
              borderRadius: 9999,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <RefreshCw size={11} /> Retry
          </button>
        </>
      )}
    </div>
  );
}
