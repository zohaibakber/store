const WHATSAPP_URL_PREFIX = "https://wa.me/";

const WHATSAPP_URL_MAX_LENGTH = 2000;

const WHATSAPP_PHONE_PATH = /^\/[0-9]{1,20}$/u;

const whatsAppPhone = (phone: string | null | undefined): string | null => {
  const digits = (phone ?? "").replace(/[^0-9]/gu, "");
  return digits.length > 0 && digits.length <= 20 ? digits : null;
};

const whatsAppOrderUrl = (phone: string, text: string): string =>
  `${WHATSAPP_URL_PREFIX}${phone}?text=${encodeURIComponent(text)}`;

export const isWhatsAppUrl = (candidate: string): boolean => {
  if (candidate.length > WHATSAPP_URL_MAX_LENGTH) return false;
  if (!candidate.startsWith(WHATSAPP_URL_PREFIX)) return false;
  const url = URL.parse(candidate);
  return (
    url !== null &&
    `${url.origin}/` === WHATSAPP_URL_PREFIX &&
    url.username === "" &&
    url.password === "" &&
    url.hash === "" &&
    WHATSAPP_PHONE_PATH.test(url.pathname)
  );
};

export type WhatsAppLink =
  | { readonly _tag: "Ready"; readonly url: string }
  | { readonly _tag: "NoPhone" }
  | { readonly _tag: "TooLong" };

export const whatsAppLink = (phone: string | null | undefined, text: string): WhatsAppLink => {
  const digits = whatsAppPhone(phone);
  if (digits === null) return { _tag: "NoPhone" };
  const url = whatsAppOrderUrl(digits, text);
  return url.length > WHATSAPP_URL_MAX_LENGTH ? { _tag: "TooLong" } : { _tag: "Ready", url };
};
