import assert from "node:assert/strict";
import test from "node:test";
import { MEAL_RESEARCH_MODEL, requestMealResearch } from "../lib/meal-research-provider.ts";

test("meal provider uses Gemini Flash and exactly one web lookup", async () => {
  let received;
  const fakeFetch = async (url, options) => {
    received = { url, options };
    return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 });
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

  assert.equal(MEAL_RESEARCH_MODEL, "google/gemini-2.5-flash");
  assert.equal(received.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(received.options.headers.Authorization, "Bearer fake-key");
  const body = JSON.parse(received.options.body);
  assert.deepEqual(body.plugins, [{ id: "web", engine: "exa", max_results: 3 }]);
  assert.equal(body.max_tokens, 1500);
  assert.equal("tools" in body, false);
  assert.equal("max_tool_calls" in body, false);
});

test("retries without web augmentation when the first response has no text", async () => {
  const requests = [];
  const fakeFetch = async (url, options) => {
    requests.push(JSON.parse(options.body));
    const content = requests.length === 1 ? "" : JSON.stringify({ title: "Pasta", meal_type: "lunch", items: [] });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
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

  assert.equal(requests.length, 2);
  assert.ok(requests[0].plugins);
  assert.equal("plugins" in requests[1], false);
  assert.match(requests[1].messages.at(-1).content, /Return the meal JSON now/);
});
