import OpenAI from "openai";

export async function generateWithGPT(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 4096
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const client = new OpenAI({ apiKey });

  const response = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  return {
    text: response.choices[0]?.message?.content ?? "",
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
  };
}

export async function generateImage(
  apiKey: string,
  prompt: string,
  size: "1024x1024" | "1792x1024" | "1024x1792" = "1792x1024"
): Promise<{ url: string; revisedPrompt: string }> {
  const client = new OpenAI({ apiKey });

  const response = await client.images.generate({
    model: "dall-e-3",
    prompt,
    n: 1,
    size,
    quality: "hd",
  });

  const imageData = response.data?.[0];
  return {
    url: imageData?.url ?? "",
    revisedPrompt: imageData?.revised_prompt ?? "",
  };
}
