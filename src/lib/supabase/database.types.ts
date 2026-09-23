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
      legajo_documentos: {
        Row: {
          created_at: string
          file_name: string
          id: string
          legajo_id: string
          mime_type: string
          size_bytes: number
          storage_path: string
          tipo: Database["public"]["Enums"]["documento_tipo"]
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          legajo_id: string
          mime_type: string
          size_bytes: number
          storage_path: string
          tipo: Database["public"]["Enums"]["documento_tipo"]
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          legajo_id?: string
          mime_type?: string
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
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_app_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      is_admin: { Args: never; Returns: boolean }
      is_valid_legajo_doc_path: { Args: { path: string }; Returns: boolean }
    }
    Enums: {
      app_role: "empleado" | "admin"
      documento_tipo: "dni_frente" | "dni_dorso" | "licencia_conducir"
      estado_civil:
        | "soltero"
        | "casado"
        | "divorciado"
        | "viudo"
        | "union_convivencial"
      estado_laboral: "activo" | "en_prueba"
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
      documento_tipo: ["dni_frente", "dni_dorso", "licencia_conducir"],
      estado_civil: [
        "soltero",
        "casado",
        "divorciado",
        "viudo",
        "union_convivencial",
      ],
      estado_laboral: ["activo", "en_prueba"],
    },
  },
} as const

