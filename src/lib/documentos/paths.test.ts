import { describe, expect, it } from "vitest";
import { buildDocumentoPath, parseDocumentoPath } from "./paths";

const PROFILE = "00000000-0000-4000-a000-000000000002";
const FILE = "3f2c1b7e-9a4d-4c8e-8f10-1234567890ab";

describe("buildDocumentoPath", () => {
  it("builds <profile_id>/<tipo>/<uuid>.<ext> with the extension from the MIME type", () => {
    expect(
      buildDocumentoPath({ profileId: PROFILE, tipo: "dni_frente", fileId: FILE, mimeType: "application/pdf" }),
    ).toBe(`${PROFILE}/dni_frente/${FILE}.pdf`);
    expect(
      buildDocumentoPath({ profileId: PROFILE, tipo: "dni_dorso", fileId: FILE, mimeType: "image/jpeg" }),
    ).toBe(`${PROFILE}/dni_dorso/${FILE}.jpg`);
    expect(
      buildDocumentoPath({ profileId: PROFILE, tipo: "licencia_conducir", fileId: FILE, mimeType: "image/png" }),
    ).toBe(`${PROFILE}/licencia_conducir/${FILE}.png`);
  });

  it("lowercases UUIDs", () => {
    expect(
      buildDocumentoPath({
        profileId: PROFILE.toUpperCase(),
        tipo: "dni_frente",
        fileId: FILE.toUpperCase(),
        mimeType: "image/png",
      }),
    ).toBe(`${PROFILE}/dni_frente/${FILE}.png`);
  });

  it("rejects an invalid type", () => {
    for (const tipo of ["pasaporte", "", "DNI_FRENTE", "../dni_frente", "dni_frente/x"]) {
      expect(buildDocumentoPath({ profileId: PROFILE, tipo, fileId: FILE, mimeType: "image/png" }), tipo).toBeNull();
    }
  });

  it("rejects a MIME type that is not allowed", () => {
    for (const mimeType of ["text/html", "image/gif", "application/octet-stream", ""]) {
      expect(buildDocumentoPath({ profileId: PROFILE, tipo: "dni_frente", fileId: FILE, mimeType }), mimeType).toBeNull();
    }
  });

  it("rejects ids that are not UUIDs, including traversal", () => {
    const bad = ["", "..", "../" + PROFILE, PROFILE + "/x", "/" + PROFILE, "not-a-uuid"];
    for (const value of bad) {
      expect(buildDocumentoPath({ profileId: value, tipo: "dni_frente", fileId: FILE, mimeType: "image/png" }), value).toBeNull();
      expect(buildDocumentoPath({ profileId: PROFILE, tipo: "dni_frente", fileId: value, mimeType: "image/png" }), value).toBeNull();
    }
  });
});

describe("parseDocumentoPath", () => {
  it("parses a valid path", () => {
    expect(parseDocumentoPath(`${PROFILE}/dni_dorso/${FILE}.jpg`)).toEqual({
      profileId: PROFILE,
      tipo: "dni_dorso",
      fileId: FILE,
      extension: "jpg",
      mimeType: "image/jpeg",
    });
  });

  it("round-trips with buildDocumentoPath", () => {
    const path = buildDocumentoPath({ profileId: PROFILE, tipo: "licencia_conducir", fileId: FILE, mimeType: "application/pdf" });
    expect(path).not.toBeNull();
    expect(parseDocumentoPath(path ?? "")?.tipo).toBe("licencia_conducir");
  });

  it("rejects an invalid type segment", () => {
    expect(parseDocumentoPath(`${PROFILE}/pasaporte/${FILE}.pdf`)).toBeNull();
    expect(parseDocumentoPath(`${PROFILE}/DNI_FRENTE/${FILE}.pdf`)).toBeNull();
  });

  it("rejects invalid extensions", () => {
    for (const ext of ["html", "jpeg", "PDF", "gif", "pdf.exe", ""]) {
      expect(parseDocumentoPath(`${PROFILE}/dni_frente/${FILE}.${ext}`), ext).toBeNull();
    }
    expect(parseDocumentoPath(`${PROFILE}/dni_frente/${FILE}`)).toBeNull();
  });

  it("rejects traversal, leading slashes and extra or missing segments", () => {
    const bad = [
      `/${PROFILE}/dni_frente/${FILE}.pdf`,
      `../${PROFILE}/dni_frente/${FILE}.pdf`,
      `${PROFILE}/../dni_frente/${FILE}.pdf`,
      `${PROFILE}/dni_frente/../${FILE}.pdf`,
      `${PROFILE}/dni_frente/${FILE}.pdf/`,
      `${PROFILE}//dni_frente/${FILE}.pdf`,
      `${PROFILE}/dni_frente/x/${FILE}.pdf`,
      `${PROFILE}/${FILE}.pdf`,
      `${PROFILE}\\dni_frente\\${FILE}.pdf`,
      "",
    ];
    for (const path of bad) {
      expect(parseDocumentoPath(path), path).toBeNull();
    }
  });

  it("rejects uppercase or malformed UUIDs", () => {
    expect(parseDocumentoPath(`${PROFILE.toUpperCase()}/dni_frente/${FILE}.pdf`)).toBeNull();
    expect(parseDocumentoPath(`${PROFILE}/dni_frente/${FILE.slice(1)}.pdf`)).toBeNull();
  });

  it("rejects an extension that does not match the expected MIME type", () => {
    const path = `${PROFILE}/dni_frente/${FILE}.png`;
    expect(parseDocumentoPath(path, { mimeType: "image/png" })?.mimeType).toBe("image/png");
    expect(parseDocumentoPath(path, { mimeType: "application/pdf" })).toBeNull();
    expect(parseDocumentoPath(path, { mimeType: "image/jpeg" })).toBeNull();
    expect(parseDocumentoPath(path, { mimeType: "text/html" })).toBeNull();
  });
});
