export type Copy = {
  app: {
    name: string;
    logoAlt: string;
  };
  common: {
    comingSoon: string;
    openMenu: string;
    closeMenu: string;
  };
  auth: {
    login: {
      title: string;
      emailLabel: string;
      passwordLabel: string;
      submit: string;
      submitting: string;
    };
    errors: {
      invalidCredentials: string;
      logoutFailed: string;
    };
    logout: string;
    roles: {
      empleado: string;
      admin: string;
    };
  };
  nav: {
    label: string;
    miLegajo: string;
    legajos: string;
    usuarios: string;
  };
  theme: {
    toDark: string;
    toLight: string;
  };
  miLegajo: {
    kicker: string;
    title: string;
  };
  legajos: {
    kicker: string;
    title: string;
  };
  usuarios: {
    kicker: string;
    title: string;
  };
  legajo: {
    validation: {
      required: string;
      dniDigits: string;
      emailInvalid: string;
      dateInvalid: string;
      optionInvalid: string;
      partidoOtroRequired: string;
      partidoOtroNotAllowed: string;
      hijosRequired: string;
      hijosNotAllowed: string;
      numberInvalid: string;
      brutoMensualNegative: string;
    };
  };
  documentos: {
    tipos: {
      dni_frente: string;
      dni_dorso: string;
      licencia_conducir: string;
    };
    validation: {
      fileRequired: string;
      fileNameTooLong: string;
      fileEmpty: string;
      fileTooLarge: string;
      fileTypeNotAllowed: string;
      fileTypeMismatch: string;
      tipoInvalid: string;
    };
    errors: {
      downloadFailed: string;
    };
  };
  aprobaciones: {
    campos: {
      nombres: string;
      apellido: string;
      dni: string;
      nacionalidad: string;
      cuil: string;
      fecha_nacimiento: string;
      calle_altura: string;
      piso_depto: string;
      localidad: string;
      partido: string;
      partido_otro: string;
      telefono_celular: string;
      email_personal: string;
      estado_civil: string;
      nombre_conyuge: string;
      tiene_hijos: string;
      hijos: string;
      grupo_sanguineo: string;
      alergias: string;
      medicacion_habitual: string;
      obra_social: string;
      numero_afiliado: string;
      emergencia_nombre: string;
      emergencia_parentesco: string;
      emergencia_domicilio: string;
      emergencia_telefono: string;
    };
    solicitudEstados: {
      pendiente: string;
      aprobada: string;
      rechazada: string;
      cancelada: string;
    };
    documentoEstados: {
      pendiente: string;
      aprobado: string;
      rechazado: string;
      reemplazado: string;
    };
    pendienteHint: string;
    motivoRechazoLabel: string;
    errors: {
      solicitudPendiente: string;
      documentoPendiente: string;
      sinCambios: string;
      motivoRequerido: string;
      noPendiente: string;
      guardarFallo: string;
    };
  };
};

export const copy = {
  app: {
    name: "Mi TSM",
    logoAlt: "Tecno San Martín",
  },
  common: {
    comingSoon: "Esta sección va a estar disponible próximamente.",
    openMenu: "Abrir menú",
    closeMenu: "Cerrar menú",
  },
  auth: {
    login: {
      title: "Ingresá a Mi TSM",
      emailLabel: "Email",
      passwordLabel: "Contraseña",
      submit: "Ingresar",
      submitting: "Ingresando…",
    },
    errors: {
      invalidCredentials: "Email o contraseña incorrectos.",
      logoutFailed: "No pudimos cerrar la sesión. Intentá de nuevo.",
    },
    logout: "Cerrar sesión",
    roles: {
      empleado: "Empleado",
      admin: "Administrador",
    },
  },
  nav: {
    label: "Navegación principal",
    miLegajo: "Mi Legajo",
    legajos: "Legajos",
    usuarios: "Usuarios",
  },
  theme: {
    toDark: "Modo oscuro",
    toLight: "Modo claro",
  },
  miLegajo: {
    kicker: "Tu información",
    title: "Mi Legajo",
  },
  legajos: {
    kicker: "Administración",
    title: "Legajos",
  },
  usuarios: {
    kicker: "Administración",
    title: "Usuarios",
  },
  legajo: {
    validation: {
      required: "Completá este dato.",
      dniDigits: "Ingresá el DNI solo con números, sin puntos ni espacios.",
      emailInvalid: "Ingresá un correo electrónico válido.",
      dateInvalid: "Ingresá una fecha válida.",
      optionInvalid: "Elegí una de las opciones.",
      partidoOtroRequired: "Indicá el partido.",
      partidoOtroNotAllowed: "Completá este dato solo si elegiste «Otro».",
      hijosRequired: "Agregá al menos un hijo o elegí «No».",
      hijosNotAllowed: "Si elegiste «No», no agregues hijos.",
      numberInvalid: "Ingresá un número válido.",
      brutoMensualNegative: "El bruto mensual no puede ser negativo.",
    },
  },
  documentos: {
    tipos: {
      dni_frente: "DNI (frente)",
      dni_dorso: "DNI (dorso)",
      licencia_conducir: "Licencia de conducir",
    },
    validation: {
      fileRequired: "Elegí un archivo para subir.",
      fileNameTooLong: "El nombre del archivo es demasiado largo. Renombralo y volvé a intentar.",
      fileEmpty: "El archivo está vacío. Elegí otro.",
      fileTooLarge: "El archivo supera los 10 MB. Elegí uno más liviano.",
      fileTypeNotAllowed: "Subí un archivo PDF, JPG o PNG.",
      fileTypeMismatch:
        "La extensión del archivo no coincide con su formato. Revisalo y volvé a intentar.",
      tipoInvalid: "Elegí un tipo de documento válido.",
    },
    errors: {
      downloadFailed: "No pudimos abrir el documento. Intentá de nuevo.",
    },
  },
  aprobaciones: {
    campos: {
      nombres: "Nombres",
      apellido: "Apellido",
      dni: "DNI",
      nacionalidad: "Nacionalidad",
      cuil: "CUIL",
      fecha_nacimiento: "Fecha de nacimiento",
      calle_altura: "Calle y altura",
      piso_depto: "Piso y departamento",
      localidad: "Localidad",
      partido: "Partido",
      partido_otro: "Partido (otro)",
      telefono_celular: "Teléfono celular personal",
      email_personal: "Correo electrónico personal",
      estado_civil: "Estado civil",
      nombre_conyuge: "Nombre completo cónyuge / concubino",
      tiene_hijos: "Tiene hijos",
      hijos: "Hijos",
      grupo_sanguineo: "Grupo sanguíneo",
      alergias: "Alergias",
      medicacion_habitual: "Medicación habitual",
      obra_social: "Obra social / prepaga",
      numero_afiliado: "Número de afiliado",
      emergencia_nombre: "Nombre completo de contacto de emergencia",
      emergencia_parentesco: "Relación de parentesco contacto de emergencia",
      emergencia_domicilio: "Domicilio completo contacto de emergencia",
      emergencia_telefono: "Teléfono de contacto de emergencia",
    },
    solicitudEstados: {
      pendiente: "Pendiente de aprobación",
      aprobada: "Aprobada",
      rechazada: "Rechazada",
      cancelada: "Cancelada",
    },
    documentoEstados: {
      pendiente: "Pendiente de aprobación",
      aprobado: "Aprobado",
      rechazado: "Rechazado",
      reemplazado: "Reemplazado",
    },
    pendienteHint: "Enviaste un cambio. Se va a aplicar cuando lo apruebe un administrador.",
    motivoRechazoLabel: "Motivo del rechazo",
    errors: {
      solicitudPendiente:
        "Ya tenés una solicitud pendiente. Esperá a que la revisen o cancelala antes de enviar otra.",
      documentoPendiente:
        "Ya hay un documento de este tipo pendiente de aprobación. Esperá a que lo revisen o eliminalo antes de subir otro.",
      sinCambios: "No hay cambios para enviar.",
      motivoRequerido: "Indicá el motivo del rechazo.",
      noPendiente: "Esta solicitud ya fue revisada o cancelada.",
      guardarFallo: "No pudimos guardar los cambios. Intentá de nuevo.",
    },
  },
} as const satisfies Copy;
