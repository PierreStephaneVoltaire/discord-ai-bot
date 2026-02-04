import { createLogger } from '../../utils/logger';
import { setupSession } from '../session';
import { processAttachments } from '../attachments';
import { createPlan } from '../planning';
import { getModelForAgent } from '../../templates/registry';
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

const log = createLogger('FLOW:ARCHITECTURE');

/**
 * Architecture Flow
 *
 * For theoretical/design tasks that require planning WITHOUT code generation.
 * - Generates clear, succinct architectural plans
 * - Uses sequential thinking for the planning process itself
 * - Confidence based on: completeness, conflicting info, facts captured, holes identified
 * - Can transition to SEQUENTIAL_THINKING when user says "implement this"
 */
export async function executeArchitectureFlow(
    context: FlowContext,
    message: DiscordMessagePayload
): Promise<FlowResult> {
    log.info('Phase: ARCHITECTURE_FLOW');

    // Create thread if not already in one
    let finalThreadId = context.threadId;
    let responseChannelId = context.channelId;

    if (!context.isThread) {
        log.info('Creating thread for architecture discussion');
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

    // Setup session
    const sessionResult = await setupSession(finalThreadId, context.channelId);
    const branchName = sessionResult.branchName;

    // Process attachments
    const processedAttachments = await processAttachments(
        context.history.current_attachments,
        !context.filterContext.is_secondary_bot
    );

    // Evaluate previous trajectory if exists
    let previousEvaluation = null;
    if (sessionResult.session.last_trajectory_summary) {
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

    // Architecture flow: Use the plan content directly as the response
    // No execution loop needed - this is pure planning/design mode
    log.info('Architecture plan generated, no execution loop needed');

    // Evaluate the plan using architecture-specific metrics
    // For architecture flow, we evaluate the quality of the plan itself
    const mockTurns = [{
        turnNumber: 1,
        input: planning.reformulated_prompt,
        toolCalls: [],
        toolResults: [],
        response: planning.plan_content + '\n\n' + planning.instruction_content,
        thinking: planning.plan_content,
        confidence: planning.confidence_assessment.score,
        status: 'complete' as const,
        modelUsed: 'opus-planner',
    }];

    // Architecture-specific evaluation (NO code metrics)
    const evaluation = await trajectoryEvaluator.evaluateArchitectureTrajectory(
        mockTurns,
        planning.reformulated_prompt,
        planning.estimated_turns
    );

    log.info(`Architecture evaluation: score=${evaluation.score}, has_progress=${evaluation.has_progress}`);

    // Build reflection from planning reflection + evaluation
    const reflection: Reflection = {
        timestamp: new Date().toISOString(),
        score: evaluation.score,
        what_worked: planning.reflection?.what_worked || 'N/A',
        what_failed: planning.reflection?.what_failed || 'N/A',
        root_cause: planning.reflection?.root_cause || 'N/A',
        strategy_change: planning.reflection?.strategy_change || 'N/A',
        key_insight: planning.reflection?.key_insight || 'N/A',
    };

    // Update session with reflection and evaluation
    await updateSession(finalThreadId, {
        reflections: addReflectionToHistory(
            sessionResult.session.reflections,
            reflection
        ),
        key_insights: addKeyInsight(
            sessionResult.session.key_insights,
            reflection.key_insight
        ),
        confidence_score: evaluation.score,
        last_trajectory_summary: `Architecture plan for ${planning.topic_slug}: ${planning.plan_content.substring(0, 100)}...`,
    });

    // Stream completion to Discord
    await streamProgressToDiscord(finalThreadId, {
        type: 'reflection',
        checkpointData: {
            score: evaluation.score,
            hasProgress: evaluation.has_progress,
            keyInsight: reflection.key_insight,
        },
    });

    // Construct the final response from the plan
    const finalResponse = `# ${planning.topic_slug}\n\n` +
        `**Task Type:** ${planning.task_type}\n` +
        `**Agent Role:** ${planning.agent_role}\n` +
        `**Complexity:** ${planning.complexity}\n` +
        `**Confidence:** ${evaluation.score}%\n\n` +
        `---\n\n` +
        `${planning.plan_content}\n\n` +
        `---\n\n` +
        `${planning.instruction_content}\n\n` +
        `---\n\n` +
        `*To implement this plan, say "implement this" or ask me to execute a specific part.*`;

    return {
        response: finalResponse,
        model: getModelForAgent(planning.agent_role),
        branchName,
        responseChannelId,
    };
}
