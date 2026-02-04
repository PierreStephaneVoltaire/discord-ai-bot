import { createLogger } from '../../utils/logger';
import { setupSession, updateSessionAfterExecution } from '../session';
import { processAttachments } from '../attachments';
import { createPlan } from '../planning';
import { executeSequentialThinkingLoop } from '../../modules/agentic/loop';
import { getMaxTurns, getCheckpointInterval, getModelForAgent } from '../../templates/registry';
import { generateThreadName } from '../../modules/litellm/opus';
import { getDiscordClient, createThread } from '../../modules/discord/index';
import { getChatClient } from '../../modules/chat';
import { trajectoryEvaluator } from '../../modules/reflexion/evaluator';
import { streamProgressToDiscord } from '../../modules/agentic/progress';
import { addReflectionToHistory, addKeyInsight } from '../../modules/reflexion/memory';
import { updateSession } from '../../modules/dynamodb/sessions';
import type { Reflection } from '../../modules/dynamodb/types';
import type { FlowContext, FlowResult } from './types';
import type { DiscordMessagePayload } from '../../modules/discord/types';

const log = createLogger('FLOW:SEQUENTIAL');

export async function executeSequentialThinkingFlow(
    context: FlowContext,
    message: DiscordMessagePayload
): Promise<FlowResult> {
    log.info('Phase: SEQUENTIAL_THINKING_FLOW');

    // Create thread if not already in one
    let finalThreadId = context.threadId;
    let responseChannelId = context.channelId;

    if (!context.isThread) {
        log.info('Creating thread for execution');
        const threadName = await generateThreadName(context.history.current_message);
  const chatClient = getChatClient();
        if (chatClient && chatClient.platform !== 'discord') {
            const newThread = await chatClient.createThread(
                message.channel_id,
                message.id,
                threadName
            );
            finalThreadId = newThread.id;
            responseChannelId = newThread.id;
        } else {
            const client = getDiscordClient();
            const newThread = await createThread(
                client,
                message.channel_id,
                message.id,
                threadName
            );
            finalThreadId = newThread.id;
            responseChannelId = newThread.id;
        }
    }

    // Setup session (this gets or creates the session in DynamoDB)
    const sessionResult = await setupSession(finalThreadId, context.channelId);
    const branchName = sessionResult.branchName;
    const workspacePath = `/workspace/${finalThreadId}`;

    // Process attachments
    const processedAttachments = await processAttachments(
        context.history.current_attachments,
        !context.filterContext.is_secondary_bot
    );

    // Evaluate previous trajectory if exists (for Reflexion)
    let previousEvaluation = null;
    if (sessionResult.session.last_trajectory_summary) {
        // Future: could re-evaluate stored trajectory, for now just pass null
        log.info('Previous trajectory exists (no re-evaluation implemented yet)');
    }

    // Generate plan (with Reflexion context)
    const planning = await createPlan({
        threadId: finalThreadId,
        branchName: sessionResult.branchName,
        session: sessionResult.session,
        history: context.history,
        processedAttachments,
        userAddedFilesMessage: context.userAddedFilesMessage,
        previousConfidence: sessionResult.session.confidence_score,
        previousEvaluation,
    });

    // Execute sequential thinking loop
    const maxTurns = getMaxTurns(
        planning.complexity,
        planning.estimated_turns
    );

    const loopResult = await executeSequentialThinkingLoop(
        {
            maxTurns,
            currentTurn: 0,
            model: getModelForAgent(planning.agent_role),
            agentRole: planning.agent_role,
            tools: [], // Tools loaded inside loop
            checkpointInterval: getCheckpointInterval(planning.complexity),
        },
        planning.reformulated_prompt,
        finalThreadId,
        sessionResult.session.confidence_score,
        workspacePath
    );

    // Evaluate the trajectory using Reflexion
    log.info('Evaluating execution trajectory');

    // Sync workspace to S3 before reflection
    try {
        const { s3Sync } = await import('../../modules/workspace/s3-sync');
        await s3Sync.syncToS3(finalThreadId);
    } catch (e) {
        log.warn(`S3 sync before reflection failed: ${e}`);
    }

    // Show reflection progress in Discord
    await streamProgressToDiscord(context.threadId, {
        type: 'reflection',
        confidence: loopResult.finalConfidence,
        model: loopResult.turns[loopResult.turns.length - 1]?.modelUsed || 'unknown'
    });

    const evaluation = await trajectoryEvaluator.evaluateTrajectory(
        loopResult.turns,
        context.history.current_message,
        maxTurns
    );

    log.info(`Trajectory evaluation: score=${evaluation.score}, progress=${evaluation.has_progress}`);

    // Create reflection from Opus output
    const reflection: Reflection = {
        timestamp: new Date().toISOString(),
        score: evaluation.score,
        what_worked: planning.reflection?.what_worked || 'N/A',
        what_failed: planning.reflection?.what_failed || 'N/A',
        root_cause: planning.reflection?.root_cause || 'N/A',
        strategy_change: planning.reflection?.strategy_change || 'N/A',
        key_insight: planning.reflection?.key_insight || 'N/A',
    };

    // Update reflections and key insights with sliding window
    const updatedReflections = addReflectionToHistory(
        sessionResult.session.reflections,
        reflection
    );

    const updatedKeyInsights = reflection.key_insight !== 'N/A'
        ? addKeyInsight(sessionResult.session.key_insights, reflection.key_insight)
        : sessionResult.session.key_insights;

    // Generate trajectory summary for next time
    const trajectorySummary = trajectoryEvaluator.summarizeTrajectory(loopResult.turns);
    const trajectorySummaryText = `Turns: ${trajectorySummary.total_turns}, Tools: ${trajectorySummary.tools_used.join(', ')}, Status: ${trajectorySummary.completion_status}`;

    // Update session with evaluation results and reflections
    const updatedPlanning = {
        ...planning,
        confidence_assessment: {
            ...planning.confidence_assessment,
            score: evaluation.score, // Use evaluator score
        }
    };

    await updateSessionAfterExecution(
        finalThreadId,
        updatedPlanning,
        context.history.current_message,
        message.timestamp,
        sessionResult.session
    );

    // Save Reflexion data to DynamoDB
    await updateSession(finalThreadId, {
        reflections: updatedReflections,
        key_insights: updatedKeyInsights,
        last_trajectory_summary: trajectorySummaryText,
    });

    log.info('Reflexion data saved to session');

    return {
        response: loopResult.finalResponse,
        model: loopResult.turns[loopResult.turns.length - 1]?.modelUsed || 'unknown',
        branchName,
        responseChannelId,
    };
}
