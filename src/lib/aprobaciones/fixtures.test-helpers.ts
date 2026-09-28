import type { LegajoActual } from "./solicitudes";

// A complete, valid current legajo for the inbox unit tests (fictitious data).
export function legajoActual(overrides: Partial<LegajoActual> = {}): LegajoActual {
  return {
    nombres: "Prueba",
    apellido: "Ficticio",
    dni: "12345678",
    nacionalidad: "Argentina",
    cuil: "20-12345678-6",
    fecha_nacimiento: "1990-07-01",
    calle_altura: "Avenida Inventada 456",
    piso_depto: null,
    localidad: "Barrio de Prueba",
    partido: "Tigre",
    partido_otro: null,
    telefono_celular: "1100000002",
    email_personal: "prueba@example.test",
    estado_civil: "casado",
    nombre_conyuge: "Cónyuge Ficticio",
    tiene_hijos: true,
    grupo_sanguineo: "A+",
    alergias: "Ninguna",
    medicacion_habitual: "Ninguna",
    obra_social: "Prepaga de Prueba",
    numero_afiliado: "TEST-0002",
    emergencia_nombre: "Contacto Ficticio",
    emergencia_parentesco: "Madre",
    emergencia_domicilio: "Calle Falsa 123",
    emergencia_telefono: "1100000003",
    hijos: [
      { nombre_completo: "Hija Ficticia", fecha_nacimiento: "2015-03-02" },
      { nombre_completo: "Hijo Ficticio", fecha_nacimiento: "2018-11-20" },
    ],
    ...overrides,
  };
}
