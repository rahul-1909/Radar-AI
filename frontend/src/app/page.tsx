"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import RadarLogo from "@/components/RadarLogo";
import { useAppStore } from "@/lib/store";
import {
  getGitHubToken, setGitHubToken,
  getSiteLogin, setSiteLogin, isLoginSkipped, setLoginSkipped, detectLogin,
} from "@/lib/api";
import {
  FlaskConical,
  CheckCircle2,
  XCircle,
  Zap,
  ShieldAlert,
  ShieldCheck,
  FileCode2,
  Pencil,
  Globe,
  Star,
  GitFork,
  AlertCircle,
  Settings,
  ExternalLink,
  Loader2,
  TrendingDown,
  TrendingUp,
  Minus,
  Lock,
  Layers,
} from "lucide-react";

/** Same normalization the backend applies (adds https:// if missing). */
function normalizeSite(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function pathOf(url: string) {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

function ProjectConfigPanel() {
  const {
    projectConfig, projectError, configureProject: saveProject, loadProjectInfo,
    githubRepo, githubLoading, githubError, fetchGitHubRepo,
    loadDashboard, loginPrompt, setLoginPrompt, setHoldPipeline,
  } = useAppStore();

  const [websiteUrl, setWebsiteUrl] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [projectName, setProjectName] = useState("");
  const [githubToken, setGithubTokenInput] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Test-account login for the user's site
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginUrl, setLoginUrl] = useState("");
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [hasSavedLogin, setHasSavedLogin] = useState(false);
  const [checkingLogin, setCheckingLogin] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    loadProjectInfo();
    const token = getGitHubToken();
    setGithubTokenInput(token);
    setShowToken(!!token);
  }, [loadProjectInfo]);

  useEffect(() => {
    if (projectConfig) {
      setWebsiteUrl(projectConfig.websiteUrl || "");
      setRepoUrl(projectConfig.repoUrl || "");
      setProjectName(projectConfig.name || "");
      const savedLogin = getSiteLogin(projectConfig.websiteUrl);
      setLoginUrl(savedLogin?.loginUrl || "");
      setLoginUser(savedLogin?.username || "");
      setLoginPass(savedLogin?.password || "");
      setHasSavedLogin(!!savedLogin);
      if (savedLogin) setLoginOpen(true);
    }
  }, [projectConfig]);

  useEffect(() => {
    if (loginPrompt) {
      setLoginOpen(true);
      setLoginUrl((current) => current || loginPrompt.loginUrl);
      document.getElementById("site-login")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [loginPrompt]);

  const handleSave = async () => {
    setLoginError(null);
    const site = normalizeSite(websiteUrl);
    const wantsLogin = !!(loginUser.trim() && loginPass);
    if ((loginUser.trim() || loginPass) && !wantsLogin) {
      setLoginError("Enter both the email/username and password — or leave both empty.");
      return;
    }
    if (loginPrompt && !wantsLogin) {
      setLoginError("Enter test account credentials, or select 'Test public pages only'.");
      return;
    }

    setSaving(true);
    setHoldPipeline(true);
    setLoginPrompt(null);
    setGitHubToken(githubToken);
    if (site && wantsLogin) {
      setSiteLogin(site, { loginUrl: loginUrl.trim() || undefined, username: loginUser.trim(), password: loginPass });
      setLoginSkipped(site, false);
      setHasSavedLogin(true);
    }

    const ok = await saveProject({ name: projectName, websiteUrl, repoUrl });
    if (!ok) {
      setSaving(false);
      setHoldPipeline(false);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    if (repoUrl.trim()) fetchGitHubRepo(repoUrl);

    if (site && !wantsLogin && !isLoginSkipped(site)) {
      setCheckingLogin(true);
      const detection = await detectLogin().catch(() => null);
      setCheckingLogin(false);
      if (detection?.detected && detection.loginUrl) {
        setLoginUrl(detection.loginUrl);
        setLoginPrompt({ loginUrl: detection.loginUrl, how: detection.how });
        setSaving(false);
        setHoldPipeline(false);
        return;
      }
    }

    setSaving(false);
    setHoldPipeline(false);
    loadDashboard();
  };

  const skipLogin = () => {
    const site = normalizeSite(websiteUrl);
    if (site) setLoginSkipped(site, true);
    setLoginError(null);
    setLoginPrompt(null);
    if (!useAppStore.getState().dashboard) loadDashboard();
  };

  const removeLogin = () => {
    const site = normalizeSite(websiteUrl);
    if (site) setSiteLogin(site, null);
    setLoginUser("");
    setLoginPass("");
    setLoginUrl("");
    setHasSavedLogin(false);
  };

  const inputStyle = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: "10px",
    background: "var(--bg-input)",
    border: "1px solid var(--border-color)",
    color: "var(--text-primary)",
    fontSize: "13px",
    outline: "none",
    transition: "border-color 0.15s ease",
  };

  return (
    <div className="glass-card" style={{ padding: "22px 24px", marginBottom: "22px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Settings size={16} color="var(--text-secondary)" />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Project Configuration</div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>Target endpoint &amp; repository linkage</div>
          </div>
        </div>
        {saved && (
          <span className="badge badge-approved">
            <CheckCircle2 size={12} /> Configuration Saved
          </span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>
            Project Name
          </label>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="e.g. Production Web Service"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>
            Website URL <span style={{ color: "var(--text-muted)" }}>*</span>
          </label>
          <input
            type="url"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://example.com"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>
            GitHub Repository <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(optional)</span>
          </label>
          <input
            type="url"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            style={inputStyle}
          />
        </div>
      </div>

      {showToken ? (
        <div style={{ marginBottom: 16, padding: "14px", borderRadius: "12px", background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border-color)" }}>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>
            GitHub Access Token <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(private repositories)</span>
          </label>
          <input
            type="password"
            value={githubToken}
            onChange={(e) => setGithubTokenInput(e.target.value)}
            placeholder="github_pat_…"
            autoComplete="off"
            style={inputStyle}
          />
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 5 }}>
            Stored locally in browser session memory. Public repositories require no token.
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowToken(true)}
          style={{ background: "none", border: "none", padding: "0 0 12px", fontSize: 11.5, fontWeight: 500, color: "var(--text-secondary)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}
        >
          + Add private repository access token
        </button>
      )}

      {/* Authenticated Scan Section */}
      <div id="site-login" style={{ marginBottom: 16 }}>
        {loginPrompt && (
          <div style={{
            display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 16px", marginBottom: 14,
            borderRadius: "12px", border: "1px solid rgba(245, 158, 11, 0.3)", background: "rgba(245, 158, 11, 0.05)",
          }}>
            <Lock size={16} color="var(--accent-amber)" style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text-secondary)" }}>
              <strong style={{ color: "var(--text-primary)" }}>Login Portal Detected</strong> ({pathOf(loginPrompt.loginUrl)}).
              Provide a test account to audit pages behind authentication.
            </div>
          </div>
        )}

        {loginOpen ? (
          <div style={{ padding: "16px", borderRadius: "14px", background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border-color)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
                  Login URL
                </label>
                <input type="url" value={loginUrl} onChange={(e) => setLoginUrl(e.target.value)}
                  placeholder="Auto-detected" style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
                  Test Username
                </label>
                <input type="text" value={loginUser} onChange={(e) => setLoginUser(e.target.value)}
                  placeholder="test@example.com" autoComplete="off" style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
                  Test Password
                </label>
                <input type="password" value={loginPass} onChange={(e) => setLoginPass(e.target.value)}
                  placeholder="••••••••" autoComplete="new-password" style={inputStyle} />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, fontSize: 11, color: "var(--text-muted)" }}>
              <span>Credentials stay in local session memory. Never logged or stored.</span>
              {hasSavedLogin && (
                <button type="button" onClick={removeLogin}
                  style={{ background: "none", border: "none", color: "var(--accent-red)", cursor: "pointer", fontWeight: 600 }}>
                  Remove
                </button>
              )}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setLoginOpen(true)}
            style={{ background: "none", border: "none", padding: "0 0 12px", fontSize: 11.5, fontWeight: 500, color: "var(--text-secondary)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}
          >
            <Lock size={12} /> Configure authenticated test credentials
          </button>
        )}

        {loginError && (
          <div style={{ fontSize: 12, color: "var(--accent-red)", marginTop: 8, display: "flex", gap: 6, alignItems: "center" }}>
            <AlertCircle size={13} /> {loginError}
          </div>
        )}
      </div>

      {projectError && (
        <div style={{ fontSize: 12, color: "var(--accent-red)", marginBottom: 12, display: "flex", gap: 6, alignItems: "center" }}>
          <AlertCircle size={13} /> {projectError}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button className="btn-primary" onClick={handleSave} disabled={saving || githubLoading}>
          {checkingLogin ? (
            <><Loader2 size={13} className="animate-spin" /> Verifying portal…</>
          ) : saving || githubLoading ? (
            <><Loader2 size={13} className="animate-spin" /> Connecting…</>
          ) : loginPrompt ? (
            "Save & Execute Scan"
          ) : (
            "Save & Connect"
          )}
        </button>
        {loginPrompt && (
          <button type="button" onClick={skipLogin} disabled={saving} className="btn-secondary">
            Test public routes only
          </button>
        )}
      </div>

      {githubError && !githubLoading && (
        <div style={{ fontSize: 12, color: "var(--accent-red)", marginTop: 12, display: "flex", gap: 6, alignItems: "center" }}>
          <AlertCircle size={13} /> {githubError}
        </div>
      )}

      {githubRepo?.repository && (
        <div style={{
          padding: "16px 18px", background: "rgba(255, 255, 255, 0.02)",
          borderRadius: "14px", border: "1px solid var(--border-color)", marginTop: 16,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{githubRepo.repository.name}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{githubRepo.repository.description}</div>
            </div>
            <a href={githubRepo.repository.url} target="_blank" rel="noopener noreferrer"
              className="badge" style={{ background: "rgba(255, 255, 255, 0.06)", color: "var(--text-primary)" }}>
              Repo <ExternalLink size={10} />
            </a>
          </div>

          <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: "var(--text-secondary)" }}>
            {githubRepo.repository.stars != null && (
              <>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Star size={12} color="#facc15" /> {githubRepo.repository.stars}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}><GitFork size={12} /> {githubRepo.repository.forks}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}><AlertCircle size={12} /> {githubRepo.repository.openIssues}</span>
              </>
            )}
            <span>{githubRepo.repository.language}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function PrecisionGauge({ score, level }: { score: number; level: string }) {
  const color = level === "high" ? "var(--accent-red)" : level === "medium" ? "var(--accent-amber)" : "var(--accent-green)";
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
      <div style={{ position: "relative", width: 120, height: 120, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="120" height="120" style={{ transform: "rotate(-90deg)" }}>
          <circle
            cx="60" cy="60" r={radius}
            stroke="rgba(255, 255, 255, 0.08)"
            strokeWidth="8"
            fill="transparent"
          />
          <circle
            cx="60" cy="60" r={radius}
            stroke={color}
            strokeWidth="8"
            fill="transparent"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />
        </svg>
        <div style={{ position: "absolute", textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1 }}>{score}</div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3, fontWeight: 600, letterSpacing: "0.05em" }}>RISK INDEX</div>
        </div>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span className={`badge badge-${level}`}>
            {level.toUpperCase()} RISK
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {score <= 30 ? "Optimal release stability" : score <= 60 ? "Requires review" : "Blockers identified"}
          </span>
        </div>
        <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55 }}>
          Weighted calculation across Functionality (35%), Security (30%), Performance (15%), A11y (10%), and SEO (10%).
        </p>
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string; value: string | number; sub?: string; color: string;
}) {
  return (
    <div className="stat-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>{label}</span>
        <Icon size={16} color={color} />
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function ModuleCard({ module }: { module: { name: string; impact: string; filesChanged: number; linesChanged: number; description?: string } }) {
  const color = module.impact === "high" ? "var(--accent-red)" : module.impact === "medium" ? "var(--accent-amber)" : "var(--accent-green)";

  return (
    <div style={{
      padding: "14px 18px", background: "rgba(255, 255, 255, 0.02)",
      borderRadius: "14px", border: "1px solid var(--border-color)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{module.name}</span>
        <span className={`badge badge-${module.impact}`}>{module.impact}</span>
      </div>
      {module.description && (
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 6 }}>{module.description}</div>
      )}
      <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><FileCode2 size={12} /> {module.filesChanged} files</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Pencil size={12} /> {module.linesChanged} lines</span>
      </div>
      <div className="progress-bar">
        <div className="progress-bar-fill" style={{ width: `${module.impact === "high" ? 85 : module.impact === "medium" ? 55 : 25}%`, background: color }} />
      </div>
    </div>
  );
}

type ExploredPage = {
  url: string; path: string; access: "public" | "private";
  statusCode: number | null; title: string; loadTime: number | null; issues: string[];
};

type Exploration = {
  login: { status: string; message: string; loginUrl: string | null; username: string | null };
  counts: { public: number; private: number };
  pages: ExploredPage[];
};

const LOGIN_STATUS_STYLE: Record<string, { color: string; icon: React.ComponentType<{ size?: number; color?: string }> }> = {
  success: { color: "var(--accent-green)", icon: CheckCircle2 },
  "not-provided": { color: "var(--accent-amber)", icon: Lock },
  none: { color: "var(--text-muted)", icon: Globe },
};

function SiteExplorationCard({ exploration }: { exploration: Exploration }) {
  const setLoginPrompt = useAppStore((s) => s.setLoginPrompt);
  const [showAll, setShowAll] = useState(false);
  const { login, counts, pages } = exploration;
  const style = LOGIN_STATUS_STYLE[login.status] || { color: "var(--accent-red)", icon: AlertCircle };
  const StatusIcon = style.icon;
  const ordered = [...pages].sort((a, b) => Number(b.access === "private") - Number(a.access === "private"));
  const visiblePages = showAll ? ordered : ordered.slice(0, 8);
  const canAddLogin = login.status !== "none" && login.status !== "success";

  return (
    <div className="glass-card" style={{ padding: "22px 24px", marginBottom: "22px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700 }}>Explored Route Surface</h2>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
            {counts.public} public routes{counts.private > 0 ? ` · ${counts.private} authenticated views` : ""}
          </div>
        </div>
        <span className="badge" style={{ background: "rgba(255, 255, 255, 0.05)", color: "var(--text-secondary)" }}>
          <Layers size={11} /> {pages.length} Endpoints
        </span>
      </div>

      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", marginBottom: 16,
        borderRadius: "12px", border: `1px solid ${style.color}`, fontSize: 12, color: "var(--text-secondary)",
        background: "rgba(255, 255, 255, 0.01)",
      }}>
        <StatusIcon size={15} color={style.color} />
        <span style={{ flex: 1 }}>{login.message}</span>
        {canAddLogin && login.loginUrl && (
          <button className="btn-primary" style={{ fontSize: 11, padding: "4px 10px" }}
            onClick={() => setLoginPrompt({ loginUrl: login.loginUrl as string })}>
            {login.status === "not-provided" ? "Add Credentials" : "Edit"}
          </button>
        )}
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: 30 }}></th>
            <th>Route</th>
            <th style={{ width: 90 }}>Latency</th>
            <th>Health Status</th>
          </tr>
        </thead>
        <tbody>
          {visiblePages.map((p) => (
            <tr key={p.url}>
              <td>
                {p.access === "private" ? <Lock size={12} color="var(--accent-amber)" /> : <Globe size={12} color="var(--text-muted)" />}
              </td>
              <td>
                <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: 12.5, textDecoration: "none" }}>
                  {p.path}
                </a>
                {p.title && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.title.slice(0, 75)}</div>}
              </td>
              <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                {p.loadTime != null ? `${(p.loadTime / 1000).toFixed(1)}s` : "—"}
              </td>
              <td>
                {p.issues.length ? (
                  <span className="badge badge-medium">{p.issues.join(" · ")}</span>
                ) : (
                  <span className="badge badge-approved">Pass</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {pages.length > 8 && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          style={{ background: "none", border: "none", padding: "12px 0 0", fontSize: 12, fontWeight: 500, color: "var(--accent-blue)", cursor: "pointer" }}
        >
          {showAll ? "Show fewer" : `View all ${pages.length} endpoints →`}
        </button>
      )}
    </div>
  );
}

type Delta = {
  direction: "improved" | "worse" | "unchanged";
  previousScore: number; currentScore: number;
  previousDeployment?: string; currentDeployment?: string;
  passedChange: number; improvedTests: string[]; regressionTests: string[];
};

const DELTA_STYLE = {
  improved: { color: "var(--accent-green)", title: "Risk score improved", Icon: TrendingDown },
  worse: { color: "var(--accent-red)", title: "Risk score increased", Icon: TrendingUp },
  unchanged: { color: "var(--text-secondary)", title: "Zero risk delta", Icon: Minus },
};

function DeltaCard({ delta }: { delta: Delta }) {
  const style = DELTA_STYLE[delta.direction] || DELTA_STYLE.unchanged;
  const { Icon } = style;
  const list = (items: string[]) => items.slice(0, 4).join(", ") + (items.length > 4 ? ` +${items.length - 4} more` : "");

  return (
    <div className="glass-card" style={{ padding: "16px 20px", marginBottom: 20, borderColor: style.color }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: style.color, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
            <Icon size={15} /> {style.title} since last run
          </h3>
          {delta.improvedTests.length > 0 && (
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              <span style={{ color: "var(--accent-green)" }}>Resolved ({delta.improvedTests.length}):</span> {list(delta.improvedTests)}
            </div>
          )}
          {delta.regressionTests.length > 0 && (
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              <span style={{ color: "var(--accent-red)" }}>Regressed ({delta.regressionTests.length}):</span> {list(delta.regressionTests)}
            </div>
          )}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600 }}>PREV → CURR</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>
            <span style={{ color: "var(--text-muted)" }}>{delta.previousScore}</span>
            <span style={{ color: "var(--text-muted)", margin: "0 4px" }}>→</span>
            <span style={{ color: style.color }}>{delta.currentScore}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { dashboard, dashboardLoading, dashboardError, loadDashboard, refreshDashboard, holdPipeline, loginPrompt, progress } = useAppStore();

  useEffect(() => {
    if (!dashboard && !dashboardLoading && !dashboardError) {
      loadDashboard();
    }
  }, [dashboard, dashboardLoading, dashboardError, loadDashboard]);

  if (dashboardError && !dashboardLoading && !dashboard) {
    return (
      <div style={{ display: "flex" }}>
        <Sidebar />
        <main style={{ marginLeft: 286, padding: "32px 36px", flex: 1, width: "calc(100% - 286px)" }}>
          <div className="glass-card" style={{ padding: 40, textAlign: "center", maxWidth: 500, margin: "40px auto 0" }}>
            <AlertCircle size={28} color="var(--accent-red)" style={{ margin: "0 auto 12px" }} />
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Radar Execution Interrupted</div>
            <p style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 18, lineHeight: 1.5 }}>{dashboardError}</p>
            <button className="btn-primary" onClick={() => loadDashboard()}>
              <Zap size={13} /> Retry Quality Scan
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (!dashboard && !dashboardLoading && (holdPipeline || loginPrompt)) {
    return (
      <div style={{ display: "flex" }}>
        <Sidebar />
        <main style={{ marginLeft: 286, padding: "32px 36px", flex: 1, width: "calc(100% - 286px)" }}>
          <div style={{ marginBottom: 22 }}>
            <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 2 }}>Release Intelligence</h1>
            <p style={{ color: "var(--text-muted)", fontSize: 12.5 }}>
              {loginPrompt ? "Authentication credentials required" : "Initializing RadarAI pipeline…"}
            </p>
          </div>
          <ProjectConfigPanel />
        </main>
      </div>
    );
  }

  if (dashboardLoading || !dashboard) {
    return (
      <div style={{ display: "flex" }}>
        <Sidebar />
        <main style={{ marginLeft: 286, padding: "32px 36px", flex: 1, width: "calc(100% - 286px)" }}>
          <div style={{ marginBottom: 24 }}>
            <div className="skeleton" style={{ width: 220, height: 28, marginBottom: 6 }} />
            <div className="skeleton" style={{ width: 140, height: 14 }} />
          </div>
          <div className="glass-card" style={{ padding: 48, textAlign: "center", marginBottom: 22 }}>
            <div style={{
              width: 52, height: 52, borderRadius: "14px",
              background: "rgba(255, 255, 255, 0.05)", display: "flex", alignItems: "center",
              justifyContent: "center", margin: "0 auto 16px",
              border: "1px solid var(--border-color)",
            }}>
              <RadarLogo size={32} color="#f8fafc" />
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
              {progress || "Executing Radar Multi-Vector Inspection..."}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Autonomous headless browsing, Newman API requests, and deterministic gating.
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
            {[1, 2, 3, 4].map(i => <div key={i} className="skeleton" style={{ height: 100 }} />)}
          </div>
        </main>
      </div>
    );
  }

  const { riskOverview, testMetrics, impactedModules } = dashboard;
  const passRate = testMetrics.totalGenerated > 0 ? Math.round((testMetrics.byStatus.passed / testMetrics.totalGenerated) * 100) : 0;

  if (dashboard.unconfigured) {
    return (
      <div style={{ display: "flex" }}>
        <Sidebar />
        <main style={{ marginLeft: 286, padding: "32px 36px", flex: 1, width: "calc(100% - 286px)" }}>
          <div style={{ marginBottom: 24 }}>
            <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 2 }}>Release Intelligence</h1>
            <p style={{ color: "var(--text-muted)", fontSize: 12.5 }}>
              Connect a website to activate continuous release quality evaluation
            </p>
          </div>

          <ProjectConfigPanel />

          <div className="glass-card" style={{ padding: 44, textAlign: "center", marginBottom: 22 }}>
            <div style={{
              width: 56, height: 56, borderRadius: "14px",
              background: "rgba(255, 255, 255, 0.05)", display: "flex", alignItems: "center",
              justifyContent: "center", margin: "0 auto 16px",
              border: "1px solid var(--border-color)",
            }}>
              <RadarLogo size={36} color="#f8fafc" />
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 6, letterSpacing: "-0.02em" }}>
              Radar<span style={{ color: "var(--text-muted)", fontWeight: 400 }}>AI</span> Release Gatekeeper
            </h2>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", maxWidth: 480, margin: "0 auto 24px", lineHeight: 1.6 }}>
              Enter your project name and website URL above, then click <strong>Save &amp; Connect</strong> to execute autonomous browser, API, and risk analysis.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
              <MetricCard icon={FlaskConical} label="Tests Executed" value="0" sub="Awaiting run" color="var(--text-muted)" />
              <MetricCard icon={CheckCircle2} label="Tests Passed" value="0" sub="0% pass rate" color="var(--text-muted)" />
              <MetricCard icon={XCircle} label="Tests Failed" value="0" sub="0 issues" color="var(--text-muted)" />
              <MetricCard icon={Zap} label="Pass Rate" value="0%" sub="Idle" color="var(--text-muted)" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div style={{ display: "flex" }}>
      <Sidebar />
      <main style={{ marginLeft: 286, padding: "32px 36px", flex: 1, width: "calc(100% - 286px)" }}>
        {/* Header */}
        <div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span className="badge badge-approved">
                ACTIVE RADAR
              </span>
              <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                Updated {new Date(dashboard.lastUpdated).toLocaleTimeString()}
              </span>
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em" }}>
              {dashboard.project?.name || "Release Quality Overview"}
            </h1>
          </div>
          <div>
            <button
              className="btn-primary"
              onClick={() => refreshDashboard()}
            >
              <Zap size={13} /> Re-scan Release
            </button>
          </div>
        </div>

        {dashboard.delta?.hasDelta && <DeltaCard delta={dashboard.delta} />}

        <ProjectConfigPanel />

        {/* Gatekeeper Decision Banner */}
        <div className="glass-card" style={{
          padding: "18px 22px", marginBottom: 22,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          borderColor: riskOverview.deployment === "blocked" ? "rgba(239, 68, 68, 0.3)" : "rgba(16, 185, 129, 0.3)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {riskOverview.deployment === "blocked"
              ? <ShieldAlert size={22} color="var(--accent-red)" />
              : <ShieldCheck size={22} color="var(--accent-green)" />
            }
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>
                Release Gate: {riskOverview.deployment === "blocked" ? "DEPLOYMENT BLOCKED" : "DEPLOYMENT APPROVED"}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                {riskOverview.deployment === "blocked" && riskOverview.reasons?.length
                  ? riskOverview.reasons.join(" · ")
                  : "All deterministic quality benchmarks satisfied. Zero critical blockers."}
              </div>
            </div>
          </div>
          <span className={`badge badge-${riskOverview.deployment === "blocked" ? "blocked" : "approved"}`}>
            {riskOverview.deployment?.toUpperCase()}
          </span>
        </div>

        {/* 4 Metric Widgets */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 22 }}>
          <MetricCard
            icon={FlaskConical}
            label="Tests Executed"
            value={testMetrics.totalGenerated}
            sub={`${testMetrics.coverage.functional || 0} fn, ${testMetrics.coverage.security || 0} sec, ${testMetrics.coverage.accessibility || 0} a11y`}
            color="var(--text-primary)"
          />
          <MetricCard
            icon={CheckCircle2}
            label="Tests Passed"
            value={testMetrics.byStatus.passed}
            sub={`${passRate}% success rate`}
            color="var(--accent-green)"
          />
          <MetricCard
            icon={XCircle}
            label="Tests Failed"
            value={testMetrics.byStatus.failed}
            sub={testMetrics.byStatus.failed === 0 ? "Zero defects" : "Action required"}
            color="var(--accent-red)"
          />
          <MetricCard
            icon={Zap}
            label="Pass Rate"
            value={`${passRate}%`}
            sub={dashboard.pipelineDuration ? `Time: ${dashboard.pipelineDuration}` : "Complete"}
            color={passRate >= 80 ? "var(--accent-green)" : passRate >= 60 ? "var(--accent-amber)" : "var(--accent-red)"}
          />
        </div>

        {dashboard.exploration && <SiteExplorationCard exploration={dashboard.exploration} />}

        {/* Risk Gauge + Impacted Modules */}
        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 18, marginBottom: 22 }}>
          <div className="glass-card" style={{ padding: 22 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Deterministic Risk Evaluation</h2>
            <PrecisionGauge score={riskOverview.score} level={riskOverview.level} />
            <p style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 16, lineHeight: 1.55 }}>
              {riskOverview.explanation}
            </p>
          </div>

          <div className="glass-card" style={{ padding: 22 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Impacted Code Modules</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {impactedModules?.map((mod: { name: string; impact: string; filesChanged: number; linesChanged: number; description?: string }, i: number) => (
                <ModuleCard key={i} module={mod} />
              ))}
            </div>
          </div>
        </div>

        {/* Risk Factors */}
        <div className="glass-card" style={{ padding: 22, marginBottom: 22 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>Risk Dimension Breakdown</h2>
          <p style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 14 }}>{riskOverview.formula}</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            {riskOverview.factors?.map((factor: { name: string; score: number; description: string; weight: number }, i: number) => (
              <div key={i} className="stat-card" style={{ padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{factor.name}</span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{Math.round(factor.weight * 100)}%</span>
                </div>
                <div className="progress-bar" style={{ marginBottom: 6 }}>
                  <div className="progress-bar-fill" style={{
                    width: `${factor.score}%`,
                    background: factor.score >= 70 ? "var(--accent-red)" : factor.score >= 40 ? "var(--accent-amber)" : "var(--accent-green)",
                  }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{factor.description}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: factor.score >= 70 ? "var(--accent-red)" : "var(--text-primary)" }}>{factor.score}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recommendations */}
        <div className="glass-card" style={{ padding: 22 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Remediation Strategy</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {riskOverview.recommendations?.map((rec: string, i: number) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 14px", background: "rgba(255, 255, 255, 0.02)",
                borderRadius: "10px", border: "1px solid var(--border-color)",
                fontSize: 12.5, color: "var(--text-secondary)",
              }}>
                <span style={{ color: "var(--accent-blue)", fontWeight: 700, flexShrink: 0 }}>#{i + 1}</span>
                <span>{rec}</span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
