import { describe, expect, it } from "vitest";
import { claveMarca, firmarMarca, leerMarca, opcionesMarca, sesionIdDeToken } from "./marca";
import { INACTIVIDAD_MS, MARCA_RENOVAR_MS } from "./tiempos";

const SESION = "11111111-2222-4333-8444-555555555555";
const OTRA = "99999999-2222-4333-8444-555555555555";
const AHORA = 1_800_000_000_000;

describe("activity marker", async () => {
  const clave = await claveMarca("secreto-de-prueba");

  it("is valid for its session within the limit, and asks to be renewed when older than the threshold", async () => {
    const marca = await firmarMarca(clave, SESION, AHORA);
    expect(await leerMarca(clave, marca, SESION, AHORA + 1000)).toEqual({ estado: "vigente", instante: AHORA, renovar: false });
    expect(await leerMarca(clave, marca, SESION, AHORA + MARCA_RENOVAR_MS)).toMatchObject({ estado: "vigente", renovar: true });
    expect(await leerMarca(clave, marca, SESION, AHORA + INACTIVIDAD_MS)).toMatchObject({ estado: "vigente" });
    expect(await leerMarca(clave, marca, SESION, AHORA + INACTIVIDAD_MS + 1)).toEqual({ estado: "vencida" });
  });

  it("refuses anything the server did not sign for this session", async () => {
    const marca = await firmarMarca(clave, SESION, AHORA);
    const [v, id, , firma] = marca.split(".");
    const otraClave = await claveMarca("otro-secreto");
    const casos = [
      undefined,
      "",
      "basura",
      `${v}.${id}.${AHORA + 60_000}.${firma}`,
      `${v}.${OTRA}.${AHORA}.${firma}`,
      `v2.${id}.${AHORA}.${firma}`,
      `${marca}.extra`,
      `${v}.${id}.${AHORA}.${firma.slice(0, -2)}`,
      `${v}.${id}.-5.${firma}`,
      `${v}.${id}.${AHORA}.no+base64/`,
      await firmarMarca(otraClave, SESION, AHORA),
      "x".repeat(300),
    ];
    for (const valor of casos) {
      expect((await leerMarca(clave, valor, SESION, AHORA)).estado, String(valor)).toBe("invalida");
    }
    // Valid for its own session, not for another.
    expect((await leerMarca(clave, await firmarMarca(clave, OTRA, AHORA), SESION, AHORA)).estado).toBe("invalida");
  });

  it("a marker signed with one secret is refused under another", async () => {
    const otra = await claveMarca("otro-secreto-de-prueba-0123456789abcdefghijk");
    const marca = await firmarMarca(otra, SESION, AHORA);
    expect((await leerMarca(clave, marca, SESION, AHORA)).estado).toBe("invalida");
    expect((await leerMarca(otra, marca, SESION, AHORA)).estado).toBe("vigente");
  });

  it("without a key (no usable secret) every marker is refused", async () => {
    const marca = await firmarMarca(clave, SESION, AHORA);
    expect(await leerMarca(null, marca, SESION, AHORA)).toEqual({ estado: "invalida" });
  });

  it("refuses a marker stamped in the future", async () => {
    const marca = await firmarMarca(clave, SESION, AHORA + 5 * 60_000);
    expect((await leerMarca(clave, marca, SESION, AHORA)).estado).toBe("invalida");
  });

  it("is an httpOnly, SameSite=Lax cookie, Secure over HTTPS", () => {
    expect(opcionesMarca(true)).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    expect(opcionesMarca(false).secure).toBe(false);
  });

  it("reads the session id of a token", () => {
    const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    expect(sesionIdDeToken(`${b64({})}.${b64({ session_id: SESION })}.x`)).toBe(SESION);
    expect(sesionIdDeToken(`${b64({})}.${b64({ session_id: "../evil" })}.x`)).toBeNull();
    expect(sesionIdDeToken("nada")).toBeNull();
  });
});
