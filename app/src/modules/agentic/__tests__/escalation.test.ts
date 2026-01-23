import { checkEscalationTriggers, getNextModel, isAtMaxEscalation } from '../escalation';
import { ExecutionState, ExecutionTurn } from '../../litellm/types';

describe('Escalation Logic', () => {
  const createMockState = (overrides?: Partial<ExecutionState>): ExecutionState => ({
    turnNumber: 5,
    confidenceScore: 50,
    lastError: null,
    errorCount: 0,
    sameErrorCount: 0,
    fileChanges: [],
    testResults: [],
    userInterrupts: [],
    userCorrectionCount: 0,
    noProgressTurns: 0,
    ...overrides,
  });

  const createMockTurn = (overrides?: Partial<ExecutionTurn>): ExecutionTurn => ({
    turnNumber: 5,
    input: 'test',
    toolCalls: [],
    toolResults: [],
    response: 'test response',
    confidence: 50,
    status: 'continue',
    modelUsed: 'gemini-3-pro',
    ...overrides,
  });

  test('should escalate on low confidence for 2 consecutive turns', () => {
    const state = createMockState({ confidenceScore: 25 });
    const turn = createMockTurn({ confidence: 25 });
    
    const result = checkEscalationTriggers(state, turn, 'gemini-3-pro', 2);
    
    expect(result.shouldEscalate).toBe(true);
    expect(result.reason).toContain('Low confidence');
    expect(result.suggestedModel).toBe('claude-sonnet-4.5');
  });

  test('should escalate on same error repeated 3 times', () => {
    const state = createMockState({ sameErrorCount: 3 });
    const turn = createMockTurn();
    
    const result = checkEscalationTriggers(state, turn, 'gemini-3-pro', 0);
    
    expect(result.shouldEscalate).toBe(true);
    expect(result.reason).toContain('Same error repeated');
  });

  test('should escalate on no progress for 5 turns', () => {
    const state = createMockState({ noProgressTurns: 5 });
    const turn = createMockTurn();
    
    const result = checkEscalationTriggers(state, turn, 'gemini-3-pro', 0);
    
    expect(result.shouldEscalate).toBe(true);
    expect(result.reason).toContain('No progress');
  });

  test('should escalate when model reports stuck', () => {
    const state = createMockState();
    const turn = createMockTurn({ status: 'stuck' });
    
    const result = checkEscalationTriggers(state, turn, 'gemini-3-pro', 0);
    
    expect(result.shouldEscalate).toBe(true);
    expect(result.reason).toContain('stuck');
  });

  test('should not escalate when no triggers met', () => {
    const state = createMockState({ confidenceScore: 75 });
    const turn = createMockTurn({ confidence: 75 });
    
    const result = checkEscalationTriggers(state, turn, 'gemini-3-pro', 0);
    
    expect(result.shouldEscalate).toBe(false);
  });

  test('should follow escalation ladder correctly', () => {
    expect(getNextModel('gemini-2.5-flash-lite')).toBe('gemini-3-pro');
    expect(getNextModel('gemini-3-pro')).toBe('claude-sonnet-4.5');
    expect(getNextModel('claude-sonnet-4.5')).toBe('claude-opus-4.5');
    expect(getNextModel('claude-opus-4.5')).toBe('claude-opus-4.5'); // Already at max
  });

  test('should detect max escalation', () => {
    expect(isAtMaxEscalation('claude-opus-4.5')).toBe(true);
    expect(isAtMaxEscalation('claude-sonnet-4.5')).toBe(false);
    expect(isAtMaxEscalation('gemini-3-pro')).toBe(false);
  });
});
