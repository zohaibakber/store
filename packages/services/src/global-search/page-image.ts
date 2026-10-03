export const MAX_PAGE_HEAD_CHARS = 64 * 1024;
const MAX_WEB_URL_LENGTH = 2048;

const META_TAG = /<meta\s[^>]*>/gi;
const IMAGE_KEY =
  /\b(?:property|name)\s*=\s*["']?(og:image:secure_url|og:image:url|og:image|twitter:image:src|twitter:image)(?=["'\s/>])/i;
const CONTENT = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

const IMAGE_KEY_ORDER = [
  "og:image:secure_url",
  "og:image",
  "og:image:url",
  "twitter:image",
  "twitter:image:src",
];

export const httpsUrl = (value: string, base?: string): string | null => {
  const text = value.trim();
  if (!text || !URL.canParse(text, base)) return null;
  const url = new URL(text, base);
  return url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.href.length <= MAX_WEB_URL_LENGTH
    ? url.href
    : null;
};

export const pageImageFromHead = (html: string, pageUrl: string): string | null => {
  const found = new Map<string, string>();
  for (const [tag] of html.slice(0, MAX_PAGE_HEAD_CHARS).matchAll(META_TAG)) {
    const key = IMAGE_KEY.exec(tag)?.[1]?.toLowerCase();
    if (key === undefined || found.has(key)) continue;
    const content = CONTENT.exec(tag);
    const image = httpsUrl((content?.[1] ?? content?.[2] ?? "").replaceAll("&amp;", "&"), pageUrl);
    if (image !== null) found.set(key, image);
  }
  for (const key of IMAGE_KEY_ORDER) {
    const image = found.get(key);
    if (image !== undefined) return image;
  }
  return null;
};
