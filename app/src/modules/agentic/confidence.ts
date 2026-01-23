import { ExecutionState, ExecutionTurn } from '../litellm/types';
import { createLogger } from '../../utils/logger';

const log = createLogger('AGENTIC:CONFIDENCE');

export function calculateConfidence(state: ExecutionState, turn: ExecutionTurn): number {
  // Model self-assessment (from turn.confidence)
  const modelSelfConfidence = turn.confidence / 100;

  // Tool success rate
  const totalTools = turn.toolCalls.length;
  const successfulTools = turn.toolResults.filter((result) => {
    // Consider a tool successful if it doesn't contain error indicators
    const resultStr = JSON.stringify(result.result).toLowerCase();
    return !resultStr.includes('error') && !resultStr.includes('failed');
  }).length;
  const toolSuccessRate = totalTools > 0 ? successfulTools / totalTools : 1.0;

  // Error repetition rate (penalize repeated errors more heavily)
  const errorRepetitionRate = state.sameErrorCount / Math.max(state.turnNumber, 1);
  const errorPenalty = Math.min(errorRepetitionRate * 2, 1.0); // Double penalty, capped at 1.0

  // Test success rate
  const totalTests = state.testResults.length;
  const passedTests = state.testResults.filter((t) => t.passed).length;
  const testSuccessRate = totalTests > 0 ? passedTests / totalTests : 0.5;

  // Progress rate (file changes indicate progress)
  const progressRate = state.noProgressTurns === 0 ? 1.0 : Math.max(0, 1 - state.noProgressTurns / 5);

  // User correction penalty
  const userCorrectionPenalty = Math.min(state.userCorrectionCount * 0.15, 0.3); // Max 30% penalty

  // Calculate weighted confidence
  const confidence =
    modelSelfConfidence * 0.4 +
    toolSuccessRate * 0.2 +
    (1 - errorPenalty) * 0.2 +
    testSuccessRate * 0.1 +
    progressRate * 0.1 -
    userCorrectionPenalty;

  const finalConfidence = Math.max(0, Math.min(100, Math.round(confidence * 100)));

  log.info(`Confidence calculation: model=${Math.round(modelSelfConfidence * 100)}%, tools=${Math.round(toolSuccessRate * 100)}%, errors=${Math.round((1 - errorPenalty) * 100)}%, tests=${Math.round(testSuccessRate * 100)}%, progress=${Math.round(progressRate * 100)}%, userCorrections=-${Math.round(userCorrectionPenalty * 100)}% => ${finalConfidence}%`);

  return finalConfidence;
}

/**
 * Determines confidence level category
 */
export function getConfidenceLevel(confidence: number): 'high' | 'moderate' | 'low' | 'critical' {
  if (confidence > 70) return 'high';
  if (confidence >= 50) return 'moderate';
  if (confidence >= 30) return 'low';
  return 'critical';
}

/**
 * Checks if confidence indicates the agent is stuck
 */
export function isStuck(confidence: number, consecutiveLowTurns: number): boolean {
  return confidence < 30 && consecutiveLowTurns >= 2;
}
