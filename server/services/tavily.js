import { tavily } from "@tavily/core";

/**
 * Run a Tavily search for the given query.
 * @param {string} query
 * @param {{ maxResults?: number }} [options]
 * @returns {Promise<Array<{title:string,url:string,content:string,score:number}>>}
 */
export async function searchTavily(query, { maxResults = 5 } = {}) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY is not configured");

  const client = tavily({ apiKey });
  const result = await client.search(query, {
    searchDepth: "basic",
    maxResults,
  });

  return (result?.results ?? []).map((item) => ({
    title: item.title ?? "",
    url: item.url ?? "",
    content: item.content ?? "",
    score: typeof item.score === "number" ? item.score : 0,
  }));
}