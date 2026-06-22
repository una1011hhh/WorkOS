export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          user_id: string;
          email: string | null;
          display_name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          email?: string | null;
          display_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          email?: string | null;
          display_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      contacts: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          role: string | null;
          team: string | null;
          company: string | null;
          email: string | null;
          phone: string | null;
          notes: string | null;
          external_source: "manual" | "feishu";
          external_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["contacts"]["Row"]> & {
          user_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["contacts"]["Row"]>;
      };
      contact_groups: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          contact_ids: string[];
          external_source: "manual" | "feishu";
          external_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["contact_groups"]["Row"]> & {
          user_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["contact_groups"]["Row"]>;
      };
      projects: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          type: string | null;
          background: string | null;
          goal: string | null;
          status: string;
          priority: string;
          progress: number;
          start_date: string | null;
          due_date: string | null;
          risks: string[];
          next_action: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["projects"]["Row"]> & {
          user_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["projects"]["Row"]>;
      };
      tasks: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          description: string | null;
          source: string | null;
          requester: string | null;
          project_id: string | null;
          status: string;
          priority: string;
          due_date: string | null;
          estimated_hours: number;
          notes: string | null;
          waiting_for: string | null;
          waiting_reason: string | null;
          follow_up_date: string | null;
          tags: string[];
          created_at: string;
          completed_at: string | null;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["tasks"]["Row"]> & {
          user_id: string;
          title: string;
        };
        Update: Partial<Database["public"]["Tables"]["tasks"]["Row"]>;
      };
      time_sessions: {
        Row: {
          id: string;
          user_id: string;
          task_id: string;
          start_time: string;
          end_time: string | null;
          duration_seconds: number;
          is_running: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["time_sessions"]["Row"]> & {
          user_id: string;
          task_id: string;
          start_time: string;
        };
        Update: Partial<Database["public"]["Tables"]["time_sessions"]["Row"]>;
      };
      meetings: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          date: string;
          duration_minutes: number;
          attendees: string[];
          notes: string | null;
          decisions: string[];
          related_project_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["meetings"]["Row"]> & {
          user_id: string;
          title: string;
          date: string;
        };
        Update: Partial<Database["public"]["Tables"]["meetings"]["Row"]>;
      };
      meeting_action_items: {
        Row: {
          id: string;
          user_id: string;
          meeting_id: string;
          text: string;
          owner: string | null;
          due_date: string | null;
          task_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["meeting_action_items"]["Row"]> & {
          user_id: string;
          meeting_id: string;
          text: string;
        };
        Update: Partial<Database["public"]["Tables"]["meeting_action_items"]["Row"]>;
      };
      reflections: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          content: string | null;
          type: string;
          related_project_id: string | null;
          related_task_id: string | null;
          date: string;
          duration_minutes: number;
          tags: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["reflections"]["Row"]> & {
          user_id: string;
          title: string;
          date: string;
        };
        Update: Partial<Database["public"]["Tables"]["reflections"]["Row"]>;
      };
      reports: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          type: string;
          start_date: string;
          end_date: string;
          generated_content: string;
          included_task_ids: string[];
          included_reflection_ids: string[];
          options: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["reports"]["Row"]> & {
          user_id: string;
          title: string;
          type: string;
          start_date: string;
          end_date: string;
          generated_content: string;
        };
        Update: Partial<Database["public"]["Tables"]["reports"]["Row"]>;
      };
    };
    Views: {
      task_time_totals: {
        Row: {
          user_id: string;
          task_id: string;
          accumulated_seconds: number;
          actual_hours: number;
        };
      };
    };
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
