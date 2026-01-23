import {
  AgenticExecutionConfig,
  ExecutionState,
  ExecutionTurn,
  Message,
  ToolCall,
  AgentRole,
} from '../litellm/types';
import { chatCompletion, getTools, executeToolCall } from '../litellm/index';
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

const log = createLogger('AGENTIC:LOOP');

async function getSystemPromptForAgent(agentRole: AgentRole): Promise<string> {
  const templateName = getTemplateForAgent(agentRole);
  try {
    return loadPrompt(templateName);
  } catch (error) {
    log.warn(`Template ${templateName} not found, falling back to 'coding'`);
    return loadPrompt('coding');
  }
}

function parseTurn(
  response: any,
  turnNumber: number,
  model: string
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
    thinking: content, // For Phase 1, thinking is same as response
    confidence,
    status,
    modelUsed: model,
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
  ];
  
  let hasFileChange = false;
  for (const pattern of fileChangePatterns) {
    if (pattern.test(turn.response)) {
      hasFileChange = true;
      break;
    }
  }

  if (hasFileChange) {
    state.noProgressTurns = 0;
    // Extract file names if possible
    const fileMatch = turn.response.match(/(?:wrote|created|modified|updated)\s+([^\s]+)/i);
    if (fileMatch && !state.fileChanges.includes(fileMatch[1])) {
      state.fileChanges.push(fileMatch[1]);
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
  
  // TODO: Send actual Discord message with reaction options
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
  // TODO: Phase 2 - Save checkpoint to DynamoDB or Discord
}

export async function executeAgenticLoop(
  config: AgenticExecutionConfig,
  initialPrompt: string,
  threadId: string
): Promise<{ success: boolean; finalResponse: string; turns: ExecutionTurn[] }> {
  log.info(`Starting agentic loop for thread ${threadId} with agent ${config.agentRole}`);

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
    confidenceScore: 80,
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

  // Load MCP tools
  const tools = await getTools();
  log.info(`Loaded ${tools.length} MCP tools for agentic execution`);

  const systemPrompt = await getSystemPromptForAgent(config.agentRole);
  const conversationHistory: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: initialPrompt },
  ];

  while (state.turnNumber < config.maxTurns) {
    state.turnNumber++;

    // Stream turn start
    await streamProgressToDiscord(threadId, {
      type: 'turn_start',
      turnNumber: state.turnNumber,
      maxTurns: config.maxTurns,
      confidence: state.confidenceScore,
      model: config.model,
    });

    // Check for interrupts
    const interrupt = await checkForInterrupts(threadId);
    if (interrupt) {
      recordInterrupt(state, interrupt);
      const handled = await handleInterrupt(interrupt, state, conversationHistory);
      
      if (handled.action === 'stop') {
        log.info(`Execution stopped by user interrupt`);
        await checkpointProgress(threadId, state, turns);
        return { success: false, finalResponse: handled.message, turns };
      } else if (handled.action === 'clarify') {
        conversationHistory.push({ role: 'user', content: handled.message });
        continue;
      } else if (handled.action === 'retry') {
        log.info('Retrying last turn');
        continue;
      }
      // 'continue' action falls through to normal execution
    }

    // Execute turn
    try {
      const response = await chatCompletion({
        model: currentModel,
        messages: conversationHistory,
        tools,
        tool_choice: 'auto',
      });

      const turn = parseTurn(response, state.turnNumber, currentModel);
      
      // Execute tool calls if present
      if (turn.toolCalls.length > 0) {
        for (const toolCall of turn.toolCalls) {
          await streamProgressToDiscord(threadId, {
            type: 'tool_execution',
            tool: toolCall.function.name,
            args: toolCall.function.arguments,
          });

          try {
            // Execute the tool via MCP
            log.info(`Executing MCP tool: ${toolCall.function.name}`);
            const toolResult = await executeToolCall(toolCall);
            
            turn.toolResults.push({
              tool: toolCall.function.name,
              result: toolResult,
            });
            
            log.info(`Tool ${toolCall.function.name} executed successfully`);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`Tool execution failed: ${toolCall.function.name}`, { error: errorMessage });
            
            turn.toolResults.push({
              tool: toolCall.function.name,
              result: { 
                error: errorMessage,
                success: false 
              },
            });
          }
        }
      }

      turns.push(turn);

      // Update conversation history with assistant message
      conversationHistory.push({
        role: 'assistant',
        content: turn.response,
      });

      // Add tool results to conversation if any
      if (turn.toolResults.length > 0) {
        conversationHistory.push({
          role: 'user',
          content: `Tool results: ${JSON.stringify(turn.toolResults)}`,
        });
      }

      // Update state
      updateExecutionState(state, turn);

      // Calculate confidence
      state.confidenceScore = calculateConfidence(state, turn);

      // Track consecutive low confidence turns
      if (state.confidenceScore < 30) {
        consecutiveLowConfidenceTurns++;
      } else {
        consecutiveLowConfidenceTurns = 0;
      }

      // Stream turn complete
      await streamProgressToDiscord(threadId, {
        type: 'turn_complete',
        turnNumber: state.turnNumber,
        confidence: state.confidenceScore,
        filesModified: state.fileChanges.length,
        status: turn.status,
      });

      // Check for completion
      if (turn.status === 'complete') {
        log.info(`Agentic loop completed successfully at turn ${state.turnNumber}`);
        return { success: true, finalResponse: turn.response, turns };
      }

      // Check for escalation triggers
      const escalationCheck = checkEscalationTriggers(
        state,
        turn,
        currentModel,
        consecutiveLowConfidenceTurns
      );

      if (escalationCheck.shouldEscalate) {
        if (isAtMaxEscalation(currentModel)) {
          // Already at Opus, ask user for help
          log.error(`At max escalation (Opus) but still stuck: ${escalationCheck.reason}`);
          await askUserForClarification(
            threadId,
            state,
            `At maximum model capability but still struggling: ${escalationCheck.reason}`
          );
          // Continue anyway, user might provide guidance
        } else {
          // Escalate to next model
          const previousModel = currentModel;
          currentModel = escalationCheck.suggestedModel!;
          
          log.warn(`Escalating from ${previousModel} to ${currentModel}: ${escalationCheck.reason}`);
          
          // Record escalation event
          state.escalations.push({
            turnNumber: state.turnNumber,
            fromModel: previousModel,
            toModel: currentModel,
            reason: escalationCheck.reason,
            timestamp: new Date().toISOString(),
          });
          
          await streamProgressToDiscord(threadId, {
            type: 'escalation',
            model: previousModel,
            newModel: currentModel,
            escalationReason: escalationCheck.reason,
            turnNumber: state.turnNumber,
          });

          // Reset escalation-related state after escalation
          resetEscalationState(state);
          consecutiveLowConfidenceTurns = 0;
        }
      }

      // Check if genuinely stuck (low confidence, no escalation possible)
      if (isStuck(state.confidenceScore, consecutiveLowConfidenceTurns) && isAtMaxEscalation(currentModel)) {
        log.error(`Agent is stuck at turn ${state.turnNumber} with Opus model`);
        await askUserForClarification(
          threadId,
          state,
          `Confidence critically low (${state.confidenceScore}%) for ${consecutiveLowConfidenceTurns} turns. Need guidance.`
        );
      }

      // Checkpoint every N turns
      if (state.turnNumber % config.checkpointInterval === 0) {
        await checkpointProgress(threadId, state, turns);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Error in turn ${state.turnNumber}: ${errorMessage}`);
      
      state.errorCount++;
      
      // Check if this is the same error as before
      if (state.lastError === errorMessage) {
        state.sameErrorCount++;
      } else {
        state.lastError = errorMessage;
        state.sameErrorCount = 1;
      }
      
      // Add error to conversation for model to see
      conversationHistory.push({
        role: 'user',
        content: `An error occurred: ${errorMessage}. Please try a different approach.`,
      });
      
      // Stream error to Discord
      await streamProgressToDiscord(threadId, {
        type: 'turn_complete',
        turnNumber: state.turnNumber,
        confidence: state.confidenceScore,
        filesModified: state.fileChanges.length,
        status: 'error',
      });
    }
  }

  // Max turns reached
  log.warn(`Max turns (${config.maxTurns}) reached without completion`);
  return {
    success: false,
    finalResponse: `Max turns reached without completion. Completed ${state.fileChanges.length} file changes.`,
    turns,
  };
}
