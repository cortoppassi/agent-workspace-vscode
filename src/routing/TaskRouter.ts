import type { CodexModel } from '../chat/protocol';
import type { AgentConfig } from '../config/types';

export type TaskComplexity = 'simple' | 'standard' | 'complex';

export interface AgentRoutingProfile {
  readonly agent: AgentConfig;
  readonly instructions: string;
}

export interface RouteRecommendation {
  readonly agent: AgentConfig;
  readonly complexity: TaskComplexity;
  readonly confidence: number;
  readonly agentReason: string;
  readonly modelReason: string;
  readonly model?: CodexModel;
  readonly reasoningEffort?: string;
}

export interface DispatchRecord {
  readonly version: 1;
  readonly routedAt: number;
  readonly complexity: TaskComplexity;
  readonly confidence: number;
  readonly agentReason: string;
  readonly modelReason: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
}

interface Domain {
  readonly label: string;
  readonly terms: readonly string[];
}

const DOMAINS: readonly Domain[] = [
  { label: 'frontend', terms: ['frontend', 'ui', 'ux', 'react', 'vue', 'angular', 'css', 'html', 'layout', 'design', 'component', 'componente', 'responsiv', 'tela'] },
  { label: 'backend', terms: ['backend', 'api', 'endpoint', 'server', 'servidor', 'database', 'banco', 'sql', 'auth', 'autentic'] },
  { label: 'testing', terms: ['test', 'teste', 'qa', 'coverage', 'cobertura', 'regression', 'regressao', 'flaky'] },
  { label: 'security', terms: ['security', 'seguranca', 'vulnerability', 'vulnerabilidade', 'permission', 'permissao'] },
  { label: 'documentation', terms: ['docs', 'documentation', 'documentacao', 'readme', 'guide', 'guia'] },
  { label: 'devops', terms: ['devops', 'ci', 'cd', 'deploy', 'docker', 'kubernetes', 'pipeline', 'infra'] },
  { label: 'mobile', terms: ['mobile', 'android', 'ios', 'reactnative', 'flutter', 'swift', 'kotlin'] },
  { label: 'data', terms: ['data', 'dados', 'analytics', 'analise', 'etl', 'dataset', 'spreadsheet', 'planilha'] },
];

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'com', 'da', 'de', 'do', 'e', 'em', 'for', 'in', 'na', 'no', 'o', 'of', 'on',
  'os', 'para', 'por', 'the', 'to', 'um', 'uma', 'with', 'agente', 'agent', 'arquivo', 'code', 'codigo', 'file',
  'implementar', 'implement', 'project', 'projeto', 'task', 'tarefa',
  'alterar', 'atualizar', 'change', 'corrigir', 'create', 'criar', 'fix', 'update',
]);

const COMPLEX_MARKERS = [
  'architecture', 'arquitetura', 'migration', 'migracao', 'refactor', 'refator', 'security', 'seguranca',
  'performance', 'concorrencia', 'concurrency', 'race', 'investigate', 'investigar', 'multi-step', 'multiplas etapas',
];

export function recommendRoutes(
  task: string,
  profiles: readonly AgentRoutingProfile[],
  models: readonly CodexModel[],
): RouteRecommendation[] {
  const complexity = assessTaskComplexity(task);
  const modelSelection = chooseModel(models, complexity);
  const ranked = profiles
    .filter((profile) => profile.agent.provider === 'codex')
    .map((profile, index) => scoreProfile(task, profile, index))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  return ranked.map(({ profile, score, specialtyMatches, domainMatches }) => {
    const confidence = Math.min(0.95, score > 0 ? 0.5 + score * 0.04 : 0.35);
    const agentReason = specialtyMatches.length > 0
      ? `Matched specialties: ${specialtyMatches.join(', ')}.`
      : domainMatches.length > 0
        ? `Task and agent profile both match ${domainMatches.join(', ')} work.`
        : 'No strong specialty match; kept as an available Codex route.';
    return {
      agent: profile.agent,
      complexity,
      confidence,
      agentReason,
      modelReason: modelSelection.reason,
      ...(modelSelection.model ? { model: modelSelection.model } : {}),
      ...(modelSelection.reasoningEffort ? { reasoningEffort: modelSelection.reasoningEffort } : {}),
    };
  });
}

export function assessTaskComplexity(task: string): TaskComplexity {
  const normalized = normalize(task);
  const markerCount = COMPLEX_MARKERS.filter((marker) => normalized.includes(marker)).length;
  if (normalized.length > 500 || markerCount >= 2) {
    return 'complex';
  }
  if (normalized.length <= 180 && markerCount === 0) {
    return 'simple';
  }
  return 'standard';
}

export function createDispatchRecord(
  recommendation: RouteRecommendation,
  routedAt: number,
): DispatchRecord {
  return {
    version: 1,
    routedAt,
    complexity: recommendation.complexity,
    confidence: recommendation.confidence,
    agentReason: recommendation.agentReason,
    modelReason: recommendation.modelReason,
    ...(recommendation.model ? { model: recommendation.model.model } : {}),
    ...(recommendation.reasoningEffort ? { reasoningEffort: recommendation.reasoningEffort } : {}),
  };
}

export function readDispatchRecord(value: unknown): DispatchRecord | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const complexity = record.complexity;
  if (
    record.version !== 1
    || !isTimestamp(record.routedAt)
    || (complexity !== 'simple' && complexity !== 'standard' && complexity !== 'complex')
    || typeof record.confidence !== 'number'
    || !Number.isFinite(record.confidence)
    || record.confidence < 0
    || record.confidence > 1
    || typeof record.agentReason !== 'string'
    || !record.agentReason.trim()
    || typeof record.modelReason !== 'string'
    || !record.modelReason.trim()
  ) {
    return undefined;
  }
  return {
    version: 1,
    routedAt: record.routedAt,
    complexity,
    confidence: record.confidence,
    agentReason: record.agentReason,
    modelReason: record.modelReason,
    ...(typeof record.model === 'string' && record.model ? { model: record.model } : {}),
    ...(typeof record.reasoningEffort === 'string' && record.reasoningEffort
      ? { reasoningEffort: record.reasoningEffort }
      : {}),
  };
}

function scoreProfile(task: string, profile: AgentRoutingProfile, index: number): {
  readonly profile: AgentRoutingProfile;
  readonly index: number;
  readonly score: number;
  readonly specialtyMatches: readonly string[];
  readonly domainMatches: readonly string[];
} {
  const taskTerms = tokenize(task);
  const specialties = profile.agent.specialties ?? [];
  const specialtyMatches = specialties.filter((specialty) =>
    tokenize(specialty).some((term) => taskTerms.some((taskTerm) => termsMatch(taskTerm, term))),
  );
  const profileTerms = tokenize([
    profile.agent.name,
    profile.agent.cwd,
    ...specialties,
    profile.instructions,
  ].join(' '));
  const directMatches = taskTerms.filter((term) => profileTerms.some((profileTerm) => termsMatch(term, profileTerm)));
  const domainMatches = DOMAINS.filter((domain) =>
    hasDomainMatch(taskTerms, domain) && hasDomainMatch(profileTerms, domain),
  ).map((domain) => domain.label);
  const score = specialtyMatches.length * 6 + domainMatches.length * 4 + new Set(directMatches).size;
  return { profile, index, score, specialtyMatches, domainMatches };
}

function chooseModel(models: readonly CodexModel[], complexity: TaskComplexity): {
  readonly model?: CodexModel;
  readonly reasoningEffort?: string;
  readonly reason: string;
} {
  if (models.length === 0) {
    return { reason: 'Model metadata was unavailable, so Codex will use its automatic selection.' };
  }
  const preferredTiers = complexity === 'simple' ? ['luna', 'terra'] : complexity === 'standard' ? ['terra'] : ['sol'];
  const model = preferredTiers
    .map((tier) => models.find((candidate) => normalize(candidate.model).includes(tier)))
    .find((candidate) => candidate !== undefined)
    ?? models.find((candidate) => candidate.isDefault)
    ?? models[0];
  if (!model) {
    return { reason: 'Codex will use its automatic model selection.' };
  }
  const desiredEffort = complexity === 'simple' ? 'low' : complexity === 'standard' ? 'medium' : 'high';
  const reasoningEffort = model.supportedReasoningEfforts.some((candidate) => candidate.reasoningEffort === desiredEffort)
    ? desiredEffort
    : model.defaultReasoningEffort ?? model.supportedReasoningEfforts[0]?.reasoningEffort;
  const goal = complexity === 'simple'
    ? 'The task looks narrow and well-defined, so this route prioritizes lower cost and latency.'
    : complexity === 'standard'
      ? 'The task needs balanced capability, cost, and latency.'
      : 'The task has complex signals, so this route prioritizes reliability over minimum cost.';
  return {
    model,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    reason: `${goal} Selected ${model.displayName}${reasoningEffort ? ` with ${reasoningEffort} reasoning` : ''}.`,
  };
}

function tokenize(value: string): string[] {
  return normalize(value)
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function termsMatch(left: string, right: string): boolean {
  return left === right || (left.length >= 5 && right.length >= 5 && (left.startsWith(right) || right.startsWith(left)));
}

function hasDomainMatch(terms: readonly string[], domain: Domain): boolean {
  return terms.some((term) => domain.terms.some((domainTerm) => termsMatch(term, domainTerm)));
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
