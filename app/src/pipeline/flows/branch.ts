import { createLogger } from '../../utils/logger';
import { MODEL_TIERS } from '../../modules/agentic/escalation';
import { chatCompletion, extractContent } from '../../modules/litellm/index';
import { createPlan } from '../planning';
import { setupSession } from '../session';
import type { FlowContext, FlowResult } from './types';

const log = createLogger('FLOW:BRANCH');

function getBranchModels(tier: 'tier3' | 'tier4') {
    const models = MODEL_TIERS[tier];
    const len = models.length;

    return {
        model1: models[len - 2],    // One before the last
        model2: models[len - 1],    // The last one
        consolidator: models[len - 1], // Same as model2 (the strongest)
    };
}

export async function executeBranchFlow(
    context: FlowContext
): Promise<FlowResult> {
    log.info('Phase: BRANCH_FLOW');

    // Determine tier based on message content
    const lower = context.history.current_message.toLowerCase();
    const isDeep = lower.includes('think deeply') || lower.includes('thoroughly');
    const tier = isDeep ? 'tier4' : 'tier3';

    const { model1, model2, consolidator } = getBranchModels(tier);
    log.info(`Using models: ${model1}, ${model2} for brainstorming; ${consolidator} for consolidation`);

    // 1. Planning with Opus (theory/suggestions only)
    const sessionResult = await setupSession(context.threadId, context.channelId);
    const planning = await createPlan({
        threadId: context.threadId,
        branchName: sessionResult.branchName,
        session: sessionResult.session,
        history: context.history,
        processedAttachments: [],
        userAddedFilesMessage: context.userAddedFilesMessage,
        previousConfidence: sessionResult.session.confidence_score,
    });

    const brainstormingPrompt = `
You are an expert architect and technical strategist exploring multiple solutions to a problem.

## Objective
${planning.reformulated_prompt}

## Your Task
Suggest 2-3 **distinct architectural approaches** to achieve this goal.

## CRITICAL RULES
- **NO CODE**: Do not write any code, code blocks, or implementation snippets.
- **THEORY ONLY**: Focus exclusively on theory, architecture, strategy, and high-level design.
- **Think Step-by-Step**: Explain your reasoning for why each approach works.

## Format for Each Approach
1. **Title**: Clear name for the approach
2. **Overview**: 2-3 sentence description
3. **Rationale**: Why this approach makes sense (step-by-step reasoning)
4. **Architecture**: High-level components and how they interact (describe, don't diagram)
5. **Pros**: 3-5 bullet points
6. **Cons**: 3-5 bullet points
7. **Best For**: When this approach is the right choice

Keep each approach concise but thorough. Focus on the "what" and "why", not the "how to code it".
`;

    // 2. Parallel brainstorming
    log.info('Calling brainstorming models in parallel');
    const [response1, response2] = await Promise.all([
        chatCompletion({
            model: model1,
            messages: [{ role: 'user', content: brainstormingPrompt }],
        }),
        chatCompletion({
            model: model2,
            messages: [{ role: 'user', content: brainstormingPrompt }],
        }),
    ]);

    const content1 = extractContent(response1);
    const content2 = extractContent(response2);

    // 3. Consolidation
    log.info('Consolidating approaches');
    const consolidationPrompt = `
You are a lead architect consolidating brainstorming from two expert advisors.

## Original User Question
"${context.history.current_message}"

## Expert A's Suggestions
${content1}

## Expert B's Suggestions
${content2}

## Your Task
1. **Identify Unique Approaches**: Find all distinct architectural approaches from both experts.
2. **Merge Similar Ones**: If both suggest similar approaches, combine into one with the best elements.
3. **Summarize Each**: For each unique approach, provide a concise summary.
4. **Recommend**: Suggest which approach best fits different scenarios.
5. **Ask User**: End by asking which approach interests them most.

## Format Requirements
- **NO CODE**: This is purely theoretical/architectural discussion.
- Use bullet points (max 7 per approach).
- Be concise but complete.
- Explain reasoning step-by-step where helpful.
- End with: "Which approach would you like to explore further?"
`;

    const finalResponse = await chatCompletion({
        model: consolidator,
        messages: [{ role: 'user', content: consolidationPrompt }],
    });

    const finalContent = extractContent(finalResponse);

    return {
        response: finalContent,
        model: consolidator,
        responseChannelId: context.channelId,
    };
}
