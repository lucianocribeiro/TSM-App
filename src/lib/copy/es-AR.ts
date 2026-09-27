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
      cuentaInactiva: string;
      cuentaNoVerificada: string;
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
    cambiarPassword: string;
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
    nuevoUsuario: string;
    loading: string;
    filtro: {
      label: string;
      activas: string;
      todas: string;
    };
    busqueda: {
      label: string;
      placeholder: string;
    };
    columnas: {
      cuenta: string;
      nombre: string;
      email: string;
      rol: string;
      estado: string;
      acciones: string;
    };
    passwordPendiente: string;
    sinNombre: string;
    tuCuenta: string;
    vacio: string;
    sinResultados: string;
    listaFallo: string;
    acciones: {
      restablecer: string;
      desactivar: string;
      reactivar: string;
      purgar: string;
      cancelar: string;
      cerrar: string;
      verHistorial: string;
    };
    crear: {
      title: string;
      intro: string;
      emailLabel: string;
      rolLabel: string;
      passwordLabel: string;
      passwordHint: string;
      generar: string;
      submit: string;
      submitting: string;
    };
    passwordUnaVez: {
      title: string;
      creada: string;
      restablecida: string;
      note: string;
      copiar: string;
      copiada: string;
      listo: string;
    };
    restablecer: {
      title: string;
      body: string;
      confirm: string;
    };
    desactivar: {
      title: string;
      body: string;
      motivoLabel: string;
      confirm: string;
    };
    reactivar: {
      title: string;
      body: string;
      confirm: string;
    };
    purgar: {
      title: string;
      body: string;
      emailLabel: string;
      confirm: string;
    };
    exito: {
      creada: string;
      restablecida: string;
      desactivada: string;
      reactivada: string;
      purgada: string;
    };
    detalle: {
      kicker: string;
      volver: string;
      datos: string;
      historial: string;
      sinEventos: string;
      historialFallo: string;
      columnas: {
        evento: string;
        fecha: string;
        quien: string;
        motivo: string;
      };
    };
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
  password: {
    kicker: string;
    title: string;
    intro: string;
    introVoluntaria: string;
    actualLabel: string;
    nuevaLabel: string;
    confirmacionLabel: string;
    hint: string;
    submit: string;
    submitting: string;
    errors: {
      actualRequerida: string;
      actualIncorrecta: string;
      demasiadoCorta: string;
      demasiadoLarga: string;
      noCoinciden: string;
      igualActual: string;
      guardarFallo: string;
    };
  };
  cuentas: {
    estados: {
      activa: string;
      inactiva: string;
    };
    eventos: {
      creacion: string;
      desactivacion: string;
      reactivacion: string;
      password_temporal: string;
      password_cambiada: string;
    };
    errors: {
      noAutorizado: string;
      emailInvalido: string;
      emailExistente: string;
      rolInvalido: string;
      cuentaNoEncontrada: string;
      cuentaPropia: string;
      ultimoAdmin: string;
      yaInactiva: string;
      yaActiva: string;
      motivoRequerido: string;
      emailConfirmacionNoCoincide: string;
      historialEnOtrasCuentas: string;
      accionFallo: string;
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
      cuentaInactiva: "Tu cuenta está inactiva. Contactá a Recursos Humanos.",
      cuentaNoVerificada:
        "No pudimos verificar tu cuenta. Ingresá de nuevo y, si el problema sigue, contactá a Recursos Humanos.",
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
    cambiarPassword: "Cambiar contraseña",
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
    nuevoUsuario: "Nuevo usuario",
    loading: "Cargando cuentas…",
    filtro: {
      label: "Estado de la cuenta",
      activas: "Activas",
      todas: "Todas",
    },
    busqueda: {
      label: "Buscar",
      placeholder: "Email o nombre",
    },
    columnas: {
      cuenta: "Cuenta",
      nombre: "Nombre",
      email: "Email",
      rol: "Rol",
      estado: "Estado de la cuenta",
      acciones: "Acciones",
    },
    passwordPendiente: "Cambio de contraseña pendiente",
    sinNombre: "Sin nombre en el legajo",
    tuCuenta: "Tu cuenta",
    vacio: "Todavía no hay cuentas.",
    sinResultados: "No hay cuentas que coincidan con la búsqueda.",
    listaFallo: "No pudimos cargar las cuentas. Actualizá la página para intentar de nuevo.",
    acciones: {
      restablecer: "Restablecer contraseña",
      desactivar: "Desactivar",
      reactivar: "Reactivar",
      purgar: "Purgar",
      cancelar: "Cancelar",
      cerrar: "Cerrar",
      verHistorial: "Ver historial",
    },
    crear: {
      title: "Nuevo usuario",
      intro:
        "La cuenta se crea con una contraseña temporal. La persona tiene que cambiarla la primera vez que ingresa.",
      emailLabel: "Email",
      rolLabel: "Rol",
      passwordLabel: "Contraseña temporal",
      passwordHint: "Al menos 8 caracteres. Podés escribirla o generar una.",
      generar: "Generar",
      submit: "Crear usuario",
      submitting: "Creando…",
    },
    passwordUnaVez: {
      title: "Contraseña temporal",
      creada: "Creamos la cuenta de {email}.",
      restablecida: "Restablecimos la contraseña de {email}.",
      note:
        "Pasale esta contraseña a la persona. No la vamos a volver a mostrar: copiala antes de cerrar.",
      copiar: "Copiar",
      copiada: "Copiada",
      listo: "Listo, ya la copié",
    },
    restablecer: {
      title: "Restablecer contraseña",
      body:
        "Vamos a asignarle a {email} una contraseña temporal. Sus sesiones abiertas se cierran y tiene que cambiarla la próxima vez que ingrese.",
      confirm: "Restablecer",
    },
    desactivar: {
      title: "Desactivar cuenta",
      body:
        "{email} no va a poder ingresar a Mi TSM y sus sesiones abiertas se cierran. Sus datos y su historial se conservan, y podés reactivarla cuando quieras.",
      motivoLabel: "Motivo",
      confirm: "Desactivar",
    },
    reactivar: {
      title: "Reactivar cuenta",
      body: "{email} va a poder volver a ingresar a Mi TSM.",
      confirm: "Reactivar",
    },
    purgar: {
      title: "Purgar cuenta",
      body:
        "Esto borra para siempre la cuenta de {email}: su legajo, sus documentos, sus solicitudes y su historial. No se puede deshacer. Usalo solo con cuentas de prueba; para una baja real, desactivá la cuenta.",
      emailLabel: "Escribí el email de la cuenta para confirmar",
      confirm: "Purgar para siempre",
    },
    exito: {
      creada: "Creamos la cuenta.",
      restablecida: "Restablecimos la contraseña.",
      desactivada: "Desactivamos la cuenta.",
      reactivada: "Reactivamos la cuenta.",
      purgada: "Purgamos la cuenta.",
    },
    detalle: {
      kicker: "Usuarios",
      volver: "Volver a Usuarios",
      datos: "Datos de la cuenta",
      historial: "Historial de la cuenta",
      sinEventos: "Todavía no hay eventos para esta cuenta.",
      historialFallo: "No pudimos cargar el historial. Actualizá la página para intentar de nuevo.",
      columnas: {
        evento: "Evento",
        fecha: "Fecha",
        quien: "Quién",
        motivo: "Motivo",
      },
    },
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
  password: {
    kicker: "Tu cuenta",
    title: "Cambiá tu contraseña",
    intro:
      "Estás usando una contraseña temporal. Elegí una nueva para seguir usando Mi TSM.",
    introVoluntaria: "Elegí una nueva contraseña para tu cuenta.",
    actualLabel: "Contraseña actual",
    nuevaLabel: "Nueva contraseña",
    confirmacionLabel: "Repetí la nueva contraseña",
    hint: "Usá al menos 8 caracteres.",
    submit: "Guardar contraseña",
    submitting: "Guardando…",
    errors: {
      actualRequerida: "Ingresá tu contraseña actual.",
      actualIncorrecta: "La contraseña actual no es correcta. Revisala y volvé a intentar.",
      demasiadoCorta: "La contraseña tiene que tener al menos 8 caracteres.",
      demasiadoLarga: "La contraseña puede tener hasta 72 caracteres.",
      noCoinciden: "Las contraseñas no coinciden. Revisalas y volvé a intentar.",
      igualActual: "La nueva contraseña tiene que ser distinta de la actual.",
      guardarFallo: "No pudimos cambiar la contraseña. Intentá de nuevo.",
    },
  },
  cuentas: {
    estados: {
      activa: "Activa",
      inactiva: "Inactiva",
    },
    eventos: {
      creacion: "Cuenta creada",
      desactivacion: "Cuenta desactivada",
      reactivacion: "Cuenta reactivada",
      password_temporal: "Contraseña temporal asignada",
      password_cambiada: "Contraseña cambiada",
    },
    errors: {
      noAutorizado: "No tenés permiso para realizar esta acción.",
      emailInvalido: "Ingresá un email válido.",
      emailExistente: "Ya existe una cuenta con ese email.",
      rolInvalido: "Elegí un rol válido.",
      cuentaNoEncontrada: "No encontramos la cuenta. Actualizá la página y volvé a intentar.",
      cuentaPropia: "No podés realizar esta acción sobre tu propia cuenta.",
      ultimoAdmin: "No podés desactivar ni purgar al último administrador activo.",
      yaInactiva: "La cuenta ya está inactiva.",
      yaActiva: "La cuenta ya está activa.",
      motivoRequerido: "Indicá el motivo de la desactivación.",
      emailConfirmacionNoCoincide:
        "El email no coincide con el de la cuenta. Revisalo y volvé a intentar.",
      historialEnOtrasCuentas:
        "Esta cuenta figura en el historial de otras cuentas y no se puede purgar. Desactivala en su lugar.",
      accionFallo: "No pudimos completar la acción. Intentá de nuevo.",
    },
  },
} as const satisfies Copy;
