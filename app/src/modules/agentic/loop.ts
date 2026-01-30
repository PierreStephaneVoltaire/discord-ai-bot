import {
  AgenticExecutionConfig,
  ExecutionState,
  ExecutionTurn,
  Message,
  ToolCall,
  AgentRole,
} from '../litellm/types';
import { chatCompletion, getTools } from '../litellm/index';
import { calculateConfidence, isStuck } from './confidence';
import { checkForInterrupts, handleInterrupt, recordInterrupt } from './interrupts';
import { streamProgressToDiscord, formatClarificationRequest } from './progress';
import { loadPrompt } from '../../templates/loader';
import { getTemplateForAgent } from '../../templates/registry';
import { createLogger } from '../../utils/logger';
import {
  checkEscalationTriggers,
  isAtMaxEscalation,
  resetEscalationState
} from './escalation';
import {
  createLock,
  updateLockTurn,
  abortLock,
  releaseLock,
  isAborted
} from './lock';
import {
  logTurnToDb,
  logExecutionStart,
  logExecutionComplete
} from './logging';
import {
  emitExecutionStarted,
  emitTurnCompleted,
  emitModelEscalated,
  emitExecutionCompleted,
  emitExecutionAborted
} from './events';

const log = createLogger('SEQUENTIAL:LOOP');

async function getSystemPromptForAgent(agentRole: AgentRole, workspacePath: string): Promise<string> {
  const templateName = getTemplateForAgent(agentRole);
  let prompt: string;
  try {
    prompt = await loadPrompt(templateName);
  } catch (error) {
    log.warn(`Template ${templateName} not found, falling back to 'coding'`);
    prompt = await loadPrompt('coding');
  }

  // Inject workspace context
  return prompt
    .replace('{{workspace_path}}', workspacePath)
    .replace(/Your workspace is at:? [^{\n]*/g, `Your workspace is at: ${workspacePath}`);
}

function parseTurn(
  response: any,
  turnNumber: number,
  model: string,
  usage?: { prompt_tokens?: number; completion_tokens?: number }
): ExecutionTurn {
  const choice = response.choices?.[0];
  const message = choice?.message;

  const toolCalls: ToolCall[] = message?.tool_calls || [];
  const toolResults: Array<{ tool: string; result: unknown }> = [];

  // Extract confidence from response content if available
  let confidence = 70; // Default
  const content = message?.content || '';
  const confidenceMatch = content.match(/confidence[:\s]+(\d+)/i);
  if (confidenceMatch) {
    confidence = parseInt(confidenceMatch[1], 10);
  }

  // Determine status from response
  let status: ExecutionTurn['status'] = 'continue';
  if (content.toLowerCase().includes('complete') || content.toLowerCase().includes('done')) {
    status = 'complete';
  } else if (content.toLowerCase().includes('stuck') || content.toLowerCase().includes('need help')) {
    status = 'stuck';
  } else if (content.toLowerCase().includes('clarif')) {
    status = 'needs_clarification';
  }

  return {
    turnNumber,
    input: '', // Will be set by caller
    toolCalls,
    toolResults,
    response: content,
    thinking: content,
    confidence,
    status,
    modelUsed: model,
    inputTokens: usage?.prompt_tokens,
    outputTokens: usage?.completion_tokens,
  };
}

function updateExecutionState(state: ExecutionState, turn: ExecutionTurn): void {
  // Track errors
  if (turn.response.toLowerCase().includes('error')) {
    state.errorCount++;
    if (state.lastError === turn.response) {
      state.sameErrorCount++;
    } else {
      state.lastError = turn.response;
      state.sameErrorCount = 1;
    }
  }

  // Track file changes
  const fileChangePatterns = [
    /wrote.*file/i,
    /created.*file/i,
    /modified.*file/i,
    /updated.*file/i,
    /<<.*>>/i, // New file markers
  ];

  let hasFileChange = false;
  for (const pattern of fileChangePatterns) {
    if (pattern.test(turn.response)) {
      hasFileChange = true;
      break;
    }
  }

  // Also check if relevant tools were called (implicit file changes/progress)
  if (!hasFileChange && turn.toolCalls && turn.toolCalls.length > 0) {
    const PROGRESS_TOOLS = [
      'write_to_file',
      'create_file',
      'replace_file_content',
      'edit_file',
      'run_command',
      'execute_command',
      'apply_diff',
      'read_file', // Reading files is also progress (investigation)
      'list_dir',  // Exploration is progress
      'search_code'
    ];

    for (const call of turn.toolCalls) {
      if (PROGRESS_TOOLS.includes(call.function.name)) {
        hasFileChange = true;
        log.info(`🛠️ Tool execution detected as progress: ${call.function.name}`);

        // If it's a file modification tool, try to extract filename from args for the tracker
        try {
          const args = JSON.parse(call.function.arguments);
          // Check common argument names for file paths
          const fileName = args.TargetFile || args.file_path || args.target_file || args.filename || args.path || args.AbsolutePath;

          if (fileName && typeof fileName === 'string') {
            if (!state.fileChanges.includes(fileName)) {
              state.fileChanges.push(fileName);
              log.info(`📝 Added to file changes tracker (from tool): ${fileName}`);
            }
          }
        } catch (e) {
          // Ignore args parsing error - purely optional tracking
          log.warn(`Failed to parse tool args for tracking: ${e}`);
        }
        break;
      }
    }
  }

  if (hasFileChange) {
    state.noProgressTurns = 0;
    // Extract file names from markers if possible (legacy text check)
    const markerMatch = turn.response.match(/<<([^>]+)>>/);
    if (markerMatch) {
      const fileName = markerMatch[1];
      log.info(`🔍 FILE MARKER DETECTED in turn ${state.turnNumber}: <<${fileName}>>`);
      if (!state.fileChanges.includes(fileName)) {
        state.fileChanges.push(fileName);
        log.info(`📝 Added to file changes tracker: ${fileName}`);
      }
    }
  } else {
    state.noProgressTurns++;
  }
}

async function askUserForClarification(
  threadId: string,
  state: ExecutionState,
  reason: string
): Promise<void> {
  log.warn(`Asking user for clarification in thread ${threadId}: ${reason}`);

  const clarificationMessage = formatClarificationRequest(
    reason,
    state.confidenceScore,
    state.turnNumber
  );

  await streamProgressToDiscord(threadId, {
    type: 'clarification_request',
    clarificationMessage,
    turnNumber: state.turnNumber,
    confidence: state.confidenceScore,
  });
}

async function checkpointProgress(
  threadId: string,
  state: ExecutionState,
  turns: ExecutionTurn[]
): Promise<void> {
  log.info(`Checkpointing progress at turn ${state.turnNumber}`);
  await streamProgressToDiscord(threadId, {
    type: 'checkpoint',
    checkpointData: {
      turnNumber: state.turnNumber,
      confidence: state.confidenceScore,
      filesModified: state.fileChanges.length,
      totalTurns: turns.length,
    },
  });
}

export async function executeSequentialThinkingLoop(
  config: AgenticExecutionConfig,
  initialPrompt: string,
  threadId: string,
  initialConfidence: number = 80,
  workspacePath: string = '/workspace'
): Promise<{ success: boolean; finalResponse: string; turns: ExecutionTurn[]; finalConfidence: number }> {
  log.info(`Starting sequential thinking loop for thread ${threadId} (Agent: ${config.agentRole})`);

  // Create execution lock
  const lock = createLock(threadId);

  // Log execution start
  await logExecutionStart({
    threadId,
    taskType: config.agentRole,
    agentRole: config.agentRole,
    model: config.model,
  });

  // Emit execution started event
  await emitExecutionStarted({
    threadId,
    taskType: config.agentRole,
    agentRole: config.agentRole,
  });

  const state: ExecutionState = {
    turnNumber: 0,
    confidenceScore: initialConfidence,
    lastError: null,
    errorCount: 0,
    sameErrorCount: 0,
    fileChanges: [],
    testResults: [],
    userInterrupts: [],
    userCorrectionCount: 0,
    noProgressTurns: 0,
    escalations: [],
  };

  const turns: ExecutionTurn[] = [];
  let currentModel = config.model;
  let consecutiveLowConfidenceTurns = 0;

  // Track token usage
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Load MCP tools
  const tools = await getTools();
  log.info(`Loaded ${tools.length} MCP tools for execution`);

  const systemPrompt = await getSystemPromptForAgent(config.agentRole, workspacePath);
  const conversationHistory: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: initialPrompt },
  ];

  while (state.turnNumber < config.maxTurns) {
    state.turnNumber++;

    if (await isAborted(threadId)) {
      log.info(`Execution aborted via lock for thread ${threadId}`);
      await emitExecutionAborted({ threadId, reason: 'user_stop' });
      return { success: false, finalResponse: 'Execution aborted.', turns, finalConfidence: state.confidenceScore };
    }

    // Stream turn start
    await streamProgressToDiscord(threadId, {
      type: 'turn_start',
      turnNumber: state.turnNumber,
      maxTurns: config.maxTurns,
      confidence: state.confidenceScore,
      model: currentModel,
    });

    // Check for interrupts
    const interrupt = await checkForInterrupts(threadId);
    if (interrupt) {
      recordInterrupt(state, interrupt);
      const handled = await handleInterrupt(interrupt, state, conversationHistory);

      if (handled.action === 'stop') {
        log.info(`Execution stopped by user interrupt`);
        await checkpointProgress(threadId, state, turns);
        return { success: false, finalResponse: handled.message, turns, finalConfidence: state.confidenceScore };
      }
    }

    try {
      log.info(`Turn ${state.turnNumber}: Calling model ${currentModel}`);
      const response = await chatCompletion({
        model: currentModel,
        messages: conversationHistory,
        tools: tools,
      });

      if (response.usage) {
        totalInputTokens += response.usage.prompt_tokens || 0;
        totalOutputTokens += response.usage.completion_tokens || 0;
        log.info(`Turn ${state.turnNumber} Usage: ${response.usage.prompt_tokens} in / ${response.usage.completion_tokens} out`);
      }

      const turn = parseTurn(response, state.turnNumber, currentModel, response.usage);
      turn.input = conversationHistory[conversationHistory.length - 1].content;

      // Update persistent score
      state.confidenceScore = calculateConfidence(state, turn);

      if (state.confidenceScore < 30) {
        consecutiveLowConfidenceTurns++;
      } else {
        consecutiveLowConfidenceTurns = 0;
      }

      await updateLockTurn(threadId, state.turnNumber);

      updateExecutionState(state, turn);
      turns.push(turn);

      // FIX: Fix arguments to log and emit functions
      await logTurnToDb({
        threadId,
        turn: turn.turnNumber,
        model: turn.modelUsed,
        agentRole: config.agentRole,
        confidence: turn.confidence,
        status: turn.status === 'complete' ? 'complete' : (turn.status === 'stuck' ? 'stuck' : 'continue'),
        fileChanges: state.fileChanges
      });

      await emitTurnCompleted({
        threadId,
        turn: turn.turnNumber,
        confidence: turn.confidence,
        status: turn.status
      });

      // Stream turn completion with model and token info
      await streamProgressToDiscord(threadId, {
        type: 'turn_complete',
        turnNumber: turn.turnNumber,
        confidence: turn.confidence,
        filesModified: state.fileChanges.length,
        status: turn.status,
        model: turn.modelUsed,
        inputTokens: turn.inputTokens,
        outputTokens: turn.outputTokens,
      });

      // Check for escalation
      const escalation = checkEscalationTriggers(
        state,
        turn,
        currentModel,
        consecutiveLowConfidenceTurns
      );

      if (escalation.shouldEscalate && escalation.suggestedModel) {
        log.warn(`Escalating to ${escalation.suggestedModel}: ${escalation.reason}`);

        const escalationEvent = {
          turnNumber: state.turnNumber,
          fromModel: currentModel,
          toModel: escalation.suggestedModel,
          reason: escalation.reason,
          timestamp: new Date().toISOString(),
        };

        state.escalations.push(escalationEvent);
        const fromModel = currentModel;
        currentModel = escalation.suggestedModel;
        resetEscalationState(state);

        await emitModelEscalated({
          threadId,
          from: fromModel,
          to: currentModel,
          reason: escalation.reason
        });

        // Add escalation message to history
        conversationHistory.push({
          role: 'system',
          content: `ESCALATION: Switching to more capable model ${currentModel} due to: ${escalation.reason}`
        });

        continue;
      }

      // Check if finished
      if (turn.status === 'complete') {
        log.info(`Turn ${state.turnNumber}: Model reported task complete`);
        break;
      }

      if (turn.status === 'needs_clarification') {
        await askUserForClarification(threadId, state, turn.response);
        break;
      }

      // Check if stuck
      if (isStuck(state.confidenceScore, consecutiveLowConfidenceTurns) && isAtMaxEscalation(currentModel)) {
        await askUserForClarification(
          threadId,
          state,
          `Confidence critically low (${state.confidenceScore}%) for ${consecutiveLowConfidenceTurns} turns. Need guidance.`
        );
        break;
      }

      // Add to history for next turn
      conversationHistory.push({ role: 'assistant', content: turn.response });

    } catch (error) {
      log.error(`Error in turn ${state.turnNumber}`, { error: String(error) });
      state.errorCount++;
      state.lastError = String(error);

      if (state.errorCount > 3) {
        throw new Error(`Execution failed after 3 errors: ${error}`);
      }
    }

    if (state.turnNumber % config.checkpointInterval === 0) {
      await checkpointProgress(threadId, state, turns);
    }
  }

  const finalResponse = turns[turns.length - 1]?.response || 'Execution finished but no response generated.';

  // FIX: logExecutionComplete arguments
  await logExecutionComplete({
    threadId,
    totalTurns: state.turnNumber,
    finalStatus: turns[turns.length - 1]?.status || 'unknown',
    success: turns[turns.length - 1]?.status === 'complete'
  });

  await emitExecutionCompleted({
    threadId,
    totalTurns: state.turnNumber,
    finalStatus: turns[turns.length - 1]?.status || 'unknown'
  });

  log.info(`🏁 Loop Complete. Total Token Usage -- Input: ${totalInputTokens} | Output: ${totalOutputTokens} | Combined: ${totalInputTokens + totalOutputTokens}`);

  // Send final summary to Discord with token usage
  await streamProgressToDiscord(threadId, {
    type: 'checkpoint',
    checkpointData: {
      turnNumber: state.turnNumber,
      confidence: state.confidenceScore,
      filesModified: state.fileChanges.length,
      totalTurns: turns.length,
      finalModel: currentModel,
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
    },
  });

  await releaseLock(threadId);

  return { success: true, finalResponse, turns, finalConfidence: state.confidenceScore };
}
