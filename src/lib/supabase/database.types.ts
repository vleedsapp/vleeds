/**
 * Database types for the public schema.
 *
 * Hand-maintained to match supabase/migrations until the local stack is
 * available; then regenerate with:
 *   npx supabase gen types typescript --local > src/lib/supabase/database.types.ts
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type MembershipRole = "owner" | "admin" | "member";

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: { name?: string; slug?: string };
        Relationships: [];
      };
      memberships: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          role: MembershipRole;
          created_at: string;
          updated_at: string;
        };
        Insert: { organization_id: string; user_id: string; role?: MembershipRole };
        Update: { role?: MembershipRole };
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      workspaces: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          slug: string;
          description: string | null;
          website_url: string | null;
          primary_domain: string | null;
          logo_url: string | null;
          settings: Json;
          timezone: string;
          archived_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          organization_id: string;
          name: string;
          slug: string;
          description?: string | null;
          website_url?: string | null;
          primary_domain?: string | null;
          logo_url?: string | null;
          settings?: Json;
        };
        Update: {
          name?: string;
          slug?: string;
          description?: string | null;
          website_url?: string | null;
          primary_domain?: string | null;
          logo_url?: string | null;
          settings?: Json;
          timezone?: string;
          archived_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "workspaces_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      icp_profiles: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          description: string | null;
          is_default: boolean;
          archived_at: string | null;
          schema_version: number;
          revision: number;
          ideal_customer: Json | null;
          target_geographies: Json | null;
          decision_maker_titles: Json | null;
          buying_signals: Json | null;
          exclusion_signals: Json | null;
          scoring_model: Json | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          name: string;
          description?: string | null;
          is_default?: boolean;
          schema_version?: number;
          ideal_customer?: Json | null;
          target_geographies?: Json | null;
          decision_maker_titles?: Json | null;
          buying_signals?: Json | null;
          exclusion_signals?: Json | null;
          scoring_model?: Json | null;
        };
        Update: {
          name?: string;
          description?: string | null;
          is_default?: boolean;
          archived_at?: string | null;
          schema_version?: number;
          ideal_customer?: Json | null;
          target_geographies?: Json | null;
          decision_maker_titles?: Json | null;
          buying_signals?: Json | null;
          exclusion_signals?: Json | null;
          scoring_model?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "icp_profiles_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      companies: {
        Row: {
          id: string;
          workspace_id: string;
          canonical_name: string;
          normalized_name: string;
          website_url: string | null;
          primary_domain: string | null;
          primary_phone: string | null;
          primary_phone_normalized: string | null;
          location: Json | null;
          employee_count_min: number | null;
          employee_count_max: number | null;
          industry: string | null;
          description: string | null;
          qualification_state: string;
          qualification_reason: string | null;
          notes: string | null;
          archived_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          canonical_name: string;
          normalized_name: string;
          website_url?: string | null;
          primary_domain?: string | null;
          primary_phone?: string | null;
          primary_phone_normalized?: string | null;
          location?: Json | null;
          employee_count_min?: number | null;
          employee_count_max?: number | null;
          industry?: string | null;
          description?: string | null;
          qualification_state?: string;
          qualification_reason?: string | null;
          notes?: string | null;
        };
        Update: {
          canonical_name?: string;
          normalized_name?: string;
          website_url?: string | null;
          primary_domain?: string | null;
          primary_phone?: string | null;
          primary_phone_normalized?: string | null;
          location?: Json | null;
          employee_count_min?: number | null;
          employee_count_max?: number | null;
          industry?: string | null;
          description?: string | null;
          qualification_state?: string;
          qualification_reason?: string | null;
          notes?: string | null;
          archived_at?: string | null;
        };
        Relationships: [];
      };
      contacts: {
        Row: {
          id: string;
          workspace_id: string;
          company_id: string;
          first_name: string | null;
          last_name: string | null;
          full_name: string;
          job_title: string | null;
          seniority: string | null;
          email: string | null;
          normalized_email: string | null;
          phone: string | null;
          phone_normalized: string | null;
          linkedin_url: string | null;
          is_primary: boolean;
          status: string;
          notes: string | null;
          archived_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          company_id: string;
          full_name: string;
          first_name?: string | null;
          last_name?: string | null;
          job_title?: string | null;
          seniority?: string | null;
          email?: string | null;
          normalized_email?: string | null;
          phone?: string | null;
          phone_normalized?: string | null;
          linkedin_url?: string | null;
          is_primary?: boolean;
          status?: string;
          notes?: string | null;
        };
        Update: {
          first_name?: string | null;
          last_name?: string | null;
          full_name?: string;
          job_title?: string | null;
          seniority?: string | null;
          email?: string | null;
          normalized_email?: string | null;
          phone?: string | null;
          phone_normalized?: string | null;
          linkedin_url?: string | null;
          is_primary?: boolean;
          status?: string;
          notes?: string | null;
          archived_at?: string | null;
        };
        Relationships: [];
      };
      lead_sources: {
        Row: {
          id: string;
          workspace_id: string;
          company_id: string | null;
          contact_id: string | null;
          source_kind: string;
          provider_key: string | null;
          external_record_id: string | null;
          source_url: string | null;
          field_key: string | null;
          observed_value: Json | null;
          confidence: number | null;
          observed_at: string | null;
          import_batch_id: string | null;
          import_row_id: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          workspace_id: string;
          company_id?: string | null;
          contact_id?: string | null;
          source_kind: string;
          provider_key?: string | null;
          external_record_id?: string | null;
          source_url?: string | null;
          field_key?: string | null;
          observed_value?: Json | null;
          confidence?: number | null;
          observed_at?: string | null;
          import_batch_id?: string | null;
          import_row_id?: string | null;
        };
        Update: never;
        Relationships: [];
      };
      lead_scores: {
        Row: {
          id: string;
          workspace_id: string;
          company_id: string;
          icp_profile_id: string;
          icp_revision: number;
          score: number | null;
          grade: string | null;
          breakdown: Json | null;
          status: string;
          scored_at: string | null;
          input_fingerprint: string | null;
          coverage_percent: number | null;
          explanation: Json | null;
          effective_weights: Json | null;
          exclusion_reasons: Json | null;
          scored_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      suppression_records: {
        Row: {
          id: string;
          workspace_id: string;
          company_id: string;
          contact_id: string | null;
          scope: string;
          reason: string | null;
          active: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          company_id: string;
          contact_id?: string | null;
          scope: string;
          reason?: string | null;
        };
        Update: { reason?: string | null; active?: boolean };
        Relationships: [];
      };
      import_batches: {
        Row: {
          id: string;
          workspace_id: string;
          filename: string;
          status: string;
          headers: Json;
          mapping: Json | null;
          total_rows: number;
          valid_rows: number;
          invalid_rows: number;
          created_rows: number;
          merged_rows: number;
          skipped_rows: number;
          failed_rows: number;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
          archived_at: string | null;
        };
        Insert: { workspace_id: string; filename: string; headers: Json; total_rows?: number };
        Update: {
          status?: string;
          mapping?: Json | null;
          valid_rows?: number;
          invalid_rows?: number;
          created_rows?: number;
          merged_rows?: number;
          skipped_rows?: number;
          failed_rows?: number;
          completed_at?: string | null;
          archived_at?: string | null;
        };
        Relationships: [];
      };
      import_rows: {
        Row: {
          id: string;
          workspace_id: string;
          import_batch_id: string;
          row_number: number;
          raw_data: Json;
          normalized_data: Json | null;
          validation_errors: Json | null;
          match_state: string;
          match_reason: string | null;
          matched_company_id: string | null;
          matched_contact_id: string | null;
          matched_import_row_id: string | null;
          decision: string | null;
          commit_result: string | null;
          commit_notes: Json | null;
          committed_company_id: string | null;
          committed_contact_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: { workspace_id: string; import_batch_id: string; row_number: number; raw_data: Json };
        Update: {
          normalized_data?: Json | null;
          validation_errors?: Json | null;
          match_state?: string;
          match_reason?: string | null;
          matched_company_id?: string | null;
          matched_contact_id?: string | null;
          matched_import_row_id?: string | null;
          decision?: string | null;
          commit_result?: string | null;
          commit_notes?: Json | null;
          committed_company_id?: string | null;
          committed_contact_id?: string | null;
        };
        Relationships: [];
      };
      discovery_runs: {
        Row: {
          id: string;
          workspace_id: string;
          icp_profile_id: string | null;
          icp_revision: number | null;
          provider_key: string;
          query: string;
          geography: Json | null;
          language_code: string | null;
          region_code: string | null;
          status: string;
          requested_result_count: number | null;
          pages_loaded: number;
          has_more: boolean;
          error_code: string | null;
          candidate_count: number;
          selected_count: number;
          dismissed_count: number;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
          cancelled_at: string | null;
        };
        Insert: {
          workspace_id: string;
          icp_profile_id?: string | null;
          icp_revision?: number | null;
          provider_key: string;
          query: string;
          geography?: Json | null;
          language_code?: string | null;
          region_code?: string | null;
          requested_result_count?: number | null;
          status?: string;
        };
        Update: {
          status?: string;
          pages_loaded?: number;
          has_more?: boolean;
          error_code?: string | null;
          completed_at?: string | null;
          cancelled_at?: string | null;
        };
        Relationships: [];
      };
      discovery_candidates: {
        Row: {
          id: string;
          workspace_id: string;
          discovery_run_id: string;
          provider_key: string;
          external_record_id: string;
          position: number;
          match_state: string | null;
          match_company_id: string | null;
          decision: string;
          decided_by: string | null;
          decided_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          discovery_run_id: string;
          provider_key: string;
          external_record_id: string;
          position?: number;
          match_state?: string | null;
          match_company_id?: string | null;
        };
        Update: { decision?: string; match_state?: string | null; match_company_id?: string | null };
        Relationships: [];
      };
      provider_usage_events: {
        Row: {
          id: string;
          workspace_id: string;
          discovery_run_id: string | null;
          provider_key: string;
          operation: string;
          requested_fields: string[] | null;
          request_count: number;
          result_count: number;
          status: string;
          sku_hint: string | null;
          estimated_cost_micros: number | null;
          pricing_reference: string | null;
          enrichment_run_id: string | null;
          estimated_credit_millis: number | null;
          contact_discovery_run_id: string | null;
          company_id: string | null;
          occurred_at: string;
          created_by: string | null;
        };
        Insert: {
          workspace_id: string;
          discovery_run_id?: string | null;
          provider_key: string;
          operation: string;
          requested_fields?: string[] | null;
          request_count: number;
          result_count?: number;
          status: string;
          sku_hint?: string | null;
          estimated_cost_micros?: number | null;
          pricing_reference?: string | null;
          enrichment_run_id?: string | null;
          estimated_credit_millis?: number | null;
          contact_discovery_run_id?: string | null;
          company_id?: string | null;
        };
        Update: { [_ in never]: never };
        Relationships: [];
      };
      company_enrichment_runs: {
        Row: {
          id: string;
          workspace_id: string;
          provider_key: string;
          input_kind: string;
          discovery_candidate_id: string | null;
          target_company_id: string | null;
          manual_company_name: string | null;
          requested_domain: string | null;
          resolved_domain: string | null;
          status: string;
          error_code: string | null;
          match_state: string | null;
          match_reason: string | null;
          matched_company_id: string | null;
          decision: string | null;
          committed_company_id: string | null;
          commit_result: string | null;
          commit_notes: Json | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
          cancelled_at: string | null;
        };
        Insert: {
          workspace_id: string;
          provider_key: string;
          input_kind: string;
          discovery_candidate_id?: string | null;
          target_company_id?: string | null;
          manual_company_name?: string | null;
          requested_domain?: string | null;
          status?: string;
        };
        Update: {
          requested_domain?: string | null;
          resolved_domain?: string | null;
          status?: string;
          error_code?: string | null;
          match_state?: string | null;
          match_reason?: string | null;
          matched_company_id?: string | null;
          decision?: string | null;
          committed_company_id?: string | null;
          commit_result?: string | null;
          commit_notes?: Json | null;
          completed_at?: string | null;
          cancelled_at?: string | null;
        };
        Relationships: [];
      };
      company_enrichment_results: {
        Row: {
          id: string;
          workspace_id: string;
          enrichment_run_id: string;
          provider_key: string;
          external_record_id: string | null;
          canonical_name: string;
          primary_domain: string;
          website_url: string | null;
          primary_phone: string | null;
          location: Json | null;
          employee_count_min: number | null;
          employee_count_max: number | null;
          industry: string | null;
          description: string | null;
          tags: Json | null;
          match_state: string;
          matched_company_id: string | null;
          created_at: string;
        };
        Insert: {
          workspace_id: string;
          enrichment_run_id: string;
          provider_key: string;
          external_record_id?: string | null;
          canonical_name: string;
          primary_domain: string;
          website_url?: string | null;
          primary_phone?: string | null;
          location?: Json | null;
          employee_count_min?: number | null;
          employee_count_max?: number | null;
          industry?: string | null;
          description?: string | null;
          tags?: Json | null;
          match_state: string;
          matched_company_id?: string | null;
        };
        Update: { [_ in never]: never };
        Relationships: [];
      };
      contact_discovery_runs: {
        Row: {
          id: string;
          workspace_id: string;
          company_id: string;
          icp_profile_id: string | null;
          icp_revision: number | null;
          provider_key: string;
          domain: string;
          status: string;
          selected_titles: Json;
          decision_maker_only: boolean;
          requested_limit: number;
          result_count: number;
          selected_count: number;
          dismissed_count: number;
          saved_count: number;
          error_code: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
          cancelled_at: string | null;
        };
        Insert: {
          workspace_id: string;
          company_id: string;
          icp_profile_id?: string | null;
          icp_revision?: number | null;
          provider_key: string;
          domain: string;
          status?: string;
          selected_titles?: Json;
          decision_maker_only?: boolean;
          requested_limit?: number;
        };
        Update: { status?: string; error_code?: string | null; completed_at?: string | null; cancelled_at?: string | null };
        Relationships: [];
      };
      contact_discovery_candidates: {
        Row: {
          id: string;
          workspace_id: string;
          contact_discovery_run_id: string;
          company_id: string;
          provider_key: string;
          provider_external_id: string | null;
          position: number;
          full_name: string;
          first_name: string | null;
          last_name: string | null;
          job_title: string | null;
          email: string;
          normalized_email: string;
          phone: string | null;
          linkedin_url: string | null;
          provider_seniority: string | null;
          provider_department: string | null;
          provider_decision_maker: boolean | null;
          verification_status: string | null;
          confidence: number | null;
          source_count: number | null;
          last_seen_on: string | null;
          role_match: string;
          match_state: string;
          matched_contact_id: string | null;
          decision: string;
          selected_action: string | null;
          commit_result: string | null;
          committed_contact_id: string | null;
          decided_by: string | null;
          decided_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          contact_discovery_run_id: string;
          company_id: string;
          provider_key: string;
          provider_external_id?: string | null;
          position?: number;
          full_name: string;
          first_name?: string | null;
          last_name?: string | null;
          job_title?: string | null;
          email: string;
          normalized_email: string;
          phone?: string | null;
          linkedin_url?: string | null;
          provider_seniority?: string | null;
          provider_department?: string | null;
          provider_decision_maker?: boolean | null;
          verification_status?: string | null;
          confidence?: number | null;
          source_count?: number | null;
          last_seen_on?: string | null;
          role_match?: string;
          match_state: string;
          matched_contact_id?: string | null;
        };
        Update: { decision?: string; selected_action?: string | null; commit_result?: string | null; committed_contact_id?: string | null };
        Relationships: [];
      };
      company_signal_observations: {
        Row: {
          id: string;
          workspace_id: string;
          company_id: string;
          icp_profile_id: string;
          icp_revision: number;
          signal_kind: string;
          signal_id: string;
          state: string;
          note: string | null;
          source_evidence_id: string | null;
          created_by: string | null;
          observed_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          company_id: string;
          icp_profile_id: string;
          icp_revision: number;
          signal_kind: string;
          signal_id: string;
          state: string;
          note?: string | null;
          source_evidence_id?: string | null;
        };
        Update: { state?: string; note?: string | null; source_evidence_id?: string | null };
        Relationships: [];
      };
      contact_attempts: {
        Row: {
          id: string;
          workspace_id: string;
          company_id: string;
          contact_id: string;
          source_task_id: string | null;
          request_id: string;
          channel: string;
          disposition: string;
          note: string | null;
          attempted_at: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      follow_up_tasks: {
        Row: {
          id: string;
          workspace_id: string;
          company_id: string;
          contact_id: string;
          source_attempt_id: string | null;
          kind: string;
          due_at: string;
          status: string;
          note: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
          completed_by: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };    Functions: {
      create_organization: {
        Args: { p_name: string; p_slug: string };
        Returns: string;
      };
      ingest_lead: {
        Args: {
          p_workspace_id: string;
          p_company: Json;
          p_contact?: Json | null;
          p_evidence?: Json;
          p_import_row_id?: string | null;
          p_enrichment_run_id?: string | null;
          p_notes?: Json | null;
        };
        Returns: Json;
      };
      commit_contact_candidate: {
        Args: { p_workspace_id: string; p_candidate_id: string; p_contact: Json; p_evidence?: Json };
        Returns: Json;
      };
      scoring_input: {
        Args: { p_workspace_id: string; p_company_id: string; p_icp_profile_id: string };
        Returns: Json;
      };
      save_lead_score_trusted: {
        Args: {
          p_actor_user_id: string;
          p_workspace_id: string;
          p_company_id: string;
          p_icp_profile_id: string;
          p_icp_revision: number;
          p_input_fingerprint: string;
          p_status: string;
          p_score: number | null;
          p_grade: string | null;
          p_breakdown: Json;
          p_coverage_percent: number;
          p_explanation: Json;
          p_effective_weights: Json;
          p_exclusion_reasons: Json | null;
        };
        Returns: string;
      };
      stage_import_rows: {
        Args: { p_workspace_id: string; p_batch_id: string; p_rows: Json };
        Returns: number;
      };
      record_contact_attempt: {
        Args: {
          p_workspace_id: string;
          p_company_id: string;
          p_contact_id: string;
          p_request_id: string;
          p_disposition: string;
          p_note?: string | null;
          p_source_task_id?: string | null;
          p_next_kind?: string | null;
          p_next_due_at?: string | null;
          p_next_note?: string | null;
          p_suppression_scope?: string | null;
          p_suppression_reason?: string | null;
        };
        Returns: Json;
      };
      schedule_follow_up: {
        Args: { p_workspace_id: string; p_company_id: string; p_contact_id: string; p_kind: string; p_due_at: string; p_note?: string | null };
        Returns: string;
      };
      reschedule_follow_up: {
        Args: { p_workspace_id: string; p_task_id: string; p_due_at: string };
        Returns: undefined;
      };
      complete_follow_up: {
        Args: { p_workspace_id: string; p_task_id: string };
        Returns: undefined;
      };
      cancel_follow_up: {
        Args: { p_workspace_id: string; p_task_id: string };
        Returns: undefined;
      };
      today_ready_candidates: {
        Args: { p_workspace_id: string; p_limit?: number };
        Returns: {
          company_id: string;
          canonical_name: string;
          location: Json | null;
          qualification_state: string;
          company_restricted: boolean;
          grade: string;
          score: number;
          coverage_percent: number | null;
          contacts: Json;
          last_attempt: Json | null;
          total_count: number;
        }[];
      };
      today_due_tasks: {
        Args: { p_workspace_id: string; p_until: string; p_limit?: number };
        Returns: {
          id: string;
          kind: string;
          due_at: string;
          note: string | null;
          created_at: string;
          company_id: string;
          company_name: string;
          company_archived: boolean;
          company_restricted: boolean;
          contact_id: string;
          contact_name: string;
          job_title: string | null;
          phone: string | null;
          contact_status: string;
          contact_archived: boolean;
          contact_restricted: boolean;
          total_count: number;
        }[];
      };
      list_companies: {
        Args: {
          p_workspace_id: string;
          p_qualification?: string | null;
          p_grade?: string | null;
          p_restricted?: boolean | null;
          p_has_contact?: boolean | null;
          p_country?: string | null;
          p_sort?: string;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: {
          id: string;
          canonical_name: string;
          primary_domain: string | null;
          location: Json | null;
          qualification_state: string;
          updated_at: string;
          grade: string | null;
          score: number | null;
          score_state: string;
          coverage_percent: number | null;
          restricted: boolean;
          contact_count: number;
          total_count: number;
        }[];
      };    };
    Enums: { membership_role: MembershipRole };
    CompositeTypes: { [_ in never]: never };
  };
};
