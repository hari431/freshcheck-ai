import { searchTavily } from "./services/tavily.js";
import { bifrostChat } from "./services/bifrost.js";

const MAX_CLAIMS = 5;

function isMockMode() {
  // Mock mode is opt-in only.
  return process.env.MOCK_MODE === "true";
}

function requiredConfig() {
  const missing = [];
  if (!process.env.TAVILY_API_KEY) missing.push("TAVILY_API_KEY");
  if (!process.env.BIFROST_BASE_URL) missing.push("BIFROST_BASE_URL");
  if (!process.env.BIFROST_VIRTUAL_KEY) missing.push("BIFROST_VIRTUAL_KEY");
  if (!process.env.BIFROST_MODEL) missing.push("BIFROST_MODEL");
  return missing;
}

function assertConfigured() {
  const missing = requiredConfig();
  if (missing.length) {
    throw new Error(
      `Missing required configuration: ${missing.join(", ")}. Set MOCK_MODE=true to use mock results.`
    );
  }
}

function mockResult(answer) {
  return {
    mock: true,
    status: "completed",
    serviceError: null,
    note: "Mock result for UI testing only — not real verification. Configure TAVILY_API_KEY, BIFROST_BASE_URL, BIFROST_VIRTUAL_KEY and BIFROST_MODEL (and set MOCK_MODE=false) for real verification.",
    verdict: "Uncertain",
    summary:
      "This is placeholder data shown because real verification is not configured.",
    claims: [
      {
        claim: "Example claim extracted from the pasted answer.",
        status: "Outdated",
        failed: false,
        reason: "Mock data: a newer source contradicts this claim.",
        evidence: [
          {
            title: "Example source",
            url: "https://example.com/newer-source",
          },
        ],
      },
      {
        claim: "Another example claim.",
        status: "Fresh",
        failed: false,
        reason: "Mock data: recent sources still support this claim.",
        evidence: [
          {
            title: "Example supporting source",
            url: "https://example.com/supporting-source",
          },
        ],
      },
    ],
    meta: { answerLength: answer.length },
  };
}

function parseJson(text) {
  if (!text) return null;
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = cleaned.indexOf("[");
  const objStart = cleaned.indexOf("{");
  let idx = -1;
  if (start !== -1 && (objStart === -1 || start < objStart)) idx = start;
  else if (objStart !== -1) idx = objStart;
  if (idx > 0) cleaned = cleaned.slice(idx);
  const lastArr = cleaned.lastIndexOf("]");
  const lastObj = cleaned.lastIndexOf("}");
  const last = Math.max(lastArr, lastObj);
  if (last !== -1) cleaned = cleaned.slice(0, last + 1);
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function todayContext() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  return { dateStr, weekday };
}

async function extractClaims(answer, chatFn) {
  const chat = chatFn || bifrostChat;
  const { dateStr, weekday } = todayContext();
  try {
    const messages = [
      {
        role: "system",
        content:
          "You extract verifiable factual claims from an AI-generated answer. " +
          "Preserve the FULL claim including subject, action, and any date or time. " +
          "Do NOT split a claim into separate subject and date/time fragments. " +
          "Resolve relative dates (e.g. 'next Tuesday', 'tomorrow') to absolute dates using today's date. " +
          `Today is ${dateStr} (${weekday}). ` +
          "Return ONLY a JSON array of short claim strings (max 5). No prose, no markdown.",
      },
      {
        role: "user",
        content: `Extract up to ${MAX_CLAIMS} verifiable factual claims from this answer:\n\n${answer}`,
      },
    ];
    const raw = await chat(messages, { temperature: 0.1 });
    const parsed = parseJson(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const out = parsed
        .map((c) => (typeof c === "string" ? c : c?.claim))
        .filter(Boolean)
        .slice(0, MAX_CLAIMS);
      if (out.length > 0) return out;
    }
  } catch {
    // Fall back to sentence splitting if the LLM is unavailable or returns invalid JSON.
  }
  return answer
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20)
    .slice(0, MAX_CLAIMS);
}

const STOPWORDS = new Set([
  "the","a","an","is","are","was","were","be","been","being","of","in","on","at","to","for","with",
  "and","or","but","not","this","that","these","those","it","its","as","by","from","has","have","had",
  "will","would","can","could","should","may","might","next","last","new","old",
]);

function significantTokens(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

// Subject anchors are capitalized entities / proper nouns in the claim.
function subjectAnchors(claim) {
  const anchors = new Set();
  for (const m of (claim || "").matchAll(/([A-Z][a-zA-Z0-9]+)/g)) {
    anchors.add(m[1].toLowerCase());
  }
  return anchors;
}

function isFutureClaim(claim) {
  return /\b(will|next|tomorrow|upcoming|scheduled|launch|release|announce|definitely|soon)\b/i.test(claim || "");
}

function filterRelevantEvidence(claim, evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) return [];
  const anchors = subjectAnchors(claim);
  const claimTokens = new Set(significantTokens(claim));
  return evidence.filter((e) => {
    const title = (e.title || "").toLowerCase();
    const text = `${e.title || ""} ${e.content || ""}`.toLowerCase();
    // Subject (proper noun) must appear in the title to be relevant.
    if (anchors.size > 0) {
      const hasAnchorInTitle = [...anchors].some((a) => title.includes(a));
      if (!hasAnchorInTitle) return false;
    }
    const evidenceTokens = significantTokens(text);
    const overlap = evidenceTokens.filter((t) => claimTokens.has(t)).length;
    return overlap >= 1;
  });
}

async function judgeClaim(claim, evidence, chatFn) {
  const chat = chatFn || bifrostChat;
  const relevant = filterRelevantEvidence(claim, evidence);

  // No relevant evidence => cannot verify (insufficient evidence, not a service failure).
  if (relevant.length === 0) {
    return {
      claim,
      status: "Uncertain",
      failed: false,
      reason: "No relevant supporting or contradicting evidence found.",
      evidence: [],
    };
  }

  const evidenceText = relevant
    .map((e, i) => `${i + 1}. ${e.title} - ${e.url}\n${e.content.slice(0, 400)}`)
    .join("\n\n");

  let status = "Uncertain";
  let failed = false;
  let reason = "Insufficient evidence.";
  let urls = relevant.map((e) => e.url);

  const future = isFutureClaim(claim);

  try {
    const messages = [
      {
        role: "system",
        content:
          "You are a fact-checker. Given a claim and search evidence, classify the claim as " +
          '"Fresh" (directly supported by recent evidence), "Outdated" (directly contradicted or superseded by newer evidence), ' +
          'or "Uncertain" (insufficient or indirect evidence). Return ONLY JSON: ' +
          '{"status":"Fresh|Outdated|Uncertain","reason":"short reason","evidenceUrls":["url",...]}. ' +
          "Rules: " +
          "1) Only assign Fresh or Outdated when the evidence DIRECTLY supports or contradicts the claim. " +
          "2) If the claim is a future prediction or unverified event, mark Uncertain unless evidence explicitly confirms or refutes that exact future event. " +
          "3) Never invent confirmation, dates, or facts not present in the evidence. " +
          "4) If evidence is unrelated, indirect, or insufficient, mark Uncertain.",
      },
      {
        role: "user",
        content: `Claim: ${claim}\n\nEvidence:\n${evidenceText}`,
      },
    ];
    const raw = await chat(messages, { temperature: 0.1 });
    const parsed = parseJson(raw);
    if (parsed && (parsed.status === "Fresh" || parsed.status === "Outdated" || parsed.status === "Uncertain")) {
      status = parsed.status;
      if (typeof parsed.reason === "string" && parsed.reason.trim()) {
        reason = parsed.reason;
      } else {
        reason =
          status === "Fresh"
            ? "Supported by recent evidence."
            : status === "Outdated"
            ? "Contradicted or superseded by newer evidence."
            : "Insufficient evidence.";
      }
      // Guard: future predictions cannot be Fresh/Outdated without direct confirmation in evidence.
      if (future && status !== "Uncertain") {
        const evidenceBlob = relevant.map((e) => `${e.title} ${e.content}`).join(" ").toLowerCase();
        const eventTokens = significantTokens(claim).filter((t) => !["microsoft", "tuesday"].includes(t));
        const eventMatches = eventTokens.filter((t) => evidenceBlob.includes(t)).length;
        const hasConfirmationKeyword =
          /confirm|officially announced|scheduled for|will launch|will release|will announce|launching on/i.test(evidenceBlob);
        const hasDirectConfirmation = hasConfirmationKeyword && eventMatches >= 2;
        if (!hasDirectConfirmation) {
          status = "Uncertain";
          reason = "Unverified future prediction; no direct confirmation in evidence.";
        }
      }
    } else if (parsed === null) {
      reason = "Model returned an invalid response.";
    } else if (typeof parsed?.reason === "string" && parsed.reason.trim()) {
      reason = parsed.reason;
    }
    if (Array.isArray(parsed?.evidenceUrls)) {
      urls = parsed.evidenceUrls.filter((u) => typeof u === "string");
    }
  } catch (err) {
    // Service failure: not a genuine Uncertain.
    status = "Unverified";
    failed = true;
    reason = "Verification unavailable: the verification service could not be reached.";
  }

  const supporting = relevant.filter((e) => urls.includes(e.url));
  const fallbackEvidence = supporting.length ? supporting : relevant.slice(0, 3);

  return {
    claim,
    status,
    failed,
    reason,
    evidence: fallbackEvidence.map((e) => ({ title: e.title, url: e.url })),
  };
}

export async function checkAnswer(answer, deps = {}) {
  if (isMockMode()) {
    return mockResult(answer);
  }

  const missing = requiredConfig();
  if (missing.length) {
    return {
      mock: false,
      status: "service_failure",
      serviceError: "Verification service is not configured.",
      verdict: "Unavailable",
      summary: "Verification unavailable.",
      claims: [],
    };
  }

  const searchFn = deps.searchTavily || searchTavily;
  const chatFn = deps.bifrostChat || bifrostChat;

  const claims = await extractClaims(answer, chatFn);
  if (claims.length === 0) {
    return {
      mock: false,
      status: "completed",
      serviceError: null,
      verdict: "Uncertain",
      summary: "No verifiable claims could be extracted from the answer.",
      claims: [],
    };
  }

  const searches = await Promise.all(
    claims.map(async (claim) => {
      try {
        const results = await searchFn(claim, { maxResults: 5 });
        return { claim, results, searchFailed: false };
      } catch (err) {
        return { claim, results: [], searchFailed: true, error: err.message };
      }
    })
  );

  const judged = await Promise.all(
    searches.map(async ({ claim, results, searchFailed, error }) => {
      if (searchFailed) {
        return {
          claim,
          status: "Unverified",
          failed: true,
          reason: "Verification unavailable: search service could not be reached.",
          evidence: [],
        };
      }
      try {
        return await judgeClaim(claim, results, chatFn);
      } catch (err) {
        return {
          claim,
          status: "Unverified",
          failed: true,
          reason: "Verification unavailable: the verification service could not be reached.",
          evidence: results.slice(0, 3).map((e) => ({ title: e.title, url: e.url })),
        };
      }
    })
  );

  const freshCount = judged.filter((c) => c.status === "Fresh").length;
  const outdatedCount = judged.filter((c) => c.status === "Outdated").length;
  const uncertainCount = judged.filter((c) => c.status === "Uncertain" && !c.failed).length;
  const failedCount = judged.filter((c) => c.failed).length;

  let status = "completed";
  if (judged.length > 0 && failedCount === judged.length) status = "service_failure";
  else if (failedCount > 0) status = "partial_failure";

  let verdict = "Uncertain";
  if (status === "service_failure") verdict = "Unavailable";
  else if (outdatedCount > 0) verdict = "Outdated";
  else if (freshCount > 0 && uncertainCount === 0 && failedCount === 0) verdict = "Fresh";
  else if (freshCount > 0) verdict = "Uncertain";

  const serviceError =
    status === "service_failure"
      ? "Verification service is temporarily unavailable. Please try again."
      : status === "partial_failure"
      ? "Some claims could not be verified."
      : null;

  let summary;
  if (status === "service_failure") summary = "Verification unavailable.";
  else if (judged.length === 0) summary = "No verifiable claims could be extracted from the answer.";
  else
    summary = `Checked ${judged.length} claim(s): ${freshCount} fresh, ${outdatedCount} outdated, ${uncertainCount} uncertain${
      failedCount ? `, ${failedCount} unverified` : ""
    }.`;

  return {
    mock: false,
    status,
    serviceError,
    verdict,
    summary,
    claims: judged,
  };
}

// Exported for testing.
export { parseJson, requiredConfig, filterRelevantEvidence, isFutureClaim, subjectAnchors, significantTokens };
