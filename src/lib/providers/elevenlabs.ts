export async function generateVoiceover(
  apiKey: string,
  voiceId: string,
  text: string,
  modelId: string = "eleven_multilingual_v2"
): Promise<ArrayBuffer> {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.5,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ElevenLabs API error: ${response.status} - ${error}`);
  }

  return response.arrayBuffer();
}

export async function listVoices(
  apiKey: string
): Promise<{ voice_id: string; name: string; category: string }[]> {
  const response = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": apiKey },
  });

  if (!response.ok) throw new Error(`ElevenLabs error: ${response.status}`);

  const data = await response.json();
  return data.voices.map((v: { voice_id: string; name: string; category: string }) => ({
    voice_id: v.voice_id,
    name: v.name,
    category: v.category,
  }));
}
