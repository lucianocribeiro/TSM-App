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
    vacio: {
      title: string;
      body: string;
    };
    grupos: {
      A: string;
      B: string;
      C: string;
      D: string;
      E: string;
    };
    laboralesNota: string;
    camposLaborales: {
      numero_legajo: string;
      area: string;
      puesto: string;
      fecha_ingreso: string;
      antiguedad: string;
      estado_laboral: string;
      sede: string;
      modalidad: string;
      convenio: string;
      bruto_mensual: string;
    };
    estadosLaborales: {
      activo: string;
      en_prueba: string;
    };
    estadosCiviles: {
      soltero: string;
      casado: string;
      divorciado: string;
      viudo: string;
      union_convivencial: string;
    };
    siNo: {
      si: string;
      no: string;
    };
    antiguedad: {
      menosDeUnMes: string;
      anio: string;
      anios: string;
      mes: string;
      meses: string;
      separador: string;
    };
    sinDato: string;
    elegir: string;
    cuilPlaceholder: string;
    editar: string;
    guardar: string;
    guardando: string;
    cancelar: string;
    hijos: {
      agregar: string;
      quitar: string;
      nombre: string;
      fecha: string;
      ninguno: string;
      hijoN: string;
    };
    pendiente: {
      banner: string;
      valor: string;
      cancelar: string;
      confirmTitle: string;
      confirmBody: string;
      confirmar: string;
      volver: string;
    };
    rechazada: {
      banner: string;
    };
    admin: {
      nota: string;
    };
    exito: {
      enviada: string;
      guardado: string;
      cancelada: string;
    };
    errors: {
      revisarCampos: string;
      soloEmpleados: string;
      soloAdmin: string;
    };
    documentos: {
      title: string;
      intro: string;
      columnas: {
        documento: string;
        estado: string;
        fecha: string;
        acciones: string;
      };
      estados: {
        aprobado: string;
        pendiente: string;
        rechazado: string;
        faltante: string;
      };
      requerido: string;
      opcional: string;
      archivoLabel: string;
      subir: string;
      subirNuevo: string;
      subiendo: string;
      descargar: string;
      descargarPendiente: string;
      eliminar: string;
      eliminarTitle: string;
      eliminarBody: string;
      motivoRechazo: string;
      vigenteNota: string;
      exito: {
        subido: string;
        subidoAdmin: string;
        eliminado: string;
      };
      errors: {
        subirFallo: string;
        eliminarFallo: string;
        limpiezaFallo: string;
      };
    };
  };
  legajos: {
    kicker: string;
    title: string;
    loading: string;
    listaFallo: string;
    vacio: string;
    sinResultados: string;
    total: string;
    busqueda: {
      label: string;
      placeholder: string;
    };
    filtros: {
      label: string;
      estadoLaboral: string;
      area: string;
      sede: string;
      modalidad: string;
      todos: string;
      todas: string;
      mostrarBajas: string;
      limpiar: string;
    };
    columnas: {
      empleado: string;
      cuil: string;
      area: string;
      puesto: string;
      sede: string;
      modalidad: string;
      estadoLaboral: string;
    };
    sinNombre: string;
    sinDato: string;
    numeroLegajo: string;
    dadoDeBaja: string;
    detalle: {
      kicker: string;
      volver: string;
      verCuenta: string;
      nota: string;
      propio: string;
      cuentaInactiva: string;
      solicitudPendiente: string;
      cargaFallo: string;
    };
    laborales: {
      antiguedadNota: string;
    };
    documentos: {
      intro: string;
      eliminarVigenteBody: string;
    };
    errors: {
      solicitudPendiente: string;
      documentoPendiente: string;
      numeroLegajoDuplicado: string;
      noEncontrado: string;
    };
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
      cuilInvalid: string;
      cuilPrefijo: string;
      cuilDigito: string;
      telefonoInvalid: string;
      fechaFutura: string;
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
      valorInvalido: string;
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
    vacio: {
      title: "Completá tu legajo",
      body: "Todavía no cargaste tus datos. Usá “Editar” en cada sección para completarlos.",
    },
    grupos: {
      A: "Datos personales",
      B: "Domicilio y contacto",
      C: "Datos familiares",
      D: "Datos de emergencia",
      E: "Datos laborales",
    },
    laboralesNota: "Estos datos los administra Recursos Humanos.",
    camposLaborales: {
      numero_legajo: "Número de legajo",
      area: "Área",
      puesto: "Puesto",
      fecha_ingreso: "Fecha de ingreso",
      antiguedad: "Antigüedad",
      estado_laboral: "Estado laboral",
      sede: "Sede",
      modalidad: "Modalidad",
      convenio: "Convenio",
      bruto_mensual: "Bruto mensual",
    },
    estadosLaborales: {
      activo: "Activo",
      en_prueba: "En prueba",
    },
    estadosCiviles: {
      soltero: "Soltero",
      casado: "Casado",
      divorciado: "Divorciado",
      viudo: "Viudo",
      union_convivencial: "Unión Convivencial",
    },
    siNo: {
      si: "Sí",
      no: "No",
    },
    antiguedad: {
      menosDeUnMes: "Menos de un mes",
      anio: "{n} año",
      anios: "{n} años",
      mes: "{n} mes",
      meses: "{n} meses",
      separador: " y ",
    },
    sinDato: "Sin completar",
    elegir: "Elegí una opción",
    cuilPlaceholder: "XX-XXXXXXXX-X",
    editar: "Editar",
    guardar: "Guardar",
    guardando: "Guardando…",
    cancelar: "Cancelar",
    hijos: {
      agregar: "Agregar hijo",
      quitar: "Quitar",
      nombre: "Nombre completo",
      fecha: "Fecha de nacimiento",
      ninguno: "No hay hijos cargados.",
      hijoN: "Hijo {n}",
    },
    pendiente: {
      banner:
        "Enviaste cambios que están pendientes de aprobación. Vas a poder editar de nuevo cuando Recursos Humanos los revise.",
      valor: "Pendiente de aprobación: {valor}",
      cancelar: "Cancelar solicitud",
      confirmTitle: "Cancelar solicitud",
      confirmBody: "Vamos a retirar los cambios que enviaste. Tus datos actuales no cambian.",
      confirmar: "Cancelar solicitud",
      volver: "Volver",
    },
    rechazada: {
      banner: "Tu última solicitud fue rechazada. Motivo: «{motivo}». Podés corregir los datos y enviarlos de nuevo.",
    },
    admin: {
      nota: "Como administrador, tus cambios se guardan directamente, sin pasar por aprobación.",
    },
    exito: {
      enviada: "Enviamos tus cambios. Quedan pendientes hasta que Recursos Humanos los revise.",
      guardado: "Guardamos los cambios.",
      cancelada: "Cancelamos la solicitud.",
    },
    errors: {
      revisarCampos: "Revisá los datos marcados.",
      soloEmpleados: "Como administrador, guardá tus cambios directamente.",
      soloAdmin: "No tenés permiso para guardar cambios directamente.",
    },
    documentos: {
      title: "Documentos",
      intro: "Subí archivos PDF, JPG o PNG de hasta 10 MB.",
      columnas: {
        documento: "Documento",
        estado: "Estado",
        fecha: "Fecha de carga",
        acciones: "Acciones",
      },
      estados: {
        aprobado: "Aprobado",
        pendiente: "Pendiente de aprobación",
        rechazado: "Rechazado",
        faltante: "Sin cargar",
      },
      requerido: "Obligatorio",
      opcional: "Opcional",
      archivoLabel: "Archivo para {documento}",
      subir: "Subir",
      subirNuevo: "Subir otro",
      subiendo: "Subiendo…",
      descargar: "Descargar",
      descargarPendiente: "Descargar el enviado",
      eliminar: "Eliminar",
      eliminarTitle: "Eliminar documento",
      eliminarBody: "Vamos a eliminar el archivo que subiste y que todavía no fue revisado.",
      motivoRechazo: "Motivo del rechazo: {motivo}",
      vigenteNota: "El documento aprobado sigue vigente hasta que se apruebe el nuevo.",
      exito: {
        subido: "Subimos el documento. Queda pendiente de aprobación.",
        subidoAdmin: "Subimos el documento.",
        eliminado: "Eliminamos el documento.",
      },
      errors: {
        subirFallo: "No pudimos subir el archivo. Intentá de nuevo.",
        eliminarFallo: "No pudimos eliminar el documento. Intentá de nuevo.",
        limpiezaFallo:
          "No pudimos completar la subida. Volvé a intentar en unos minutos y, si sigue pasando, avisá a Recursos Humanos.",
      },
    },
  },
  legajos: {
    kicker: "Administración",
    title: "Legajos",
    loading: "Cargando legajos…",
    listaFallo: "No pudimos cargar los legajos. Intentá de nuevo.",
    vacio: "Todavía no hay empleados con legajo.",
    sinResultados: "No encontramos empleados con esa búsqueda o esos filtros.",
    total: "{n} de {total} empleados",
    busqueda: {
      label: "Buscar",
      placeholder: "Nombre, DNI, CUIL o número de legajo",
    },
    filtros: {
      label: "Filtros",
      estadoLaboral: "Estado laboral",
      area: "Área",
      sede: "Sede",
      modalidad: "Modalidad",
      todos: "Todos",
      todas: "Todas",
      mostrarBajas: "Mostrar dados de baja",
      limpiar: "Limpiar filtros",
    },
    columnas: {
      empleado: "Empleado",
      cuil: "CUIL",
      area: "Área",
      puesto: "Puesto",
      sede: "Sede",
      modalidad: "Modalidad",
      estadoLaboral: "Estado laboral",
    },
    sinNombre: "Sin nombre cargado",
    sinDato: "—",
    numeroLegajo: "Legajo {numero}",
    dadoDeBaja: "Dado de baja",
    detalle: {
      kicker: "Legajo",
      volver: "Volver a Legajos",
      verCuenta: "Ver cuenta en Usuarios",
      nota: "Los cambios que hagas acá se guardan directamente, sin pasar por aprobación.",
      propio: "Este es tu propio legajo. Desde acá también podés editar tus datos laborales.",
      cuentaInactiva: "La cuenta de este empleado está dada de baja. Su legajo se puede consultar y corregir.",
      solicitudPendiente:
        "Este empleado tiene una solicitud de cambios pendiente. Sus datos personales, de contacto, familiares y de emergencia no se pueden editar hasta que se resuelva. Los datos laborales y los documentos se pueden editar igual.",
      cargaFallo: "No pudimos cargar este legajo. Intentá de nuevo.",
    },
    laborales: {
      antiguedadNota: "La antigüedad se calcula a partir de la fecha de ingreso.",
    },
    documentos: {
      intro: "Subí archivos PDF, JPG o PNG de hasta 10 MB. Los documentos que subas quedan aprobados.",
      eliminarVigenteBody: "Vamos a eliminar el documento vigente. Esta acción no se puede deshacer.",
    },
    errors: {
      solicitudPendiente:
        "Este empleado tiene una solicitud de cambios pendiente. Tiene que resolverse antes de editar estos datos.",
      documentoPendiente:
        "Este empleado tiene un documento de este tipo pendiente de aprobación. Tiene que resolverse antes de subir otro.",
      numeroLegajoDuplicado: "Ese número de legajo ya está asignado a otro empleado.",
      noEncontrado: "No encontramos este legajo.",
    },
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
      cuilInvalid: "Ingresá un CUIL válido, con el formato XX-XXXXXXXX-X.",
      cuilPrefijo: "El CUIL tiene que empezar con 20, 23, 24 o 27.",
      cuilDigito: "El dígito verificador del CUIL no es correcto. Revisalo y volvé a intentar.",
      telefonoInvalid:
        "Ingresá un teléfono de 8 a 20 caracteres: números y, si hace falta, espacios, guiones, paréntesis y un + al principio.",
      fechaFutura: "La fecha no puede ser posterior a hoy.",
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
      valorInvalido: "Alguno de los datos no es válido. Revisalo y volvé a intentar.",
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
