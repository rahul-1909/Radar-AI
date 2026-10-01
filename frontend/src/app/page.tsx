"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
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
  Radio,
  Sparkles,
  Layers,
  Activity,
  ArrowUpRight,
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
    padding: "12px 16px",
    borderRadius: "14px",
    background: "var(--bg-input)",
    border: "1px solid var(--border-color)",
    color: "var(--text-primary)",
    fontSize: "13.5px",
    outline: "none",
    transition: "border-color 0.2s, background 0.2s",
  };

  return (
    <div className="glass-card" style={{ padding: "26px", marginBottom: "24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: "12px",
            background: "rgba(59, 130, 246, 0.15)", display: "flex",
            alignItems: "center", justifyContent: "center",
          }}>
            <Settings size={18} color="var(--accent-blue)" />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Project Settings</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Target system &amp; source repository configuration</div>
          </div>
        </div>
        {saved && (
          <span className="badge badge-approved" style={{ fontSize: 12 }}>
            <CheckCircle2 size={12} /> Configuration Saved
          </span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginBottom: 18 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
            Project Name
          </label>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="e.g. Acme Web App"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
            Website URL <span style={{ color: "var(--accent-blue)" }}>*</span>
          </label>
          <input
            type="url"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://app.example.com"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
            GitHub Repository <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(optional)</span>
          </label>
          <input
            type="url"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/org/repo"
            style={inputStyle}
          />
        </div>
      </div>

      {showToken ? (
        <div style={{ marginBottom: 18, padding: "16px", borderRadius: "18px", background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border-color)" }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
            GitHub Personal Access Token <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(private repos only)</span>
          </label>
          <input
            type="password"
            value={githubToken}
            onChange={(e) => setGithubTokenInput(e.target.value)}
            placeholder="github_pat_…"
            autoComplete="off"
            style={inputStyle}
          />
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>
            Stored locally in your browser session only. Read-only repo access required. Public repositories do not require a token.
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowToken(true)}
          style={{ background: "none", border: "none", padding: "0 0 14px", fontSize: 12, fontWeight: 600, color: "var(--accent-blue)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          + Add private GitHub token
        </button>
      )}

      {/* Authenticated Scan Section */}
      <div id="site-login" style={{ marginBottom: 18 }}>
        {loginPrompt && (
          <div style={{
            display: "flex", gap: 12, alignItems: "flex-start", padding: "16px 20px", marginBottom: 16,
            borderRadius: "18px", border: "1px solid rgba(245, 158, 11, 0.3)", background: "rgba(245, 158, 11, 0.08)",
          }}>
            <Lock size={18} color="var(--accent-amber)" style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>
              <strong style={{ color: "var(--text-primary)" }}>Login Portal Detected</strong> ({pathOf(loginPrompt.loginUrl)}).
              Provide test credentials below so RadarAI can crawl authenticated in-app pages and verify post-login stability.
            </div>
          </div>
        )}

        {loginOpen ? (
          <div style={{ padding: "18px", borderRadius: "20px", background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border-color)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
              <div>
                <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
                  Login URL
                </label>
                <input type="url" value={loginUrl} onChange={(e) => setLoginUrl(e.target.value)}
                  placeholder="Auto-detected or custom" style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
                  Test Username / Email
                </label>
                <input type="text" value={loginUser} onChange={(e) => setLoginUser(e.target.value)}
                  placeholder="test-account@yoursite.com" autoComplete="off" style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
                  Test Password
                </label>
                <input type="password" value={loginPass} onChange={(e) => setLoginPass(e.target.value)}
                  placeholder="••••••••" autoComplete="new-password" style={inputStyle} />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, fontSize: 11.5, color: "var(--text-muted)" }}>
              <span>Credentials live only in local storage during active testing runs. Never logged or stored.</span>
              {hasSavedLogin && (
                <button type="button" onClick={removeLogin}
                  style={{ background: "none", border: "none", color: "var(--accent-red)", cursor: "pointer", fontWeight: 600 }}>
                  Remove saved login
                </button>
              )}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setLoginOpen(true)}
            style={{ background: "none", border: "none", padding: "0 0 14px", fontSize: 12, fontWeight: 600, color: "var(--accent-blue)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Lock size={12} /> Configure authenticated testing account
          </button>
        )}

        {loginError && (
          <div style={{ fontSize: 12.5, color: "var(--accent-red)", marginTop: 10, display: "flex", gap: 6, alignItems: "center" }}>
            <AlertCircle size={14} /> {loginError}
          </div>
        )}
      </div>

      {projectError && (
        <div style={{ fontSize: 12.5, color: "var(--accent-red)", marginBottom: 14, display: "flex", gap: 6, alignItems: "center" }}>
          <AlertCircle size={14} /> {projectError}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button className="btn-primary" onClick={handleSave} disabled={saving || githubLoading}>
          {checkingLogin ? (
            <><Loader2 size={15} className="animate-spin" /> Verifying login portal…</>
          ) : saving || githubLoading ? (
            <><Loader2 size={15} className="animate-spin" /> Connecting &amp; Initializing Radar…</>
          ) : loginPrompt ? (
            "Save & Execute Pipeline"
          ) : (
            <><Radio size={15} /> Save &amp; Connect</>
          )}
        </button>
        {loginPrompt && (
          <button type="button" onClick={skipLogin} disabled={saving} className="btn-secondary">
            Test public pages only
          </button>
        )}
      </div>

      {githubError && !githubLoading && (
        <div style={{ fontSize: 12.5, color: "var(--accent-red)", marginTop: 14, display: "flex", gap: 6, alignItems: "center" }}>
          <AlertCircle size={14} /> {githubError}
        </div>
      )}

      {githubRepo?.repository && (
        <div style={{
          padding: "18px 22px", background: "rgba(255, 255, 255, 0.02)",
          borderRadius: "20px", border: "1px solid var(--border-color)", marginTop: 18,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{githubRepo.repository.name}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{githubRepo.repository.description}</div>
            </div>
            <a href={githubRepo.repository.url} target="_blank" rel="noopener noreferrer"
              className="badge" style={{ background: "rgba(59, 130, 246, 0.15)", color: "#60a5fa" }}>
              Repo <ExternalLink size={10} />
            </a>
          </div>

          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-secondary)", marginBottom: 14 }}>
            {githubRepo.repository.stars != null && (
              <>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Star size={13} color="#facc15" /> {githubRepo.repository.stars}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}><GitFork size={13} /> {githubRepo.repository.forks}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}><AlertCircle size={13} /> {githubRepo.repository.openIssues} issues</span>
              </>
            )}
            <span>{githubRepo.repository.language}</span>
          </div>

          {githubRepo.recentCommits?.length > 0 && (
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.4px" }}>
                Recent Git Commits
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {githubRepo.recentCommits.slice(0, 4).map((c: { sha: string; message: string; author: string }, i: number) => (
                  <div key={i} style={{ display: "flex", gap: 10, fontSize: 12, alignItems: "center" }}>
                    <code style={{ color: "var(--accent-blue)", fontSize: 11, background: "rgba(59, 130, 246, 0.1)", padding: "2px 6px", borderRadius: 6 }}>{c.sha}</code>
                    <span style={{ color: "var(--text-secondary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.message}</span>
                    <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{c.author}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SamsungRiskGauge({ score, level }: { score: number; level: string }) {
  const color = level === "high" ? "var(--accent-red)" : level === "medium" ? "var(--accent-amber)" : "var(--accent-green)";
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
      <div style={{ position: "relative", width: 130, height: 130, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="130" height="130" style={{ transform: "rotate(-90deg)" }}>
          <circle
            cx="65" cy="65" r={radius}
            stroke="rgba(255, 255, 255, 0.08)"
            strokeWidth="10"
            fill="transparent"
          />
          <circle
            cx="65" cy="65" r={radius}
            stroke={color}
            strokeWidth="10"
            fill="transparent"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 1s ease" }}
          />
        </svg>
        <div style={{ position: "absolute", textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1 }}>{score}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, fontWeight: 600 }}>RISK SCORE</div>
        </div>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span className={`badge badge-${level}`} style={{ fontSize: 12, padding: "4px 14px" }}>
            {level.toUpperCase()} RISK
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {score <= 30 ? "Optimal release state" : score <= 60 ? "Requires review" : "Release blockers present"}
          </span>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.55 }}>
          Deterministic index weighted across Functionality, Security, Performance, A11y and SEO.
        </p>
      </div>
    </div>
  );
}

function OneUIStatWidget({ icon: Icon, label, value, sub, color, bg }: {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string; value: string | number; sub?: string; color: string; bg: string;
}) {
  return (
    <div className="stat-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-secondary)" }}>{label}</span>
        <div style={{
          width: 32, height: 32, borderRadius: "10px",
          background: bg, display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon size={16} color={color} />
        </div>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function ModuleCard({ module }: { module: { name: string; impact: string; filesChanged: number; linesChanged: number; description?: string } }) {
  const color = module.impact === "high" ? "var(--accent-red)" : module.impact === "medium" ? "var(--accent-amber)" : "var(--accent-green)";

  return (
    <div style={{
      padding: "16px 20px", background: "rgba(255, 255, 255, 0.02)",
      borderRadius: "18px", border: "1px solid var(--border-color)",
      transition: "all 0.2s ease",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700 }}>{module.name}</span>
        <span className={`badge badge-${module.impact}`}>{module.impact}</span>
      </div>
      {module.description && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>{module.description}</div>
      )}
      <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: "var(--text-muted)", marginBottom: 10 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><FileCode2 size={13} /> {module.filesChanged} files</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Pencil size={13} /> {module.linesChanged} lines</span>
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
    <div className="glass-card" style={{ padding: "26px", marginBottom: "24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>Explored Application Surface</h2>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {counts.public} public endpoints{counts.private > 0 ? ` · ${counts.private} authenticated views` : ""}
          </div>
        </div>
        <span className="badge" style={{ background: "rgba(59, 130, 246, 0.12)", color: "#60a5fa" }}>
          <Layers size={12} /> {pages.length} Pages Verified
        </span>
      </div>

      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", marginBottom: 18,
        borderRadius: "16px", border: `1px solid ${style.color}`, fontSize: 12.5, color: "var(--text-secondary)",
        background: "rgba(255, 255, 255, 0.02)",
      }}>
        <StatusIcon size={16} color={style.color} />
        <span style={{ flex: 1 }}>{login.message}</span>
        {canAddLogin && login.loginUrl && (
          <button className="btn-primary" style={{ fontSize: 11.5, padding: "6px 14px" }}
            onClick={() => setLoginPrompt({ loginUrl: login.loginUrl as string })}>
            {login.status === "not-provided" ? "Add Credentials" : "Edit Credentials"}
          </button>
        )}
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: 34 }}>Type</th>
            <th>Endpoint</th>
            <th style={{ width: 100 }}>Response</th>
            <th>Issues</th>
          </tr>
        </thead>
        <tbody>
          {visiblePages.map((p) => (
            <tr key={p.url}>
              <td>
                <div style={{
                  width: 26, height: 26, borderRadius: "8px",
                  background: p.access === "private" ? "rgba(245, 158, 11, 0.15)" : "rgba(255, 255, 255, 0.05)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {p.access === "private" ? <Lock size={12} color="var(--accent-amber)" /> : <Globe size={12} color="var(--text-muted)" />}
                </div>
              </td>
              <td>
                <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: 13, textDecoration: "none" }}>
                  {p.path}
                </a>
                {p.title && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.title.slice(0, 80)}</div>}
              </td>
              <td style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                {p.loadTime != null ? `${(p.loadTime / 1000).toFixed(1)}s` : "—"}
              </td>
              <td>
                {p.issues.length ? (
                  <span className="badge badge-medium">{p.issues.join(" · ")}</span>
                ) : (
                  <span className="badge badge-approved">Stable</span>
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
          style={{ background: "none", border: "none", padding: "14px 0 0", fontSize: 12.5, fontWeight: 600, color: "var(--accent-blue)", cursor: "pointer" }}
        >
          {showAll ? "Show fewer pages" : `View all ${pages.length} tested routes →`}
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
  improved: { color: "var(--accent-green)", tint: "rgba(16, 185, 129, 0.08)", title: "Risk score improved", Icon: TrendingDown },
  worse: { color: "var(--accent-red)", tint: "rgba(239, 68, 68, 0.08)", title: "Risk score increased", Icon: TrendingUp },
  unchanged: { color: "var(--text-secondary)", tint: "transparent", title: "No risk delta", Icon: Minus },
};

function DeltaCard({ delta }: { delta: Delta }) {
  const style = DELTA_STYLE[delta.direction] || DELTA_STYLE.unchanged;
  const { Icon } = style;
  const decisionChanged = delta.previousDeployment && delta.previousDeployment !== delta.currentDeployment;
  const list = (items: string[]) => items.slice(0, 4).join(", ") + (items.length > 4 ? ` +${items.length - 4} more` : "");

  return (
    <div className="glass-card" style={{ padding: "18px 24px", marginBottom: 22, background: style.tint, borderColor: style.color }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20 }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ fontSize: 13.5, fontWeight: 700, color: style.color, marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
            <Icon size={16} /> {style.title} since previous scan
            {decisionChanged && (
              <span style={{ fontWeight: 500, color: "var(--text-secondary)", fontSize: 12 }}>
                · Gate decision: {delta.previousDeployment?.toUpperCase()} → {delta.currentDeployment?.toUpperCase()}
              </span>
            )}
          </h3>
          {delta.improvedTests.length > 0 && (
            <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 2 }}>
              <span style={{ color: "var(--accent-green)", fontWeight: 600 }}>Resolved ({delta.improvedTests.length}):</span> {list(delta.improvedTests)}
            </div>
          )}
          {delta.regressionTests.length > 0 && (
            <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
              <span style={{ color: "var(--accent-red)", fontWeight: 600 }}>Regressed ({delta.regressionTests.length}):</span> {list(delta.regressionTests)}
            </div>
          )}
          {!delta.improvedTests.length && !delta.regressionTests.length && (
            <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>All tests preserved their previous state.</div>
          )}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>PREV → CURRENT</div>
          <div style={{ fontSize: 20, fontWeight: 800, display: "flex", alignItems: "baseline", gap: 8, justifyContent: "flex-end" }}>
            <span style={{ color: "var(--text-muted)", fontSize: 15 }}>{delta.previousScore}</span>
            <span style={{ color: "var(--text-muted)", fontSize: 14 }}>→</span>
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
          <div className="glass-card" style={{ padding: 48, textAlign: "center", marginTop: 40, maxWidth: 600, margin: "40px auto 0" }}>
            <AlertCircle size={32} color="var(--accent-red)" style={{ margin: "0 auto 16px" }} />
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Radar Connection Interrupted</div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20, lineHeight: 1.6 }}>{dashboardError}</p>
            <button className="btn-primary" onClick={() => loadDashboard()}>
              <Zap size={14} /> Retry Radar Scan
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
          <div style={{ marginBottom: 24 }}>
            <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 4 }}>Release Intelligence Dashboard</h1>
            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
              {loginPrompt ? "Authentication credentials required for comprehensive inspection" : "Initializing RadarAI pipeline…"}
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
          <div style={{ marginBottom: 28 }}>
            <div className="skeleton" style={{ width: 260, height: 32, marginBottom: 8 }} />
            <div className="skeleton" style={{ width: 180, height: 16 }} />
          </div>
          <div className="glass-card" style={{ padding: 50, textAlign: "center", marginBottom: 28 }}>
            <div style={{ position: "relative", width: 64, height: 64, margin: "0 auto 18px" }}>
              <div style={{
                position: "absolute", inset: 0, borderRadius: "50%",
                background: "rgba(59, 130, 246, 0.15)",
              }} className="radar-pulse-ring" />
              <div style={{
                position: "relative", width: 64, height: 64, borderRadius: "50%",
                background: "rgba(59, 130, 246, 0.2)", display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Radio size={28} color="var(--accent-blue)" />
              </div>
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
              {progress || "RadarAI is scanning target website..."}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", maxWidth: 440, margin: "0 auto" }}>
              Simulating user journeys, auditing API contracts, analyzing security policies, and computing deterministic risk.
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
            {[1, 2, 3, 4].map(i => <div key={i} className="skeleton" style={{ height: 110 }} />)}
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
          <div style={{ marginBottom: 28 }}>
            <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 4 }}>Release Intelligence Dashboard</h1>
            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
              Connect a website to activate continuous release quality evaluation
            </p>
          </div>

          <ProjectConfigPanel />

          <div className="glass-card" style={{ padding: 48, textAlign: "center", marginBottom: 24 }}>
            <div style={{
              width: 58, height: 58, borderRadius: "20px",
              background: "linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(139, 92, 246, 0.2))",
              display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px",
              boxShadow: "0 8px 24px rgba(59, 130, 246, 0.2)",
            }}>
              <Radio size={28} color="var(--accent-blue)" />
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 8, letterSpacing: "-0.02em" }}>
              Welcome to Radar<span style={{ color: "var(--accent-blue)" }}>AI</span>
            </h2>
            <p style={{ fontSize: 13.5, color: "var(--text-secondary)", maxWidth: 520, margin: "0 auto 28px", lineHeight: 1.6 }}>
              Provide your <strong>project name</strong> and <strong>website URL</strong> above, then click <strong>Save &amp; Connect</strong>. RadarAI will initiate automated headless browsing, API validation, and deterministic release risk gating.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
              <OneUIStatWidget icon={FlaskConical} label="Tests Executed" value="0" sub="Awaiting scan" color="var(--accent-blue)" bg="rgba(59, 130, 246, 0.12)" />
              <OneUIStatWidget icon={CheckCircle2} label="Tests Passed" value="0" sub="0% pass rate" color="var(--accent-green)" bg="rgba(16, 185, 129, 0.12)" />
              <OneUIStatWidget icon={XCircle} label="Tests Failed" value="0" sub="0 issues" color="var(--accent-red)" bg="rgba(239, 68, 68, 0.12)" />
              <OneUIStatWidget icon={Zap} label="Pass Rate" value="0%" sub="Pipeline inactive" color="var(--accent-amber)" bg="rgba(245, 158, 11, 0.12)" />
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
        {/* Samsung One UI Viewing Area Header */}
        <div style={{ marginBottom: 28, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span className="badge badge-approved" style={{ fontSize: 11 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} /> LIVE RADAR ACTIVE
              </span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Updated {new Date(dashboard.lastUpdated).toLocaleTimeString()}
              </span>
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em" }}>
              {dashboard.project?.name || "Release Quality Overview"}
            </h1>
          </div>
          <div>
            <button
              className="btn-primary"
              onClick={() => refreshDashboard()}
            >
              <Zap size={14} /> Re-scan Release
            </button>
          </div>
        </div>

        {dashboard.delta?.hasDelta && <DeltaCard delta={dashboard.delta} />}

        <ProjectConfigPanel />

        {/* Samsung One UI Gatekeeper Verdict Banner */}
        <div className="glass-card" style={{
          padding: "20px 26px", marginBottom: 24,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          borderColor: riskOverview.deployment === "blocked" ? "rgba(239, 68, 68, 0.35)" : "rgba(16, 185, 129, 0.35)",
          background: riskOverview.deployment === "blocked" ? "rgba(239, 68, 68, 0.05)" : "rgba(16, 185, 129, 0.05)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{
              width: 44, height: 44, borderRadius: "16px",
              background: riskOverview.deployment === "blocked" ? "rgba(239, 68, 68, 0.15)" : "rgba(16, 185, 129, 0.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {riskOverview.deployment === "blocked"
                ? <ShieldAlert size={22} color="var(--accent-red)" />
                : <ShieldCheck size={22} color="var(--accent-green)" />
              }
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: "-0.01em" }}>
                Release Gate: {riskOverview.deployment === "blocked" ? "DEPLOYMENT BLOCKED" : "DEPLOYMENT APPROVED"}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 2 }}>
                {riskOverview.deployment === "blocked" && riskOverview.reasons?.length
                  ? riskOverview.reasons.join(" · ")
                  : "All deterministic quality benchmarks satisfied. Zero critical blockers."}
              </div>
            </div>
          </div>
          <span className={`badge badge-${riskOverview.deployment === "blocked" ? "blocked" : "approved"}`} style={{ fontSize: 12, padding: "6px 16px" }}>
            {riskOverview.deployment?.toUpperCase()}
          </span>
        </div>

        {/* 4 Samsung One UI Metric Widgets */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 16, marginBottom: 24 }}>
          <OneUIStatWidget
            icon={FlaskConical}
            label="Tests Executed"
            value={testMetrics.totalGenerated}
            sub={`${testMetrics.coverage.functional || 0} fn, ${testMetrics.coverage.security || 0} sec, ${testMetrics.coverage.accessibility || 0} a11y`}
            color="var(--accent-blue)"
            bg="rgba(59, 130, 246, 0.12)"
          />
          <OneUIStatWidget
            icon={CheckCircle2}
            label="Tests Passed"
            value={testMetrics.byStatus.passed}
            sub={`${passRate}% success rate`}
            color="var(--accent-green)"
            bg="rgba(16, 185, 129, 0.12)"
          />
          <OneUIStatWidget
            icon={XCircle}
            label="Tests Failed"
            value={testMetrics.byStatus.failed}
            sub={testMetrics.byStatus.failed === 0 ? "Zero defects" : "Action required"}
            color="var(--accent-red)"
            bg="rgba(239, 68, 68, 0.12)"
          />
          <OneUIStatWidget
            icon={Zap}
            label="Pass Rate"
            value={`${passRate}%`}
            sub={dashboard.pipelineDuration ? `Execution: ${dashboard.pipelineDuration}` : "Complete"}
            color={passRate >= 80 ? "var(--accent-green)" : passRate >= 60 ? "var(--accent-amber)" : "var(--accent-red)"}
            bg={passRate >= 80 ? "rgba(16, 185, 129, 0.12)" : "rgba(245, 158, 11, 0.12)"}
          />
        </div>

        {dashboard.exploration && <SiteExplorationCard exploration={dashboard.exploration} />}

        {/* Risk Radial Gauge + Impacted Modules */}
        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 20, marginBottom: 24 }}>
          <div className="glass-card" style={{ padding: 26 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>Release Risk Gauge</h2>
            <SamsungRiskGauge score={riskOverview.score} level={riskOverview.level} />
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 18, lineHeight: 1.6 }}>
              {riskOverview.explanation}
            </p>
          </div>

          <div className="glass-card" style={{ padding: 26 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Impacted Code Modules</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {impactedModules?.map((mod: { name: string; impact: string; filesChanged: number; linesChanged: number; description?: string }, i: number) => (
                <ModuleCard key={i} module={mod} />
              ))}
            </div>
          </div>
        </div>

        {/* Risk Factor Breakdown */}
        <div className="glass-card" style={{ padding: 26, marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Risk Factor Weights &amp; Distribution</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 18 }}>{riskOverview.formula}</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
            {riskOverview.factors?.map((factor: { name: string; score: number; description: string; weight: number }, i: number) => (
              <div key={i} className="stat-card" style={{ padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{factor.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>{Math.round(factor.weight * 100)}%</span>
                </div>
                <div className="progress-bar" style={{ marginBottom: 8 }}>
                  <div className="progress-bar-fill" style={{
                    width: `${factor.score}%`,
                    background: factor.score >= 70 ? "var(--accent-red)" : factor.score >= 40 ? "var(--accent-amber)" : "var(--accent-green)",
                  }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{factor.description}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: factor.score >= 70 ? "var(--accent-red)" : "var(--text-primary)" }}>{factor.score}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recommendations */}
        <div className="glass-card" style={{ padding: 26 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Actionable Recommendations</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {riskOverview.recommendations?.map((rec: string, i: number) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "12px 18px", background: "rgba(255, 255, 255, 0.02)",
                borderRadius: "14px", border: "1px solid var(--border-color)",
                fontSize: 13, color: "var(--text-secondary)",
              }}>
                <span style={{ color: "var(--accent-blue)", fontWeight: 700, flexShrink: 0 }}>#{i + 1}</span>
                {rec}
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
