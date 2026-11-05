import "dotenv/config";
import { tavily } from "@tavily/core";

const client = tavily({
  apiKey: process.env.TAVILY_API_KEY,
});

try {
  const result = await client.search(
    "Latest Node.js release November 2026",
    {
      searchDepth: "basic",
      maxResults: 3,
    }
  );

  console.log("Tavily API connected successfully!");

  for (const item of result.results ?? []) {
    console.log("Title:", item.title);
    console.log("URL:", item.url);
    console.log("---");
  }
} catch (error) {
  console.error("Tavily request failed:", error.message);
  process.exitCode = 1;
}