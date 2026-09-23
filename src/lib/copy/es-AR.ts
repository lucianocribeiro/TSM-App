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
} as const satisfies Copy;
