import test from "node:test";
import assert from "node:assert/strict";
import { searchTavily } from "../server/services/tavily.js";
import { bifrostChat } from "../server/services/bifrost.js";

test("Tavily service throws when API key missing", async () => {
  const prev = process.env.TAVILY_API_KEY;
  delete process.env.TAVILY_API_KEY;
  await assert.rejects(() => searchTavily("query"), /TAVILY_API_KEY is not configured/);
  if (prev) process.env.TAVILY_API_KEY = prev;
});

test("Bifrost service throws when base URL missing", async () => {
  const prevUrl = process.env.BIFROST_BASE_URL;
  const prevKey = process.env.BIFROST_VIRTUAL_KEY;
  const prevModel = process.env.BIFROST_MODEL;
  delete process.env.BIFROST_BASE_URL;
  process.env.BIFROST_VIRTUAL_KEY = "vk";
  process.env.BIFROST_MODEL = "m";
  await assert.rejects(() => bifrostChat([{ role: "user", content: "hi" }]), /BIFROST_BASE_URL is not configured/);
  if (prevUrl) process.env.BIFROST_BASE_URL = prevUrl;
  else delete process.env.BIFROST_BASE_URL;
  if (prevKey) process.env.BIFROST_VIRTUAL_KEY = prevKey;
  else delete process.env.BIFROST_VIRTUAL_KEY;
  if (prevModel) process.env.BIFROST_MODEL = prevModel;
  else delete process.env.BIFROST_MODEL;
});

test("Bifrost service throws on HTTP failure", async () => {
  process.env.BIFROST_BASE_URL = "http://127.0.0.1:1";
  process.env.BIFROST_VIRTUAL_KEY = "vk";
  process.env.BIFROST_MODEL = "m";
  await assert.rejects(() => bifrostChat([{ role: "user", content: "hi" }]));
});

test("Bifrost service normalizes base URL to /v1", async () => {
  const prevUrl = process.env.BIFROST_BASE_URL;
  const prevKey = process.env.BIFROST_VIRTUAL_KEY;
  const prevModel = process.env.BIFROST_MODEL;
  process.env.BIFROST_BASE_URL = "http://127.0.0.1:9"; // no /v1
  process.env.BIFROST_VIRTUAL_KEY = "vk";
  process.env.BIFROST_MODEL = "m";

  const originalFetch = global.fetch;
  let capturedUrl = null;
  global.fetch = async (url) => {
    capturedUrl = url;
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const content = await bifrostChat([{ role: "user", content: "hi" }]);
    assert.equal(content, "ok");
    assert.ok(capturedUrl.endsWith("/v1/chat/completions"), capturedUrl);
  } finally {
    global.fetch = originalFetch;
    if (prevUrl) process.env.BIFROST_BASE_URL = prevUrl;
    else delete process.env.BIFROST_BASE_URL;
    if (prevKey) process.env.BIFROST_VIRTUAL_KEY = prevKey;
    else delete process.env.BIFROST_VIRTUAL_KEY;
    if (prevModel) process.env.BIFROST_MODEL = prevModel;
    else delete process.env.BIFROST_MODEL;
  }
});
