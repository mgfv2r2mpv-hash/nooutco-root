export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API proxy endpoint for LLM calls
    if (url.pathname === "/api/llm-call" && request.method === "POST") {
      return handleLlmCall(request, env);
    }

    const response = await env.ASSETS.fetch(request);

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return response;
    }

    const secret = (env.ADMIN_SECRET ?? "").trim();
    const hash = await sha256Hex(secret);
    let html = await response.text();
    html = html.replace(
      /const ADMIN_SECRET_HASH = "[a-f0-9]{64}";/g,
      `const ADMIN_SECRET_HASH = "${hash}";`
    );

    const headers = new Headers(response.headers);
    headers.delete("content-length");

    return new Response(html, { status: response.status, headers });
  },
};

async function handleLlmCall(request, env) {
  try {
    const body = await request.json();
    const { provider, apiKey, systemPrompt, userPrompt, model, maxTokens } = body;

    if (!provider || !apiKey || !systemPrompt || !userPrompt) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: provider, apiKey, systemPrompt, userPrompt" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    let llmResponse;
    if (provider === "anthropic") {
      llmResponse = await callAnthropicApi(apiKey, systemPrompt, userPrompt, model || "claude-haiku-4-5-20251001", maxTokens || 2048);
    } else if (provider === "openai") {
      llmResponse = await callOpenAiApi(apiKey, systemPrompt, userPrompt, model || "gpt-4o-mini", maxTokens || 2048);
    } else if (provider === "gemini") {
      llmResponse = await callGeminiApi(apiKey, systemPrompt, userPrompt, model || "gemini-2.5-flash", maxTokens || 2048);
    } else {
      return new Response(
        JSON.stringify({ error: `Unsupported provider: ${provider}` }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(llmResponse), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("LLM call error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function callAnthropicApi(apiKey, systemPrompt, userPrompt, model, maxTokens) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Anthropic API error ${response.status}: ${error?.error?.message || response.statusText}`);
  }

  return await response.json();
}

async function callOpenAiApi(apiKey, systemPrompt, userPrompt, model, maxTokens) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`OpenAI API error ${response.status}: ${error?.error?.message || response.statusText}`);
  }

  return await response.json();
}

async function callGeminiApi(apiKey, systemPrompt, userPrompt, model, maxTokens) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Gemini API error ${response.status}: ${error?.error?.message || response.statusText}`);
  }

  return await response.json();
}

async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}
