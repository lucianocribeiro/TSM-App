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
} as const satisfies Copy;
