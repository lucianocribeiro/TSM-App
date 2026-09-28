import { describe, expect, it } from "vitest";
import { calcularKpis } from "./kpis";
import { filtrarLegajos, FILTROS_INICIALES, type LegajoListItem } from "./listado";

type Fila = Pick<LegajoListItem, "estadoCuenta" | "fechaIngreso">;
const fila = (fechaIngreso: string | null, estadoCuenta: Fila["estadoCuenta"] = "activa"): Fila => ({ estadoCuenta, fechaIngreso });

// Noon in Argentina (UTC-3) on 2026-09-15: well inside September everywhere.
const SEPTIEMBRE = new Date("2026-09-15T15:00:00Z");

describe("calcularKpis", () => {
  it("counts accounts that are not deactivated as Activos", () => {
    const kpis = calcularKpis([fila("2020-01-01"), fila("2021-01-01"), fila("2022-01-01", "inactiva")], SEPTIEMBRE);
    expect(kpis.activos).toBe(2);
  });

  it("counts every estado laboral, En prueba included (the account decides)", () => {
    // estado laboral is not an input: an active account in prueba is active.
    const items: Fila[] = [fila("2026-09-10"), fila(null)];
    expect(calcularKpis(items, SEPTIEMBRE)).toEqual({ activos: 2, ingresosDelMes: 1 });
  });

  it("counts ingresos on the first and last day of the current month, not the months around it", () => {
    const items = [fila("2026-09-01"), fila("2026-09-30"), fila("2026-08-31"), fila("2026-10-01"), fila("2025-09-15")];
    expect(calcularKpis(items, SEPTIEMBRE)).toEqual({ activos: 5, ingresosDelMes: 2 });
  });

  it("leaves deactivated accounts out of Ingresos del mes", () => {
    expect(calcularKpis([fila("2026-09-05", "inactiva"), fila("2026-09-06")], SEPTIEMBRE)).toEqual({ activos: 1, ingresosDelMes: 1 });
  });

  it("uses Argentina's month near midnight UTC", () => {
    const items = [fila("2026-09-20"), fila("2026-10-01")];
    // 2026-10-01T02:30Z is still September 30th, 23:30, in Buenos Aires.
    expect(calcularKpis(items, new Date("2026-10-01T02:30:00Z"))).toEqual({ activos: 2, ingresosDelMes: 1 });
    expect(calcularKpis([fila("2026-10-01")], new Date("2026-10-01T02:30:00Z")).ingresosDelMes).toBe(0);
    // 03:30Z is already October 1st, 00:30, there.
    expect(calcularKpis([fila("2026-10-01")], new Date("2026-10-01T03:30:00Z")).ingresosDelMes).toBe(1);
    expect(calcularKpis([fila("2026-09-20")], new Date("2026-10-01T03:30:00Z")).ingresosDelMes).toBe(0);
  });

  it("is computed over the whole list, whatever the filters show", () => {
    const base = { nombres: null, apellido: null, dni: null, cuil: null, numeroLegajo: null, puesto: null, sede: null, modalidad: null, estadoLaboral: null };
    const items: LegajoListItem[] = [
      { ...base, profileId: "a", nombre: "Ana", area: "Ventas", fechaIngreso: "2026-09-02", estadoCuenta: "activa" },
      { ...base, profileId: "b", nombre: "Beto", area: "Taller", fechaIngreso: "2026-01-02", estadoCuenta: "activa" },
      { ...base, profileId: "c", nombre: "Carla", area: "Ventas", fechaIngreso: "2026-09-03", estadoCuenta: "inactiva" },
    ];
    const todas = calcularKpis(items, SEPTIEMBRE);
    expect(todas).toEqual({ activos: 2, ingresosDelMes: 1 });
    // What a filtered view would show is a different set; the cards do not use it.
    expect(filtrarLegajos(items, { ...FILTROS_INICIALES, area: "Taller" })).toHaveLength(1);
    expect(filtrarLegajos(items, { ...FILTROS_INICIALES, busqueda: "carla", mostrarBajas: true })).toHaveLength(1);
  });
});
