/**
 * Changing an existing plan: AI revisions ("reduce the budget by 20%") and
 * direct edits made in the app. In both cases every amount and date is
 * recalculated in code so the plan stays consistent.
 */
export { applyRevision, type RevisionResult } from './apply';
export { diffPlans } from './diff';
export { RevisionError, type RevisionErrorCode } from './errors';
export { parseIntent, type ParsedIntent } from './intent';
export { applyManualChange, type ManualChange } from './manual';
