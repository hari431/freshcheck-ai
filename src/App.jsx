import { useState } from "react";

const STATUS_META = {
  Fresh: { className: "status-fresh", icon: "✓", label: "Fresh" },
  Outdated: { className: "status-outdated", icon: "!", label: "Outdated" },
  Uncertain: { className: "status-uncertain", icon: "?", label: "Uncertain" },
  Unverified: { className: "status-unverified", icon: "×", label: "Unverified" },
};

function isServiceIssue(reason) {
  return /judgment failed|failed|invalid response|no relevant/i.test(reason || "");
}

export default function App() {
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState(null);

  async function handleCheck(e) {
    e?.preventDefault();
    setError("");
    setResult(null);
    setCheckedAt(null);
    if (!answer.trim()) {
      setError("Please paste an answer to check.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status >= 500) {
          throw new Error("Verification service is unavailable. Please try again later.");
        }
        throw new Error(data?.error || "Request failed.");
      }
      setResult(data);
      setCheckedAt(new Date());
    } catch (err) {
      setError(err?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const counts = result?.claims?.reduce(
    (acc, c) => {
      acc.total += 1;
      if (c.failed) acc.Unverified = (acc.Unverified || 0) + 1;
      else acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    },
    { total: 0, Fresh: 0, Outdated: 0, Uncertain: 0, Unverified: 0 }
  );

  return (
    <div className="page">
      <header className="hero">
        <div className="hero-badge">AI Fact Verification</div>
        <h1>FreshCheck AI</h1>
        <p className="hero-sub">
          Paste an AI-generated answer and FreshCheck will verify each factual claim against live web
          evidence, marking it <strong>Fresh</strong>, <strong>Outdated</strong>, or <strong>Uncertain</strong>.
        </p>
      </header>

      <section className="card input-card">
        <label htmlFor="answer">AI-generated answer</label>
        <textarea
          id="answer"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Paste an AI-generated answer here…"
          rows={7}
          disabled={loading}
        />
        <div className="input-footer">
          <span className="char-count">{answer.trim().length} characters</span>
          <button type="button" onClick={handleCheck} disabled={loading || !answer.trim()}>
            {loading ? "Checking…" : "Check Freshness"}
          </button>
        </div>
        {error && <div className="error-banner">{error}</div>}
      </section>

      {loading && (
        <section className="card loading-card">
          <div className="spinner" aria-hidden="true" />
          <div>
            <p className="loading-title">Verifying claims…</p>
            <p className="muted">Searching the web and checking each claim. This may take a moment.</p>
          </div>
        </section>
      )}

      {result && (
        <section className="results">
          {result.mock && (
            <div className="mock-banner">
              ⚠ Mock result (UI testing only) — not real verification. {result.note}
            </div>
          )}
          {result.serviceError && (
            <div className="error-banner">{result.serviceError}</div>
          )}

          <div className="card summary-card">
            <div className="summary-head">
              <div>
                <h2>Verification Summary</h2>
                {checkedAt && (
                  <p className="muted">Checked on {checkedAt.toLocaleString()}</p>
                )}
              </div>
              <div className={`verdict-pill ${STATUS_META[result.verdict]?.className || (result.status === "service_failure" ? "status-unverified" : "")}`}>
                {result.status === "service_failure" ? "Unavailable" : result.verdict}
              </div>
            </div>

            {result.summary && <p className="summary-text">{result.summary}</p>}

            <div className="stats">
              <div className="stat">
                <span className="stat-value">{counts.total}</span>
                <span className="stat-label">Total claims</span>
              </div>
              <div className="stat stat-fresh">
                <span className="stat-value">{counts.Fresh}</span>
                <span className="stat-label">Fresh</span>
              </div>
              <div className="stat stat-outdated">
                <span className="stat-value">{counts.Outdated}</span>
                <span className="stat-label">Outdated</span>
              </div>
              <div className="stat stat-uncertain">
                <span className="stat-value">{counts.Uncertain}</span>
                <span className="stat-label">Uncertain</span>
              </div>
              {counts.Unverified > 0 && (
                <div className="stat stat-unverified">
                  <span className="stat-value">{counts.Unverified}</span>
                  <span className="stat-label">Unverified</span>
                </div>
              )}
            </div>
          </div>

          <h2 className="section-title">Claims</h2>
          {(!result.claims || result.claims.length === 0) && (
            <div className="card muted">No claims to display.</div>
          )}
          <div className="claims-grid">
            {result.claims?.map((c, i) => {
              const displayStatus = c.failed ? "Unverified" : c.status;
              const meta = STATUS_META[displayStatus] || STATUS_META.Uncertain;
              const issue = c.failed || isServiceIssue(c.reason);
              return (
                <article key={i} className="claim-card">
                  <div className="claim-top">
                    <span className={`status ${meta.className}`}>
                      <span className="status-icon">{meta.icon}</span>
                      {meta.label}
                    </span>
                    {issue && <span className="issue-badge">Service issue</span>}
                  </div>
                  <p className="claim-text">{c.claim}</p>
                  {c.reason && (
                    <p className={`reason ${issue ? "reason-issue" : ""}`}>{c.reason}</p>
                  )}
                  {c.evidence?.length > 0 && (
                    <div className="evidence-block">
                      <p className="evidence-title">Sources</p>
                      <ul className="evidence-list">
                        {c.evidence.map((e, j) => (
                          <li key={j}>
                            <a href={e.url} target="_blank" rel="noreferrer">
                              {e.title || e.url}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {!result && !loading && !error && (
        <section className="card empty-card">
          <p className="empty-title">No verification yet</p>
          <p className="muted">
            Paste an AI-generated answer above and click <strong>Check Freshness</strong> to begin.
          </p>
        </section>
      )}
    </div>
  );
}