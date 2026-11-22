import { ErrorCode } from "../../constants";
import { en } from "../en";
import { es } from "../es";
import { fr } from "../fr";
import { resolveLocale, getTranslations, locales } from "../index";

describe("resolveLocale", () => {
  it("defaults to en when no header", () => {
    expect(resolveLocale()).toBe("en");
    expect(resolveLocale("")).toBe("en");
  });

  it("resolves exact match", () => {
    expect(resolveLocale("es")).toBe("es");
    expect(resolveLocale("fr")).toBe("fr");
    expect(resolveLocale("en")).toBe("en");
  });

  it("resolves language from locale tag (es-MX, fr-CA)", () => {
    expect(resolveLocale("es-MX")).toBe("es");
    expect(resolveLocale("fr-CA")).toBe("fr");
  });

  it("resolves first matching language in list", () => {
    expect(resolveLocale("de, es;q=0.9, en;q=0.8")).toBe("es");
    expect(resolveLocale("de, fr;q=0.9, es;q=0.8")).toBe("fr");
  });

  it("falls back to en for unknown language", () => {
    expect(resolveLocale("de, ja")).toBe("en");
  });
});

describe("getTranslations", () => {
  it("returns English translations by default", () => {
    const t = getTranslations();
    expect(t.MISSING_XDR).toBe("Missing required field: xdr");
  });

  it("returns Spanish translations for es", () => {
    const t = getTranslations("es");
    expect(t.MISSING_XDR).toBe("Campo requerido faltante: xdr");
    expect(t.JOB_NOT_FOUND).toBe("Trabajo de webhook no encontrado");
  });

  it("returns Spanish translations for es-MX", () => {
    const t = getTranslations("es-MX, en;q=0.8");
    expect(t.MISSING_XDR).toBe("Campo requerido faltante: xdr");
  });

  it("returns French translations for fr", () => {
    const t = getTranslations("fr");
    expect(t.MISSING_XDR).toBe("Champ requis manquant : xdr");
    expect(t.JOB_NOT_FOUND).toBe("Tâche webhook introuvable");
  });

  it("returns French translations for fr-FR", () => {
    const t = getTranslations("fr-FR, en;q=0.8");
    expect(t.CIRCUIT_OPEN).toBe(
      "Service temporairement indisponible. Veuillez réessayer plus tard.",
    );
  });

  it("falls back gracefully to English when a locale has missing keys", () => {
    locales.pt = { MISSING_XDR: "Campo obrigatório ausente: xdr" };
    try {
      const t = getTranslations("pt");
      expect(t.MISSING_XDR).toBe("Campo obrigatório ausente: xdr");
      expect(t.INVALID_NETWORK).toBe(en.INVALID_NETWORK);
      expect(t.JOB_NOT_FOUND).toBe(en.JOB_NOT_FOUND);
    } finally {
      delete locales.pt;
    }
  });
});

describe("i18n key parity", () => {
  const englishKeys = Object.keys(en).sort();
  const errorCodes = Object.values(ErrorCode);

  it("covers all ErrorCode enum values in English", () => {
    for (const code of errorCodes) {
      expect(en).toHaveProperty(code);
      expect(typeof en[code as keyof typeof en]).toBe("string");
      expect(en[code as keyof typeof en].length).toBeGreaterThan(0);
    }
  });

  it("has 100% key parity between Spanish (es) and English (en)", () => {
    expect(Object.keys(es).sort()).toEqual(englishKeys);
    for (const key of englishKeys) {
      const value = es[key as keyof typeof es];
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it("has 100% key parity between French (fr) and English (en)", () => {
    expect(Object.keys(fr).sort()).toEqual(englishKeys);
    for (const key of englishKeys) {
      const value = fr[key as keyof typeof fr];
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
