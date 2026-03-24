export interface PexelsVideo {
  id: number;
  url: string;
  duration: number;
  video_files: { link: string; quality: string; width: number; height: number }[];
  video_pictures: { picture: string }[];
}

export async function searchVideos(
  apiKey: string,
  query: string,
  perPage: number = 10,
  orientation: "landscape" | "portrait" = "landscape"
): Promise<PexelsVideo[]> {
  const params = new URLSearchParams({
    query,
    per_page: perPage.toString(),
    orientation,
  });

  const response = await fetch(
    `https://api.pexels.com/videos/search?${params}`,
    { headers: { Authorization: apiKey } }
  );

  if (!response.ok) throw new Error(`Pexels error: ${response.status}`);

  const data = await response.json();
  return data.videos;
}

export async function searchPhotos(
  apiKey: string,
  query: string,
  perPage: number = 10,
  orientation: "landscape" | "portrait" = "landscape"
): Promise<{ id: number; url: string; src: { large2x: string; original: string } }[]> {
  const params = new URLSearchParams({
    query,
    per_page: perPage.toString(),
    orientation,
  });

  const response = await fetch(
    `https://api.pexels.com/v1/search?${params}`,
    { headers: { Authorization: apiKey } }
  );

  if (!response.ok) throw new Error(`Pexels error: ${response.status}`);

  const data = await response.json();
  return data.photos;
}
