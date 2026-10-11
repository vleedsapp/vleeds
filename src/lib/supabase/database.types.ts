
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "companies": {
                  Row: {
                    "archived_at": string | null,"canonical_name": string,"created_at": string,"created_by": string | null,"description": string | null,"employee_count_max": number | null,"employee_count_min": number | null,"id": string,"industry": string | null,"location": Json | null,"normalized_name": string,"notes": string | null,"primary_domain": string | null,"primary_phone": string | null,"primary_phone_normalized": string | null,"qualification_reason": string | null,"qualification_state": string,"updated_at": string,"website_url": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"canonical_name": string,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"employee_count_max"?: number | null,"employee_count_min"?: number | null,"id"?: string,"industry"?: string | null,"location"?: Json | null,"normalized_name": string,"notes"?: string | null,"primary_domain"?: string | null,"primary_phone"?: string | null,"primary_phone_normalized"?: string | null,"qualification_reason"?: string | null,"qualification_state"?: string,"updated_at"?: string,"website_url"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"canonical_name"?: string,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"employee_count_max"?: number | null,"employee_count_min"?: number | null,"id"?: string,"industry"?: string | null,"location"?: Json | null,"normalized_name"?: string,"notes"?: string | null,"primary_domain"?: string | null,"primary_phone"?: string | null,"primary_phone_normalized"?: string | null,"qualification_reason"?: string | null,"qualification_state"?: string,"updated_at"?: string,"website_url"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "companies_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"company_enrichment_results": {
                  Row: {
                    "canonical_name": string,"created_at": string,"description": string | null,"employee_count_max": number | null,"employee_count_min": number | null,"enrichment_run_id": string,"external_record_id": string | null,"id": string,"industry": string | null,"location": Json | null,"match_state": string,"matched_company_id": string | null,"primary_domain": string,"primary_phone": string | null,"provider_key": string,"tags": Json | null,"website_url": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "canonical_name": string,"created_at"?: string,"description"?: string | null,"employee_count_max"?: number | null,"employee_count_min"?: number | null,"enrichment_run_id": string,"external_record_id"?: string | null,"id"?: string,"industry"?: string | null,"location"?: Json | null,"match_state": string,"matched_company_id"?: string | null,"primary_domain": string,"primary_phone"?: string | null,"provider_key": string,"tags"?: Json | null,"website_url"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "canonical_name"?: string,"created_at"?: string,"description"?: string | null,"employee_count_max"?: number | null,"employee_count_min"?: number | null,"enrichment_run_id"?: string,"external_record_id"?: string | null,"id"?: string,"industry"?: string | null,"location"?: Json | null,"match_state"?: string,"matched_company_id"?: string | null,"primary_domain"?: string,"primary_phone"?: string | null,"provider_key"?: string,"tags"?: Json | null,"website_url"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_enrichment_results_matched_fk"
      columns: ["workspace_id","matched_company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "company_enrichment_results_run_fk"
      columns: ["workspace_id","enrichment_run_id"]
isOneToOne: false
      referencedRelation: "company_enrichment_runs"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "company_enrichment_results_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"company_enrichment_runs": {
                  Row: {
                    "cancelled_at": string | null,"commit_notes": Json | null,"commit_result": string | null,"committed_company_id": string | null,"completed_at": string | null,"created_at": string,"created_by": string | null,"decision": string | null,"discovery_candidate_id": string | null,"error_code": string | null,"id": string,"input_kind": string,"manual_company_name": string | null,"match_reason": string | null,"match_state": string | null,"matched_company_id": string | null,"provider_key": string,"requested_domain": string | null,"resolved_domain": string | null,"status": string,"target_company_id": string | null,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cancelled_at"?: string | null,"commit_notes"?: Json | null,"commit_result"?: string | null,"committed_company_id"?: string | null,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"decision"?: string | null,"discovery_candidate_id"?: string | null,"error_code"?: string | null,"id"?: string,"input_kind": string,"manual_company_name"?: string | null,"match_reason"?: string | null,"match_state"?: string | null,"matched_company_id"?: string | null,"provider_key": string,"requested_domain"?: string | null,"resolved_domain"?: string | null,"status"?: string,"target_company_id"?: string | null,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "cancelled_at"?: string | null,"commit_notes"?: Json | null,"commit_result"?: string | null,"committed_company_id"?: string | null,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"decision"?: string | null,"discovery_candidate_id"?: string | null,"error_code"?: string | null,"id"?: string,"input_kind"?: string,"manual_company_name"?: string | null,"match_reason"?: string | null,"match_state"?: string | null,"matched_company_id"?: string | null,"provider_key"?: string,"requested_domain"?: string | null,"resolved_domain"?: string | null,"status"?: string,"target_company_id"?: string | null,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_enrichment_runs_candidate_fk"
      columns: ["workspace_id","discovery_candidate_id"]
isOneToOne: false
      referencedRelation: "discovery_candidates"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "company_enrichment_runs_committed_fk"
      columns: ["workspace_id","committed_company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "company_enrichment_runs_matched_fk"
      columns: ["workspace_id","matched_company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "company_enrichment_runs_target_fk"
      columns: ["workspace_id","target_company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "company_enrichment_runs_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"company_signal_observations": {
                  Row: {
                    "company_id": string,"created_at": string,"created_by": string | null,"icp_profile_id": string,"icp_revision": number,"id": string,"note": string | null,"observed_at": string,"signal_id": string,"signal_kind": string,"source_evidence_id": string | null,"state": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "company_id": string,"created_at"?: string,"created_by"?: string | null,"icp_profile_id": string,"icp_revision": number,"id"?: string,"note"?: string | null,"observed_at"?: string,"signal_id": string,"signal_kind": string,"source_evidence_id"?: string | null,"state": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "company_id"?: string,"created_at"?: string,"created_by"?: string | null,"icp_profile_id"?: string,"icp_revision"?: number,"id"?: string,"note"?: string | null,"observed_at"?: string,"signal_id"?: string,"signal_kind"?: string,"source_evidence_id"?: string | null,"state"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_signal_observations_company_fk"
      columns: ["workspace_id","company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "company_signal_observations_evidence_fk"
      columns: ["source_evidence_id"]
isOneToOne: false
      referencedRelation: "lead_sources"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "company_signal_observations_profile_fk"
      columns: ["workspace_id","icp_profile_id"]
isOneToOne: false
      referencedRelation: "icp_profiles"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "company_signal_observations_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"contact_attempts": {
                  Row: {
                    "attempted_at": string,"channel": string,"company_id": string,"contact_id": string,"created_at": string,"created_by": string | null,"disposition": string,"id": string,"note": string | null,"request_id": string,"source_task_id": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempted_at"?: string,"channel"?: string,"company_id": string,"contact_id": string,"created_at"?: string,"created_by"?: string | null,"disposition": string,"id"?: string,"note"?: string | null,"request_id": string,"source_task_id"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "attempted_at"?: string,"channel"?: string,"company_id"?: string,"contact_id"?: string,"created_at"?: string,"created_by"?: string | null,"disposition"?: string,"id"?: string,"note"?: string | null,"request_id"?: string,"source_task_id"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contact_attempts_contact_fk"
      columns: ["workspace_id","company_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["workspace_id","company_id","id"]
    },{
      foreignKeyName: "contact_attempts_source_task_fk"
      columns: ["workspace_id","company_id","contact_id","source_task_id"]
isOneToOne: false
      referencedRelation: "follow_up_tasks"
      referencedColumns: ["workspace_id","company_id","contact_id","id"]
    },{
      foreignKeyName: "contact_attempts_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"contact_discovery_candidates": {
                  Row: {
                    "commit_result": string | null,"committed_contact_id": string | null,"company_id": string,"confidence": number | null,"contact_discovery_run_id": string,"created_at": string,"decided_at": string | null,"decided_by": string | null,"decision": string,"email": string,"first_name": string | null,"full_name": string,"id": string,"job_title": string | null,"last_name": string | null,"last_seen_on": string | null,"linkedin_url": string | null,"match_state": string,"matched_contact_id": string | null,"normalized_email": string,"phone": string | null,"position": number,"provider_decision_maker": boolean | null,"provider_department": string | null,"provider_external_id": string | null,"provider_key": string,"provider_seniority": string | null,"role_match": string,"selected_action": string | null,"source_count": number | null,"updated_at": string,"verification_status": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "commit_result"?: string | null,"committed_contact_id"?: string | null,"company_id": string,"confidence"?: number | null,"contact_discovery_run_id": string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision"?: string,"email": string,"first_name"?: string | null,"full_name": string,"id"?: string,"job_title"?: string | null,"last_name"?: string | null,"last_seen_on"?: string | null,"linkedin_url"?: string | null,"match_state": string,"matched_contact_id"?: string | null,"normalized_email": string,"phone"?: string | null,"position"?: number,"provider_decision_maker"?: boolean | null,"provider_department"?: string | null,"provider_external_id"?: string | null,"provider_key": string,"provider_seniority"?: string | null,"role_match"?: string,"selected_action"?: string | null,"source_count"?: number | null,"updated_at"?: string,"verification_status"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "commit_result"?: string | null,"committed_contact_id"?: string | null,"company_id"?: string,"confidence"?: number | null,"contact_discovery_run_id"?: string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision"?: string,"email"?: string,"first_name"?: string | null,"full_name"?: string,"id"?: string,"job_title"?: string | null,"last_name"?: string | null,"last_seen_on"?: string | null,"linkedin_url"?: string | null,"match_state"?: string,"matched_contact_id"?: string | null,"normalized_email"?: string,"phone"?: string | null,"position"?: number,"provider_decision_maker"?: boolean | null,"provider_department"?: string | null,"provider_external_id"?: string | null,"provider_key"?: string,"provider_seniority"?: string | null,"role_match"?: string,"selected_action"?: string | null,"source_count"?: number | null,"updated_at"?: string,"verification_status"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contact_discovery_candidates_committed_fk"
      columns: ["workspace_id","company_id","committed_contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["workspace_id","company_id","id"]
    },{
      foreignKeyName: "contact_discovery_candidates_matched_fk"
      columns: ["workspace_id","matched_contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "contact_discovery_candidates_run_fk"
      columns: ["workspace_id","contact_discovery_run_id","company_id"]
isOneToOne: false
      referencedRelation: "contact_discovery_runs"
      referencedColumns: ["workspace_id","id","company_id"]
    },{
      foreignKeyName: "contact_discovery_candidates_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"contact_discovery_runs": {
                  Row: {
                    "cancelled_at": string | null,"company_id": string,"completed_at": string | null,"created_at": string,"created_by": string | null,"decision_maker_only": boolean,"dismissed_count": number,"domain": string,"error_code": string | null,"icp_profile_id": string | null,"icp_revision": number | null,"id": string,"provider_key": string,"requested_limit": number,"result_count": number,"saved_count": number,"selected_count": number,"selected_titles": NonNullable<Json>,"status": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cancelled_at"?: string | null,"company_id": string,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"decision_maker_only"?: boolean,"dismissed_count"?: number,"domain": string,"error_code"?: string | null,"icp_profile_id"?: string | null,"icp_revision"?: number | null,"id"?: string,"provider_key": string,"requested_limit"?: number,"result_count"?: number,"saved_count"?: number,"selected_count"?: number,"selected_titles"?: NonNullable<Json>,"status"?: string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "cancelled_at"?: string | null,"company_id"?: string,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"decision_maker_only"?: boolean,"dismissed_count"?: number,"domain"?: string,"error_code"?: string | null,"icp_profile_id"?: string | null,"icp_revision"?: number | null,"id"?: string,"provider_key"?: string,"requested_limit"?: number,"result_count"?: number,"saved_count"?: number,"selected_count"?: number,"selected_titles"?: NonNullable<Json>,"status"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contact_discovery_runs_company_fk"
      columns: ["workspace_id","company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "contact_discovery_runs_icp_fk"
      columns: ["workspace_id","icp_profile_id"]
isOneToOne: false
      referencedRelation: "icp_profiles"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "contact_discovery_runs_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"contacts": {
                  Row: {
                    "archived_at": string | null,"company_id": string,"created_at": string,"created_by": string | null,"email": string | null,"first_name": string | null,"full_name": string,"id": string,"is_primary": boolean,"job_title": string | null,"last_name": string | null,"linkedin_url": string | null,"normalized_email": string | null,"notes": string | null,"phone": string | null,"phone_normalized": string | null,"seniority": string | null,"status": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"company_id": string,"created_at"?: string,"created_by"?: string | null,"email"?: string | null,"first_name"?: string | null,"full_name": string,"id"?: string,"is_primary"?: boolean,"job_title"?: string | null,"last_name"?: string | null,"linkedin_url"?: string | null,"normalized_email"?: string | null,"notes"?: string | null,"phone"?: string | null,"phone_normalized"?: string | null,"seniority"?: string | null,"status"?: string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"company_id"?: string,"created_at"?: string,"created_by"?: string | null,"email"?: string | null,"first_name"?: string | null,"full_name"?: string,"id"?: string,"is_primary"?: boolean,"job_title"?: string | null,"last_name"?: string | null,"linkedin_url"?: string | null,"normalized_email"?: string | null,"notes"?: string | null,"phone"?: string | null,"phone_normalized"?: string | null,"seniority"?: string | null,"status"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contacts_company_fk"
      columns: ["workspace_id","company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "contacts_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"discovery_candidates": {
                  Row: {
                    "created_at": string,"decided_at": string | null,"decided_by": string | null,"decision": string,"discovery_run_id": string,"external_record_id": string,"id": string,"match_company_id": string | null,"match_state": string | null,"position": number,"provider_key": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision"?: string,"discovery_run_id": string,"external_record_id": string,"id"?: string,"match_company_id"?: string | null,"match_state"?: string | null,"position"?: number,"provider_key": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision"?: string,"discovery_run_id"?: string,"external_record_id"?: string,"id"?: string,"match_company_id"?: string | null,"match_state"?: string | null,"position"?: number,"provider_key"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "discovery_candidates_company_fk"
      columns: ["workspace_id","match_company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "discovery_candidates_run_fk"
      columns: ["workspace_id","discovery_run_id","provider_key"]
isOneToOne: false
      referencedRelation: "discovery_runs"
      referencedColumns: ["workspace_id","id","provider_key"]
    },{
      foreignKeyName: "discovery_candidates_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"discovery_runs": {
                  Row: {
                    "cancelled_at": string | null,"candidate_count": number,"completed_at": string | null,"created_at": string,"created_by": string | null,"dismissed_count": number,"error_code": string | null,"geography": Json | null,"has_more": boolean,"icp_profile_id": string | null,"icp_revision": number | null,"id": string,"language_code": string | null,"pages_loaded": number,"provider_key": string,"query": string,"region_code": string | null,"requested_result_count": number | null,"selected_count": number,"status": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cancelled_at"?: string | null,"candidate_count"?: number,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"dismissed_count"?: number,"error_code"?: string | null,"geography"?: Json | null,"has_more"?: boolean,"icp_profile_id"?: string | null,"icp_revision"?: number | null,"id"?: string,"language_code"?: string | null,"pages_loaded"?: number,"provider_key": string,"query": string,"region_code"?: string | null,"requested_result_count"?: number | null,"selected_count"?: number,"status"?: string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "cancelled_at"?: string | null,"candidate_count"?: number,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"dismissed_count"?: number,"error_code"?: string | null,"geography"?: Json | null,"has_more"?: boolean,"icp_profile_id"?: string | null,"icp_revision"?: number | null,"id"?: string,"language_code"?: string | null,"pages_loaded"?: number,"provider_key"?: string,"query"?: string,"region_code"?: string | null,"requested_result_count"?: number | null,"selected_count"?: number,"status"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "discovery_runs_icp_fk"
      columns: ["workspace_id","icp_profile_id"]
isOneToOne: false
      referencedRelation: "icp_profiles"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "discovery_runs_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"follow_up_tasks": {
                  Row: {
                    "cancelled_at": string | null,"cancelled_by": string | null,"company_id": string,"completed_at": string | null,"completed_by": string | null,"contact_id": string,"created_at": string,"created_by": string | null,"due_at": string,"id": string,"kind": string,"note": string | null,"source_attempt_id": string | null,"status": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cancelled_at"?: string | null,"cancelled_by"?: string | null,"company_id": string,"completed_at"?: string | null,"completed_by"?: string | null,"contact_id": string,"created_at"?: string,"created_by"?: string | null,"due_at": string,"id"?: string,"kind": string,"note"?: string | null,"source_attempt_id"?: string | null,"status"?: string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "cancelled_at"?: string | null,"cancelled_by"?: string | null,"company_id"?: string,"completed_at"?: string | null,"completed_by"?: string | null,"contact_id"?: string,"created_at"?: string,"created_by"?: string | null,"due_at"?: string,"id"?: string,"kind"?: string,"note"?: string | null,"source_attempt_id"?: string | null,"status"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "follow_up_tasks_contact_fk"
      columns: ["workspace_id","company_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["workspace_id","company_id","id"]
    },{
      foreignKeyName: "follow_up_tasks_source_attempt_fk"
      columns: ["workspace_id","company_id","contact_id","source_attempt_id"]
isOneToOne: false
      referencedRelation: "contact_attempts"
      referencedColumns: ["workspace_id","company_id","contact_id","id"]
    },{
      foreignKeyName: "follow_up_tasks_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"icp_profiles": {
                  Row: {
                    "archived_at": string | null,"buying_signals": Json | null,"created_at": string,"created_by": string | null,"decision_maker_titles": Json | null,"description": string | null,"exclusion_signals": Json | null,"id": string,"ideal_customer": Json | null,"is_default": boolean,"name": string,"revision": number,"schema_version": number,"scoring_model": Json | null,"target_geographies": Json | null,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"buying_signals"?: Json | null,"created_at"?: string,"created_by"?: string | null,"decision_maker_titles"?: Json | null,"description"?: string | null,"exclusion_signals"?: Json | null,"id"?: string,"ideal_customer"?: Json | null,"is_default"?: boolean,"name": string,"revision"?: number,"schema_version"?: number,"scoring_model"?: Json | null,"target_geographies"?: Json | null,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"buying_signals"?: Json | null,"created_at"?: string,"created_by"?: string | null,"decision_maker_titles"?: Json | null,"description"?: string | null,"exclusion_signals"?: Json | null,"id"?: string,"ideal_customer"?: Json | null,"is_default"?: boolean,"name"?: string,"revision"?: number,"schema_version"?: number,"scoring_model"?: Json | null,"target_geographies"?: Json | null,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "icp_profiles_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"import_batches": {
                  Row: {
                    "archived_at": string | null,"completed_at": string | null,"created_at": string,"created_by": string | null,"created_rows": number,"failed_rows": number,"filename": string,"headers": NonNullable<Json>,"id": string,"invalid_rows": number,"mapping": Json | null,"merged_rows": number,"skipped_rows": number,"status": string,"total_rows": number,"updated_at": string,"valid_rows": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"created_rows"?: number,"failed_rows"?: number,"filename": string,"headers": NonNullable<Json>,"id"?: string,"invalid_rows"?: number,"mapping"?: Json | null,"merged_rows"?: number,"skipped_rows"?: number,"status"?: string,"total_rows"?: number,"updated_at"?: string,"valid_rows"?: number,"workspace_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"created_rows"?: number,"failed_rows"?: number,"filename"?: string,"headers"?: NonNullable<Json>,"id"?: string,"invalid_rows"?: number,"mapping"?: Json | null,"merged_rows"?: number,"skipped_rows"?: number,"status"?: string,"total_rows"?: number,"updated_at"?: string,"valid_rows"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "import_batches_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"import_rows": {
                  Row: {
                    "commit_notes": Json | null,"commit_result": string | null,"committed_company_id": string | null,"committed_contact_id": string | null,"created_at": string,"decision": string | null,"id": string,"import_batch_id": string,"match_reason": string | null,"match_state": string,"matched_company_id": string | null,"matched_contact_id": string | null,"matched_import_row_id": string | null,"normalized_data": Json | null,"raw_data": NonNullable<Json>,"row_number": number,"updated_at": string,"validation_errors": Json | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "commit_notes"?: Json | null,"commit_result"?: string | null,"committed_company_id"?: string | null,"committed_contact_id"?: string | null,"created_at"?: string,"decision"?: string | null,"id"?: string,"import_batch_id": string,"match_reason"?: string | null,"match_state"?: string,"matched_company_id"?: string | null,"matched_contact_id"?: string | null,"matched_import_row_id"?: string | null,"normalized_data"?: Json | null,"raw_data": NonNullable<Json>,"row_number": number,"updated_at"?: string,"validation_errors"?: Json | null,"workspace_id": string
                  }
                  Update: {
                    "commit_notes"?: Json | null,"commit_result"?: string | null,"committed_company_id"?: string | null,"committed_contact_id"?: string | null,"created_at"?: string,"decision"?: string | null,"id"?: string,"import_batch_id"?: string,"match_reason"?: string | null,"match_state"?: string,"matched_company_id"?: string | null,"matched_contact_id"?: string | null,"matched_import_row_id"?: string | null,"normalized_data"?: Json | null,"raw_data"?: NonNullable<Json>,"row_number"?: number,"updated_at"?: string,"validation_errors"?: Json | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "import_rows_batch_fk"
      columns: ["workspace_id","import_batch_id"]
isOneToOne: false
      referencedRelation: "import_batches"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "import_rows_committed_company_fk"
      columns: ["workspace_id","committed_company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "import_rows_committed_contact_fk"
      columns: ["workspace_id","committed_contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "import_rows_matched_company_fk"
      columns: ["workspace_id","matched_company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "import_rows_matched_contact_fk"
      columns: ["workspace_id","matched_contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "import_rows_matched_row_fk"
      columns: ["workspace_id","matched_import_row_id"]
isOneToOne: false
      referencedRelation: "import_rows"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "import_rows_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"lead_scores": {
                  Row: {
                    "breakdown": Json | null,"company_id": string,"coverage_percent": number | null,"created_at": string,"effective_weights": Json | null,"exclusion_reasons": Json | null,"explanation": Json | null,"grade": string | null,"icp_profile_id": string,"icp_revision": number,"id": string,"input_fingerprint": string | null,"score": number | null,"scored_at": string | null,"scored_by": string | null,"status": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "breakdown"?: Json | null,"company_id": string,"coverage_percent"?: number | null,"created_at"?: string,"effective_weights"?: Json | null,"exclusion_reasons"?: Json | null,"explanation"?: Json | null,"grade"?: string | null,"icp_profile_id": string,"icp_revision": number,"id"?: string,"input_fingerprint"?: string | null,"score"?: number | null,"scored_at"?: string | null,"scored_by"?: string | null,"status"?: string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "breakdown"?: Json | null,"company_id"?: string,"coverage_percent"?: number | null,"created_at"?: string,"effective_weights"?: Json | null,"exclusion_reasons"?: Json | null,"explanation"?: Json | null,"grade"?: string | null,"icp_profile_id"?: string,"icp_revision"?: number,"id"?: string,"input_fingerprint"?: string | null,"score"?: number | null,"scored_at"?: string | null,"scored_by"?: string | null,"status"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lead_scores_company_fk"
      columns: ["workspace_id","company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "lead_scores_icp_profile_fk"
      columns: ["workspace_id","icp_profile_id"]
isOneToOne: false
      referencedRelation: "icp_profiles"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "lead_scores_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"lead_sources": {
                  Row: {
                    "company_id": string | null,"confidence": number | null,"contact_id": string | null,"created_at": string,"created_by": string | null,"external_record_id": string | null,"field_key": string | null,"id": string,"import_batch_id": string | null,"import_row_id": string | null,"observed_at": string | null,"observed_value": Json | null,"provider_key": string | null,"source_kind": string,"source_url": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "company_id"?: string | null,"confidence"?: number | null,"contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"external_record_id"?: string | null,"field_key"?: string | null,"id"?: string,"import_batch_id"?: string | null,"import_row_id"?: string | null,"observed_at"?: string | null,"observed_value"?: Json | null,"provider_key"?: string | null,"source_kind": string,"source_url"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "company_id"?: string | null,"confidence"?: number | null,"contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"external_record_id"?: string | null,"field_key"?: string | null,"id"?: string,"import_batch_id"?: string | null,"import_row_id"?: string | null,"observed_at"?: string | null,"observed_value"?: Json | null,"provider_key"?: string | null,"source_kind"?: string,"source_url"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lead_sources_company_fk"
      columns: ["workspace_id","company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "lead_sources_contact_company_fk"
      columns: ["workspace_id","company_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["workspace_id","company_id","id"]
    },{
      foreignKeyName: "lead_sources_contact_fk"
      columns: ["workspace_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "lead_sources_import_batch_fk"
      columns: ["workspace_id","import_batch_id"]
isOneToOne: false
      referencedRelation: "import_batches"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "lead_sources_import_row_fk"
      columns: ["workspace_id","import_row_id"]
isOneToOne: false
      referencedRelation: "import_rows"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "lead_sources_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"memberships": {
                  Row: {
                    "created_at": string,"id": string,"organization_id": string,"role": Database["public"]['Enums']["membership_role"],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"organization_id": string,"role"?: Database["public"]['Enums']["membership_role"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"organization_id"?: string,"role"?: Database["public"]['Enums']["membership_role"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memberships_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"name": string,"slug": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name": string,"slug": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string,"slug"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"provider_usage_events": {
                  Row: {
                    "company_id": string | null,"contact_discovery_run_id": string | null,"created_by": string | null,"discovery_run_id": string | null,"enrichment_run_id": string | null,"estimated_cost_micros": number | null,"estimated_credit_millis": number | null,"id": string,"occurred_at": string,"operation": string,"pricing_reference": string | null,"provider_key": string,"request_count": number,"requested_fields": (string)[] | null,"result_count": number,"sku_hint": string | null,"status": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "company_id"?: string | null,"contact_discovery_run_id"?: string | null,"created_by"?: string | null,"discovery_run_id"?: string | null,"enrichment_run_id"?: string | null,"estimated_cost_micros"?: number | null,"estimated_credit_millis"?: number | null,"id"?: string,"occurred_at"?: string,"operation": string,"pricing_reference"?: string | null,"provider_key": string,"request_count": number,"requested_fields"?: (string)[] | null,"result_count"?: number,"sku_hint"?: string | null,"status": string,"workspace_id": string
                  }
                  Update: {
                    "company_id"?: string | null,"contact_discovery_run_id"?: string | null,"created_by"?: string | null,"discovery_run_id"?: string | null,"enrichment_run_id"?: string | null,"estimated_cost_micros"?: number | null,"estimated_credit_millis"?: number | null,"id"?: string,"occurred_at"?: string,"operation"?: string,"pricing_reference"?: string | null,"provider_key"?: string,"request_count"?: number,"requested_fields"?: (string)[] | null,"result_count"?: number,"sku_hint"?: string | null,"status"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "provider_usage_events_company_fk"
      columns: ["workspace_id","company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "provider_usage_events_contact_run_fk"
      columns: ["workspace_id","contact_discovery_run_id"]
isOneToOne: false
      referencedRelation: "contact_discovery_runs"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "provider_usage_events_enrichment_run_fk"
      columns: ["workspace_id","enrichment_run_id"]
isOneToOne: false
      referencedRelation: "company_enrichment_runs"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "provider_usage_events_run_fk"
      columns: ["workspace_id","discovery_run_id"]
isOneToOne: false
      referencedRelation: "discovery_runs"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "provider_usage_events_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"suppression_records": {
                  Row: {
                    "active": boolean,"company_id": string,"contact_id": string | null,"created_at": string,"created_by": string | null,"id": string,"reason": string | null,"scope": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"company_id": string,"contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"reason"?: string | null,"scope": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "active"?: boolean,"company_id"?: string,"contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"reason"?: string | null,"scope"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "suppression_records_company_fk"
      columns: ["workspace_id","company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "suppression_records_contact_fk"
      columns: ["workspace_id","company_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["workspace_id","company_id","id"]
    },{
      foreignKeyName: "suppression_records_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"workspaces": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"created_by": string | null,"description": string | null,"id": string,"logo_url": string | null,"name": string,"organization_id": string,"primary_domain": string | null,"settings": NonNullable<Json>,"slug": string,"timezone": string,"updated_at": string,"website_url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"logo_url"?: string | null,"name": string,"organization_id": string,"primary_domain"?: string | null,"settings"?: NonNullable<Json>,"slug": string,"timezone"?: string,"updated_at"?: string,"website_url"?: string | null
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"logo_url"?: string | null,"name"?: string,"organization_id"?: string,"primary_domain"?: string | null,"settings"?: NonNullable<Json>,"slug"?: string,"timezone"?: string,"updated_at"?: string,"website_url"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspaces_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "cancel_follow_up":
{ Args: { "p_task_id": string,"p_workspace_id": string }; Returns: undefined
                           },
"commit_contact_candidate":
{ Args: { "p_candidate_id": string,"p_contact": Json,"p_evidence"?: Json,"p_workspace_id": string }; Returns: Json
                           },
"complete_follow_up":
{ Args: { "p_task_id": string,"p_workspace_id": string }; Returns: undefined
                           },
"create_organization":
{ Args: { "p_name": string,"p_slug": string }; Returns: string
                           },
"ingest_lead":
{ Args: { "p_company": Json,"p_contact"?: Json,"p_enrichment_run_id"?: string,"p_evidence"?: Json,"p_import_row_id"?: string,"p_notes"?: Json,"p_workspace_id": string }; Returns: Json
                           },
"list_companies":
{ Args: { "p_country"?: string,"p_grade"?: string,"p_has_contact"?: boolean,"p_limit"?: number,"p_offset"?: number,"p_qualification"?: string,"p_restricted"?: boolean,"p_sort"?: string,"p_workspace_id": string }; Returns: {
              "canonical_name": string,"contact_count": number,"coverage_percent": number,"grade": string,"id": string,"location": Json,"primary_domain": string,"qualification_state": string,"restricted": boolean,"score": number,"score_state": string,"total_count": number,"updated_at": string
            }[]
                           },
"record_contact_attempt":
{ Args: { "p_company_id": string,"p_contact_id": string,"p_disposition": string,"p_next_due_at"?: string,"p_next_kind"?: string,"p_next_note"?: string,"p_note"?: string,"p_request_id": string,"p_source_task_id"?: string,"p_suppression_reason"?: string,"p_suppression_scope"?: string,"p_workspace_id": string }; Returns: Json
                           },
"reschedule_follow_up":
{ Args: { "p_due_at": string,"p_task_id": string,"p_workspace_id": string }; Returns: undefined
                           },
"save_lead_score_trusted":
{ Args: { "p_actor_user_id": string,"p_breakdown": Json,"p_company_id": string,"p_coverage_percent": number,"p_effective_weights": Json,"p_exclusion_reasons": Json,"p_explanation": Json,"p_grade": string,"p_icp_profile_id": string,"p_icp_revision": number,"p_input_fingerprint": string,"p_score": number,"p_status": string,"p_workspace_id": string }; Returns: string
                           },
"schedule_follow_up":
{ Args: { "p_company_id": string,"p_contact_id": string,"p_due_at": string,"p_kind": string,"p_note"?: string,"p_workspace_id": string }; Returns: string
                           },
"scoring_input":
{ Args: { "p_company_id": string,"p_icp_profile_id": string,"p_workspace_id": string }; Returns: Json
                           },
"stage_import_rows":
{ Args: { "p_batch_id": string,"p_rows": Json,"p_workspace_id": string }; Returns: number
                           },
"today_due_tasks":
{ Args: { "p_limit"?: number,"p_until": string,"p_workspace_id": string }; Returns: {
              "company_archived": boolean,"company_id": string,"company_name": string,"company_restricted": boolean,"contact_archived": boolean,"contact_id": string,"contact_name": string,"contact_restricted": boolean,"contact_status": string,"created_at": string,"due_at": string,"id": string,"job_title": string,"kind": string,"note": string,"phone": string,"total_count": number
            }[]
                           },
"today_ready_candidates":
{ Args: { "p_limit"?: number,"p_workspace_id": string }; Returns: {
              "canonical_name": string,"company_id": string,"company_restricted": boolean,"contacts": Json,"coverage_percent": number,"grade": string,"last_attempt": Json,"location": Json,"qualification_state": string,"score": number,"total_count": number
            }[]
                           }
          }
          Enums: {
            "membership_role": "owner"|"admin"|"member"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "membership_role": ["owner", "admin", "member"]
          }
        }
} as const
