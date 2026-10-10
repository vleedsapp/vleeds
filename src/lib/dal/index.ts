import "server-only";

/**
 * Data Access Layer: the single boundary for tenant data. Domain modules are
 * split for size; import from "@/lib/dal" only. See ./core.ts for the rules.
 */
export {
  DataAccessError,
  getCurrentUser,
  requireUser,
  type CurrentUser,
  type MutationFailure,
  type MutationResult,
} from "./core";
export {
  canConfigureWorkspace,
  findWorkspace,
  getWorkspace,
  listAdminOrganizations,
  listWorkspaces,
  updateWorkspaceProfile,
  type AdminOrganization,
  type WorkspaceDetail,
  type WorkspaceSummary,
} from "./workspaces";
export { getDefaultIcpProfile, saveIcpSection } from "./icp-profiles";
export {
  companiesForMatching,
  companySummaries,
  createCompanyManual,
  getCompanyDetail,
  listCompanies,
  setCompanyQualification,
} from "./companies";
export { addContactManual, contactsByEmail, contactsForMerge } from "./contacts";
export { addSuppression, liftSuppression } from "./suppressions";
export {
  cancelImport,
  commitNextChunk,
  createImportBatch,
  getImportBatch,
  listImportRows,
  listRecentImports,
  reopenMapping,
  sampleRows,
  setRowDecision,
  stageMapping,
  startCommit,
  type ImportBatchView,
  type ImportStatus,
  type ReviewFilter,
  type ReviewPage,
  type ReviewRow,
} from "./imports";
export {
  addCandidateReferences,
  companiesLinkedToProviderIds,
  createDiscoveryRun,
  getCandidate,
  getDiscoveryRun,
  listIcpProfilesForDiscovery,
  listRecentDiscoveryRuns,
  providerIdsSeenBefore,
  setCandidateDecision,
  updateDiscoveryRun,
  type DiscoveryIcpOption,
  type DiscoveryRunView,
  type StoredCandidate,
} from "./discovery";
export {
  commitContactCandidate,
  companyForContactDiscovery,
  contactsByEmails,
  createContactRun,
  getContactRun,
  insertContactCandidates,
  latestContactRun,
  listContactCandidates,
  setContactCandidateDecision,
  updateContactRun,
  type CandidateInsert,
  type CandidateRecord,
  type ContactRunRecord,
} from "./contact-discovery";
export { activeSuppressions } from "./suppressions";
export {
  contactRunCreditMillis,
  recordContactSearchUsage,
  enrichmentRunCreditMillis,
  enrichmentUsageSummary,
  providerUsageTotals,
  recordEnrichmentUsage,
  recordProviderUsage,
  type EnrichmentUsageSummary,
  type UsageTotals,
} from "./provider-usage";
export {
  commitEnrichment,
  companiesForEnrichmentMatching,
  companyWithDomain,
  createEnrichmentRun,
  discoveryReference,
  discoveryReferenceById,
  getEnrichmentResult,
  getEnrichmentRun,
  insertEnrichmentResult,
  openEnrichmentRunForCandidate,
  resultLocation,
  updateEnrichmentRun,
  waitingReferences,
  type EnrichmentCommitOutcome,
  type EnrichmentResultRecord,
  type EnrichmentRunRecord,
} from "./enrichment";
export { companyForMerge } from "./companies";
export {
  companiesNeedingEvaluation,
  currentFingerprint,
  evaluateAndSaveFit,
  latestFit,
  listIcpProfilesForScoring,
  saveLeadScore,
  scoringInputFor,
  setSignalObservation,
  signalObservations,
  type EvaluateOutcome,
  type SignalObservation,
  type StoredFit,
} from "./scoring";
export { getTodayView } from "./today";
export {
  closeFollowUp,
  companyWorkflow,
  contactLatest,
  openTask,
  recordContactAttempt,
  rescheduleFollowUp,
  scheduleFollowUp,
  type ActivityItem,
  type CompanyWorkflow,
  type ContactWorkflow,
  type OpenTask,
  type WorkflowFailure,
} from "./contact-workflow";
