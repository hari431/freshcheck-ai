/**
 * Send a chat completion request to a Bifrost (OpenAI-compatible) gateway.
 * @param {Array<{role:string,content:string}>} messages
 * @param {{ model?: string, temperature?: number }} [options]
 * @returns {Promise<string>}
 */
export async function bifrostChat(messages, { model, temperature = 0.2 } = {}) {
  const baseUrl = process.env.BIFROST_BASE_URL;
  const virtualKey = process.env.BIFROST_VIRTUAL_KEY;
  const resolvedModel = model || process.env.BIFROST_MODEL;

  if (!baseUrl) throw new Error("BIFROST_BASE_URL is not configured");
  if (!virtualKey) throw new Error("BIFROST_VIRTUAL_KEY is not configured");
  if (!resolvedModel) throw new Error("BIFROST_MODEL is not configured");

  // Normalize the base URL so callers can pass either "http://host" or
  // "http://host/v1" (Bifrost's OpenAI-compatible endpoint lives under /v1).
  let base = baseUrl.replace(/\/+$/, "");
  if (!/\/v\d+$/.test(base)) base += "/v1";
  const url = `${base}/chat/completions`;

  const maxAttempts = 3;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${virtualKey}`,
        },
        body: JSON.stringify({
          model: resolvedModel,
          messages,
          temperature,
        }),
      });
    } catch (err) {
      throw new Error(`Bifrost request failed: ${err.message}`);
    }

    if (res.ok) {
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error("Bifrost returned an unexpected response shape");
      }
      return content;
    }

    const body = await res.text().catch(() => "");
    lastError = new Error(`Bifrost request failed (${res.status}): ${body || res.statusText}`);

    // Retry only on transient rate-limit / server errors.
    const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
    if (!retryable || attempt === maxAttempts) {
      throw lastError;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
  }

  throw lastError || new Error("Bifrost request failed");
}