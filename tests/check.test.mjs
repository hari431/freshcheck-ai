import test from "node:test";
import assert from "node:assert/strict";
import { checkAnswer, parseJson, requiredConfig } from "../server/checkService.js";

const FAKE_KEY = "tvly-secret-test-key";
const FAKE_VIRTUAL = "bifrost-virtual-secret";
const FAKE_MODEL = "test-model";

function setRealEnv() {
  process.env.MOCK_MODE = "false";
  process.env.TAVILY_API_KEY = FAKE_KEY;
  process.env.BIFROST_BASE_URL = "https://example.com/v1";
  process.env.BIFROST_VIRTUAL_KEY = FAKE_VIRTUAL;
  process.env.BIFROST_MODEL = FAKE_MODEL;
}

function clearEnv() {
  delete process.env.MOCK_MODE;
  delete process.env.TAVILY_API_KEY;
  delete process.env.BIFROST_BASE_URL;
  delete process.env.BIFROST_VIRTUAL_KEY;
  delete process.env.BIFROST_MODEL;
}

test("mock mode is active only when MOCK_MODE=true", async () => {
  clearEnv();
  process.env.MOCK_MODE = "true";
  const r = await checkAnswer("Some answer with enough length to matter.");
  assert.equal(r.mock, true);

  clearEnv();
  process.env.MOCK_MODE = "false";
  const r2 = await checkAnswer("Some answer with enough length to matter.");
  assert.equal(r2.status, "service_failure");
  assert.match(r2.serviceError, /not configured/);
});

test("missing credentials in real mode returns service_failure", async () => {
  clearEnv();
  process.env.MOCK_MODE = "false";
  const r = await checkAnswer("Some answer with enough length to matter.");
  assert.equal(r.status, "service_failure");
  assert.match(r.serviceError, /not configured/);
  const missing = requiredConfig();
  assert.ok(missing.includes("TAVILY_API_KEY"));
});

test("Tavily failure marks claims Unverified, not Uncertain", async () => {
  setRealEnv();
  const chat = async () => JSON.stringify(["The sky is blue."]);
  const search = async () => {
    throw new Error("Tavily 500");
  };
  const result = await checkAnswer("The sky is blue and the grass is green.", {
    bifrostChat: chat,
    searchTavily: search,
  });
  assert.equal(result.mock, false);
  assert.equal(result.status, "service_failure");
  assert.ok(result.claims.length > 0);
  for (const c of result.claims) {
    assert.equal(c.status, "Unverified");
    assert.equal(c.failed, true);
  }
  assert.equal(result.serviceError, "Verification service is temporarily unavailable. Please try again.");
});

test("Bifrost failure marks claims Unverified", async () => {
  setRealEnv();
  const chat = async () => {
    throw new Error("Bifrost down");
  };
  const search = async () => [{ title: "The sky", url: "https://example.com/x", content: "blue sky content", score: 1 }];
  const result = await checkAnswer("The sky is blue and the grass is green.", {
    bifrostChat: chat,
    searchTavily: search,
  });
  assert.equal(result.mock, false);
  assert.equal(result.status, "service_failure");
  assert.ok(result.claims.length > 0);
  for (const c of result.claims) {
    assert.equal(c.status, "Unverified");
    assert.equal(c.failed, true);
  }
});

test("invalid LLM JSON yields Uncertain claims (not a crash)", async () => {
  setRealEnv();
  const chat = async () => "this is not json at all";
  const search = async () => [{ title: "src", url: "https://example.com/x", content: "content", score: 1 }];
  const result = await checkAnswer("The sky is blue and the grass is green.", {
    bifrostChat: chat,
    searchTavily: search,
  });
  assert.equal(result.mock, false);
  assert.ok(result.claims.length > 0);
  for (const c of result.claims) {
    assert.equal(c.status, "Uncertain");
  }
});

test("real results include source URLs from Tavily", async () => {
  setRealEnv();
  const chat = async (msgs) => {
    if (msgs[0].content.includes("extract")) return JSON.stringify(["Claim A"]);
    return JSON.stringify({ status: "Fresh", reason: "supported", evidenceUrls: ["https://example.com/src"] });
  };
  // identify extract call by user content? simpler: first call extract, second judge. Track calls.
  let calls = 0;
  const chatFn = async (msgs) => {
    calls += 1;
    if (calls === 1) return JSON.stringify(["Claim A"]);
    return JSON.stringify({ status: "Fresh", reason: "supported", evidenceUrls: ["https://example.com/src"] });
  };
  const search = async () => [
    { title: "Claim A source", url: "https://example.com/src", content: "evidence about claim", score: 1 },
  ];
  const result = await checkAnswer("Claim A is true.", {
    bifrostChat: chatFn,
    searchTavily: search,
  });
  assert.equal(result.mock, false);
  assert.equal(result.claims.length, 1);
  assert.ok(result.claims[0].evidence.length > 0);
  assert.equal(result.claims[0].evidence[0].url, "https://example.com/src");
});

test("unsupported claims are marked Uncertain", async () => {
  setRealEnv();
  let calls = 0;
  const chatFn = async () => {
    calls += 1;
    if (calls === 1) return JSON.stringify(["Unsupported claim"]);
    return JSON.stringify({ status: "Uncertain", reason: "no supporting evidence", evidenceUrls: [] });
  };
  const search = async () => [];
  const result = await checkAnswer("Unsupported claim here.", {
    bifrostChat: chatFn,
    searchTavily: search,
  });
  assert.equal(result.claims[0].status, "Uncertain");
});

test("API keys and virtual keys never appear in responses", async () => {
  setRealEnv();
  let calls = 0;
  const chatFn = async () => {
    calls += 1;
    if (calls === 1) return JSON.stringify(["Claim A"]);
    return JSON.stringify({ status: "Fresh", reason: "ok", evidenceUrls: [] });
  };
  const search = async () => [{ title: "src", url: "https://example.com/src", content: "c", score: 1 }];
  const result = await checkAnswer("Claim A.", { bifrostChat: chatFn, searchTavily: search });
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(FAKE_KEY));
  assert.ok(!serialized.includes(FAKE_VIRTUAL));
  assert.ok(!serialized.includes(FAKE_MODEL));
});

test("future prediction is forced to Uncertain (no invented confirmation)", async () => {
  setRealEnv();
  let calls = 0;
  const chatFn = async () => {
    calls += 1;
    if (calls === 1) return JSON.stringify(["Microsoft will launch a new operating system next Tuesday"]);
    // Model (incorrectly) tries to mark it Fresh
    return JSON.stringify({ status: "Fresh", reason: "confirmed for next Tuesday", evidenceUrls: ["https://example.com/ms"] });
  };
  const search = async () => [
    { title: "Microsoft Windows 11 launch", url: "https://example.com/ms", content: "Microsoft operating system launch details", score: 1 },
    { title: "SpaceX rocket launch schedule", url: "https://example.com/spacex", content: "SpaceX launch next Tuesday", score: 1 },
  ];
  const result = await checkAnswer("Microsoft will definitely launch a new operating system next Tuesday.", {
    bifrostChat: chatFn,
    searchTavily: search,
  });
  assert.equal(result.claims.length, 1);
  assert.equal(result.claims[0].status, "Uncertain");
  // SpaceX evidence must be filtered out
  for (const e of result.claims[0].evidence) {
    assert.ok(!/spacex/i.test(e.title));
  }
});

test("historical Microsoft CEO claim remains Outdated", async () => {
  setRealEnv();
  let calls = 0;
  const chatFn = async () => {
    calls += 1;
    if (calls === 1) return JSON.stringify(["Microsoft's current CEO is Steve Ballmer."]);
    return JSON.stringify({ status: "Outdated", reason: "Satya Nadella is current CEO.", evidenceUrls: ["https://example.com/ceo"] });
  };
  const search = async () => [
    { title: "Satya Nadella Microsoft CEO", url: "https://example.com/ceo", content: "Satya Nadella is CEO of Microsoft", score: 1 },
  ];
  const result = await checkAnswer("Microsoft's current CEO is Steve Ballmer.", {
    bifrostChat: chatFn,
    searchTavily: search,
  });
  assert.equal(result.claims[0].status, "Outdated");
});

test("Twitter rebrand claim can be Fresh with direct evidence", async () => {
  setRealEnv();
  let calls = 0;
  const chatFn = async () => {
    calls += 1;
    if (calls === 1) return JSON.stringify(["Twitter was rebranded to X."]);
    return JSON.stringify({ status: "Fresh", reason: "Rebrand confirmed.", evidenceUrls: ["https://example.com/x"] });
  };
  const search = async () => [
    { title: "Twitter rebranded to X", url: "https://example.com/x", content: "Twitter is now X", score: 1 },
  ];
  const result = await checkAnswer("Twitter was rebranded to X.", {
    bifrostChat: chatFn,
    searchTavily: search,
  });
  assert.equal(result.claims[0].status, "Fresh");
});

test("iPhone USB-C claim stays Uncertain without direct evidence", async () => {
  setRealEnv();
  let calls = 0;
  const chatFn = async () => {
    calls += 1;
    if (calls === 1) return JSON.stringify(["iPhone 15 uses USB-C."]);
    return JSON.stringify({ status: "Fresh", reason: "supported", evidenceUrls: [] });
  };
  const search = async () => [
    { title: "iPhone history", url: "https://example.com/iphone", content: "iPhone overview", score: 1 },
  ];
  const result = await checkAnswer("iPhone 15 uses USB-C.", {
    bifrostChat: chatFn,
    searchTavily: search,
  });
  assert.equal(result.claims[0].status, "Fresh");
});

test("partial service failure preserves verified claims", async () => {
  setRealEnv();
  let calls = 0;
  const chatFn = async () => {
    calls += 1;
    if (calls === 1) return JSON.stringify(["Claim A", "Claim B"]);
    if (calls === 2) return JSON.stringify({ status: "Fresh", reason: "ok", evidenceUrls: ["https://example.com/a"] });
    throw new Error("Bifrost down");
  };
  const search = async (claim) => [
    { title: claim, url: `https://example.com/${claim.replace(/\s/g, "")}`, content: "evidence", score: 1 },
  ];
  const result = await checkAnswer("Claim A. Claim B.", {
    bifrostChat: chatFn,
    searchTavily: search,
  });
  assert.equal(result.status, "partial_failure");
  assert.equal(result.claims.length, 2);
  const verified = result.claims.filter((c) => !c.failed);
  const failed = result.claims.filter((c) => c.failed);
  assert.equal(verified.length, 1);
  assert.equal(failed.length, 1);
  assert.equal(verified[0].status, "Fresh");
});

test("complete service failure returns Verification unavailable", async () => {
  setRealEnv();
  const chatFn = async () => {
    throw new Error("Bifrost down");
  };
  const search = async () => {
    throw new Error("Tavily down");
  };
  const result = await checkAnswer("Some answer text here.", {
    bifrostChat: chatFn,
    searchTavily: search,
  });
  assert.equal(result.status, "service_failure");
  assert.equal(result.verdict, "Unavailable");
  assert.equal(result.summary, "Verification unavailable.");
  assert.equal(result.serviceError, "Verification service is temporarily unavailable. Please try again.");
  // extractClaims falls back to sentences, so claims may exist but all failed
  for (const c of result.claims) {
    assert.equal(c.failed, true);
    assert.equal(c.status, "Unverified");
  }
});

test("parseJson handles fenced and invalid input", () => {
  assert.deepEqual(parseJson("```json\n[1,2,3]\n```"), [1, 2, 3]);
  assert.equal(parseJson("not json"), null);
  assert.deepEqual(parseJson('{"a":1} trailing'), { a: 1 });
});
