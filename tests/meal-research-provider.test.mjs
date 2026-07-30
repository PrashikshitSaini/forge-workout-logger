import assert from "node:assert/strict";
import test from "node:test";
import { MEAL_RESEARCH_MODEL, requestMealResearch } from "../lib/meal-research-provider.ts";

test("meal provider uses Gemini Flash and exactly one web lookup", async () => {
  let received;
  const fakeFetch = async (url, options) => {
    received = { url, options };
    return new Response(JSON.stringify({ choices: [] }), { status: 200 });
  };

  await requestMealResearch(
    {
      apiKey: "fake-key",
      siteUrl: "https://forge.example",
      title: "Forge",
      messages: [{ role: "user", content: "100g dry elbow pasta" }],
    },
    fakeFetch,
  );

  assert.equal(MEAL_RESEARCH_MODEL, "google/gemini-3.5-flash");
  assert.equal(received.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(received.options.headers.Authorization, "Bearer fake-key");
  const body = JSON.parse(received.options.body);
  assert.deepEqual(body.plugins, [{ id: "web", engine: "exa", max_results: 3 }]);
  assert.equal(body.max_tokens, 1500);
  assert.equal("tools" in body, false);
  assert.equal("max_tool_calls" in body, false);
});
