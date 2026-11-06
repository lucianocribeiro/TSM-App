import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { buildFirmaPath, buildReciboPath, parseFirmaPath, parseReciboPath } = await import("./paths");

const EMP = "11111111-1111-4111-8111-111111111111";
const PER = "22222222-2222-4222-8222-222222222222";
const ARCH = "33333333-3333-4333-8333-333333333333";
const CON_LETRAS = "abcdef12-3456-4789-8abc-def123456789";

describe("receipt paths", () => {
  it("builds <empleado>/<periodo>/<uuid>.pdf and parses it back", () => {
    const path = buildReciboPath({ empleadoId: EMP, periodoId: PER, fileId: ARCH });
    expect(path).toBe(`${EMP}/${PER}/${ARCH}.pdf`);
    expect(parseReciboPath(path!)).toEqual({ empleadoId: EMP, periodoId: PER, fileId: ARCH });
  });

  it("lowercases ids on build", () => {
    expect(buildReciboPath({ empleadoId: CON_LETRAS.toUpperCase(), periodoId: PER, fileId: ARCH })).toBe(`${CON_LETRAS}/${PER}/${ARCH}.pdf`);
  });

  it("refuses non-uuid ids on build", () => {
    expect(buildReciboPath({ empleadoId: "..", periodoId: PER, fileId: ARCH })).toBeNull();
    expect(buildReciboPath({ empleadoId: EMP, periodoId: "2026-11", fileId: ARCH })).toBeNull();
    expect(buildReciboPath({ empleadoId: EMP, periodoId: PER, fileId: "recibo" })).toBeNull();
  });

  it.each([
    ["traversal", `${EMP}/../${ARCH}.pdf`],
    ["traversal inside", `${EMP}/${PER}/../${ARCH}.pdf`],
    ["absolute", `/${EMP}/${PER}/${ARCH}.pdf`],
    ["non-uuid owner", `empleado/${PER}/${ARCH}.pdf`],
    ["non-uuid file", `${EMP}/${PER}/recibo.pdf`],
    ["uppercase", `${CON_LETRAS.toUpperCase()}/${PER}/${ARCH}.pdf`],
    ["wrong extension", `${EMP}/${PER}/${ARCH}.png`],
    ["no extension", `${EMP}/${PER}/${ARCH}`],
    ["missing period", `${EMP}/${ARCH}.pdf`],
    ["extra folder", `${EMP}/${PER}/x/${ARCH}.pdf`],
    ["trailing slash", `${EMP}/${PER}/${ARCH}.pdf/`],
    ["empty", ""],
  ])("refuses a %s path", (_caso, path) => {
    expect(parseReciboPath(path)).toBeNull();
  });
});

describe("signature paths", () => {
  it("builds <empleado>/<version>-<uuid>.png and parses it back", () => {
    const path = buildFirmaPath({ empleadoId: EMP, version: 3, fileId: ARCH });
    expect(path).toBe(`${EMP}/3-${ARCH}.png`);
    expect(parseFirmaPath(path!)).toEqual({ empleadoId: EMP, version: 3, fileId: ARCH });
  });

  it.each([0, -1, 1.5, Number.NaN, 1_000_000_000])("refuses version %s on build", (version) => {
    expect(buildFirmaPath({ empleadoId: EMP, version, fileId: ARCH })).toBeNull();
  });

  it("refuses non-uuid ids on build", () => {
    expect(buildFirmaPath({ empleadoId: "../x", version: 1, fileId: ARCH })).toBeNull();
    expect(buildFirmaPath({ empleadoId: EMP, version: 1, fileId: "firma" })).toBeNull();
  });

  it.each([
    ["traversal", `../${EMP}/1-${ARCH}.png`],
    ["absolute", `/${EMP}/1-${ARCH}.png`],
    ["non-uuid owner", `empleado/1-${ARCH}.png`],
    ["version zero", `${EMP}/0-${ARCH}.png`],
    ["leading zero", `${EMP}/01-${ARCH}.png`],
    ["no version", `${EMP}/${ARCH}.png`],
    ["wrong extension", `${EMP}/1-${ARCH}.pdf`],
    ["wrong owner order", `1-${ARCH}/${EMP}.png`],
    ["extra folder", `${EMP}/firmas/1-${ARCH}.png`],
    ["a receipt path", `${EMP}/${PER}/${ARCH}.pdf`],
  ])("refuses a %s path", (_caso, path) => {
    expect(parseFirmaPath(path)).toBeNull();
  });

  it("a receipt parser refuses a signature path", () => {
    expect(parseReciboPath(`${EMP}/1-${ARCH}.png`)).toBeNull();
  });
});
