export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      cuenta_eventos: {
        Row: {
          actor_id: string
          created_at: string
          id: string
          motivo: string | null
          profile_id: string
          tipo: Database["public"]["Enums"]["cuenta_evento_tipo"]
        }
        Insert: {
          actor_id: string
          created_at?: string
          id?: string
          motivo?: string | null
          profile_id: string
          tipo: Database["public"]["Enums"]["cuenta_evento_tipo"]
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: string
          motivo?: string | null
          profile_id?: string
          tipo?: Database["public"]["Enums"]["cuenta_evento_tipo"]
        }
        Relationships: [
          {
            foreignKeyName: "cuenta_eventos_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuenta_eventos_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      legajo_documentos: {
        Row: {
          created_at: string
          estado: Database["public"]["Enums"]["documento_estado"]
          file_name: string
          id: string
          legajo_id: string
          mime_type: string
          motivo_rechazo: string | null
          revisado_en: string | null
          revisado_por: string | null
          size_bytes: number
          storage_path: string
          tipo: Database["public"]["Enums"]["documento_tipo"]
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          estado?: Database["public"]["Enums"]["documento_estado"]
          file_name: string
          id?: string
          legajo_id: string
          mime_type: string
          motivo_rechazo?: string | null
          revisado_en?: string | null
          revisado_por?: string | null
          size_bytes: number
          storage_path: string
          tipo: Database["public"]["Enums"]["documento_tipo"]
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          estado?: Database["public"]["Enums"]["documento_estado"]
          file_name?: string
          id?: string
          legajo_id?: string
          mime_type?: string
          motivo_rechazo?: string | null
          revisado_en?: string | null
          revisado_por?: string | null
          size_bytes?: number
          storage_path?: string
          tipo?: Database["public"]["Enums"]["documento_tipo"]
          updated_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "legajo_documentos_legajo_id_fkey"
            columns: ["legajo_id"]
            isOneToOne: false
            referencedRelation: "legajos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legajo_documentos_revisado_por_fkey"
            columns: ["revisado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legajo_documentos_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      legajo_hijos: {
        Row: {
          created_at: string
          fecha_nacimiento: string
          id: string
          legajo_id: string
          nombre_completo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          fecha_nacimiento: string
          id?: string
          legajo_id: string
          nombre_completo: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          fecha_nacimiento?: string
          id?: string
          legajo_id?: string
          nombre_completo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "legajo_hijos_legajo_id_fkey"
            columns: ["legajo_id"]
            isOneToOne: false
            referencedRelation: "legajos"
            referencedColumns: ["id"]
          },
        ]
      }
      legajos: {
        Row: {
          alergias: string | null
          apellido: string | null
          area: string | null
          bruto_mensual: number | null
          calle_altura: string | null
          convenio: string | null
          created_at: string
          cuil: string | null
          dni: string | null
          email_personal: string | null
          emergencia_domicilio: string | null
          emergencia_nombre: string | null
          emergencia_parentesco: string | null
          emergencia_telefono: string | null
          estado_civil: Database["public"]["Enums"]["estado_civil"] | null
          estado_laboral: Database["public"]["Enums"]["estado_laboral"] | null
          fecha_ingreso: string | null
          fecha_nacimiento: string | null
          grupo_sanguineo: string | null
          id: string
          localidad: string | null
          medicacion_habitual: string | null
          modalidad: string | null
          nacionalidad: string | null
          nombre_conyuge: string | null
          nombres: string | null
          numero_afiliado: string | null
          numero_legajo: string | null
          obra_social: string | null
          partido: string | null
          partido_otro: string | null
          piso_depto: string | null
          profile_id: string
          puesto: string | null
          sede: string | null
          telefono_celular: string | null
          tiene_hijos: boolean | null
          updated_at: string
        }
        Insert: {
          alergias?: string | null
          apellido?: string | null
          area?: string | null
          bruto_mensual?: number | null
          calle_altura?: string | null
          convenio?: string | null
          created_at?: string
          cuil?: string | null
          dni?: string | null
          email_personal?: string | null
          emergencia_domicilio?: string | null
          emergencia_nombre?: string | null
          emergencia_parentesco?: string | null
          emergencia_telefono?: string | null
          estado_civil?: Database["public"]["Enums"]["estado_civil"] | null
          estado_laboral?: Database["public"]["Enums"]["estado_laboral"] | null
          fecha_ingreso?: string | null
          fecha_nacimiento?: string | null
          grupo_sanguineo?: string | null
          id?: string
          localidad?: string | null
          medicacion_habitual?: string | null
          modalidad?: string | null
          nacionalidad?: string | null
          nombre_conyuge?: string | null
          nombres?: string | null
          numero_afiliado?: string | null
          numero_legajo?: string | null
          obra_social?: string | null
          partido?: string | null
          partido_otro?: string | null
          piso_depto?: string | null
          profile_id: string
          puesto?: string | null
          sede?: string | null
          telefono_celular?: string | null
          tiene_hijos?: boolean | null
          updated_at?: string
        }
        Update: {
          alergias?: string | null
          apellido?: string | null
          area?: string | null
          bruto_mensual?: number | null
          calle_altura?: string | null
          convenio?: string | null
          created_at?: string
          cuil?: string | null
          dni?: string | null
          email_personal?: string | null
          emergencia_domicilio?: string | null
          emergencia_nombre?: string | null
          emergencia_parentesco?: string | null
          emergencia_telefono?: string | null
          estado_civil?: Database["public"]["Enums"]["estado_civil"] | null
          estado_laboral?: Database["public"]["Enums"]["estado_laboral"] | null
          fecha_ingreso?: string | null
          fecha_nacimiento?: string | null
          grupo_sanguineo?: string | null
          id?: string
          localidad?: string | null
          medicacion_habitual?: string | null
          modalidad?: string | null
          nacionalidad?: string | null
          nombre_conyuge?: string | null
          nombres?: string | null
          numero_afiliado?: string | null
          numero_legajo?: string | null
          obra_social?: string | null
          partido?: string | null
          partido_otro?: string | null
          piso_depto?: string | null
          profile_id?: string
          puesto?: string | null
          sede?: string | null
          telefono_celular?: string | null
          tiene_hijos?: boolean | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "legajos_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          debe_cambiar_password: boolean
          estado_cuenta: Database["public"]["Enums"]["cuenta_estado"]
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          debe_cambiar_password?: boolean
          estado_cuenta?: Database["public"]["Enums"]["cuenta_estado"]
          id: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          debe_cambiar_password?: boolean
          estado_cuenta?: Database["public"]["Enums"]["cuenta_estado"]
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: []
      }
      solicitudes_cambio: {
        Row: {
          created_at: string
          estado: Database["public"]["Enums"]["solicitud_estado"]
          id: string
          legajo_id: string
          motivo_rechazo: string | null
          revisado_en: string | null
          revisado_por: string | null
          solicitado_por: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          estado?: Database["public"]["Enums"]["solicitud_estado"]
          id?: string
          legajo_id: string
          motivo_rechazo?: string | null
          revisado_en?: string | null
          revisado_por?: string | null
          solicitado_por?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          estado?: Database["public"]["Enums"]["solicitud_estado"]
          id?: string
          legajo_id?: string
          motivo_rechazo?: string | null
          revisado_en?: string | null
          revisado_por?: string | null
          solicitado_por?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "solicitudes_cambio_legajo_id_fkey"
            columns: ["legajo_id"]
            isOneToOne: false
            referencedRelation: "legajos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_cambio_revisado_por_fkey"
            columns: ["revisado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_cambio_solicitado_por_fkey"
            columns: ["solicitado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      solicitudes_cambio_items: {
        Row: {
          campo: string
          created_at: string
          id: string
          solicitud_id: string
          valor_anterior: string | null
          valor_propuesto: string | null
        }
        Insert: {
          campo: string
          created_at?: string
          id?: string
          solicitud_id: string
          valor_anterior?: string | null
          valor_propuesto?: string | null
        }
        Update: {
          campo?: string
          created_at?: string
          id?: string
          solicitud_id?: string
          valor_anterior?: string | null
          valor_propuesto?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "solicitudes_cambio_items_solicitud_id_fkey"
            columns: ["solicitud_id"]
            isOneToOne: false
            referencedRelation: "solicitudes_cambio"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      aprobar_documento: {
        Args: { p_documento_id: string }
        Returns: undefined
      }
      aprobar_solicitud: {
        Args: { p_solicitud_id: string }
        Returns: undefined
      }
      campos_solicitud_permitidos: { Args: never; Returns: string[] }
      cerrar_sesiones_cuenta: {
        Args: { p_profile_id: string }
        Returns: undefined
      }
      confirmar_cambio_password: { Args: never; Returns: undefined }
      crear_solicitud: {
        Args: { p_items: Json; p_legajo_id: string }
        Returns: string
      }
      current_app_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      desactivar_cuenta: {
        Args: { p_motivo: string; p_profile_id: string }
        Returns: undefined
      }
      is_admin: { Args: never; Returns: boolean }
      is_valid_hijos_json: { Args: { valor: string }; Returns: boolean }
      is_valid_legajo_doc_path: { Args: { path: string }; Returns: boolean }
      is_valid_solicitud_valor: {
        Args: { campo: string; valor: string }
        Returns: boolean
      }
      marcar_password_temporal: {
        Args: { p_profile_id: string }
        Returns: undefined
      }
      pendientes_admin: {
        Args: never
        Returns: {
          documentos: number
          solicitudes: number
        }[]
      }
      purgar_cuenta: {
        Args: { p_email_confirmacion: string; p_profile_id: string }
        Returns: Json
      }
      reactivar_cuenta: { Args: { p_profile_id: string }; Returns: undefined }
      rechazar_documento: {
        Args: { p_documento_id: string; p_motivo: string }
        Returns: undefined
      }
      rechazar_solicitud: {
        Args: { p_motivo: string; p_solicitud_id: string }
        Returns: undefined
      }
      registrar_creacion_cuenta: {
        Args: { p_profile_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "empleado" | "admin"
      cuenta_estado: "activa" | "inactiva"
      cuenta_evento_tipo:
        | "creacion"
        | "desactivacion"
        | "reactivacion"
        | "password_temporal"
        | "password_cambiada"
      documento_estado: "pendiente" | "aprobado" | "rechazado" | "reemplazado"
      documento_tipo: "dni_frente" | "dni_dorso" | "licencia_conducir"
      estado_civil:
        | "soltero"
        | "casado"
        | "divorciado"
        | "viudo"
        | "union_convivencial"
      estado_laboral: "activo" | "en_prueba"
      solicitud_estado: "pendiente" | "aprobada" | "rechazada" | "cancelada"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["empleado", "admin"],
      cuenta_estado: ["activa", "inactiva"],
      cuenta_evento_tipo: [
        "creacion",
        "desactivacion",
        "reactivacion",
        "password_temporal",
        "password_cambiada",
      ],
      documento_estado: ["pendiente", "aprobado", "rechazado", "reemplazado"],
      documento_tipo: ["dni_frente", "dni_dorso", "licencia_conducir"],
      estado_civil: [
        "soltero",
        "casado",
        "divorciado",
        "viudo",
        "union_convivencial",
      ],
      estado_laboral: ["activo", "en_prueba"],
      solicitud_estado: ["pendiente", "aprobada", "rechazada", "cancelada"],
    },
  },
} as const

