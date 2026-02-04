import { createLogger } from '../../utils/logger';
import { MODEL_TIERS } from '../../modules/agentic/escalation';
import { chatCompletion, extractContent } from '../../modules/litellm/index';
import { createPlan } from '../planning';
import { setupSession } from '../session';
import { streamProgressToDiscord } from '../../modules/agentic/progress';
import { getDiscordClient } from '../../modules/discord/index';
import { createPoll, waitForPollVote, PollOption, type PollResult } from '../../modules/discord/api';
import { updateSession, updateSessionConfidence, getSession } from '../../modules/dynamodb/sessions';
import type { FlowContext, FlowResult } from './types';
import type { PollHistoryEntry } from '../../modules/dynamodb/types';

const log = createLogger('FLOW:BRANCH');

/**
 * Select 3 random tier3 models for brainstorming
 */
function getRandomTier3Models(): string[] {
    const tier3Models = [...MODEL_TIERS.tier3];
    // Shuffle array
    for (let i = tier3Models.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tier3Models[i], tier3Models[j]] = [tier3Models[j], tier3Models[i]];
    }
    // Return first 3 (or all if less than 3)
    return tier3Models.slice(0, 3);
}

/**
 * Select 1 random tier4 model for aggregation
 */
function getRandomTier4Model(): string {
    const tier4Models = MODEL_TIERS.tier4;
    const randomIndex = Math.floor(Math.random() * tier4Models.length);
    return tier4Models[randomIndex];
}

interface AggregatorOutput {
    question: string;
    options: PollOption[];
}

/**
 * Parse aggregator output to extract poll options
 */
function parseAggregatorOutput(content: string): AggregatorOutput | null {
    try {
        // Try to find JSON in the response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.question && Array.isArray(parsed.options) && parsed.options.length === 3) {
                return {
                    question: parsed.question,
                    options: parsed.options.map((opt: any) => ({
                        id: opt.id,
                        label: opt.label,
                        description: opt.description,
                    })),
                };
            }
        }
        log.error('Failed to parse aggregator output - invalid format');
        return null;
    } catch (error) {
        log.error(`Failed to parse aggregator output: ${error}`);
        return null;
    }
}

export async function executeBranchFlow(
    context: FlowContext
): Promise<FlowResult> {
    log.info('Phase: BRANCH_FLOW');

    // 1. Select 3 random tier3 models and 1 random tier4 aggregator
    const branchModels = getRandomTier3Models();
    const aggregatorModel = getRandomTier4Model();
    
    log.info(`Using tier3 models: ${branchModels.join(', ')}`);
    log.info(`Using tier4 aggregator: ${aggregatorModel}`);

    // 2. Planning with Opus (theory/suggestions only)
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
Suggest **3 distinct architectural approaches** to achieve this goal.

## CRITICAL RULES
- **NO CODE**: Do not write any code, code blocks, or implementation snippets.
- **THEORY ONLY**: Focus exclusively on theory, architecture, strategy, and high-level design.
- **Think Step-by-Step**: Explain your reasoning for why each approach works.
- **Be Distinct**: Each approach should be fundamentally different from the others.

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

    // 3. Parallel brainstorming with 3 models
    log.info('Calling 3 brainstorming models in parallel');

    // Show progress for all 3 models
    await Promise.all([
        streamProgressToDiscord(context.threadId, {
            type: 'branching',
            branchingPhase: 'model1',
            model: branchModels[0]
        }),
        streamProgressToDiscord(context.threadId, {
            type: 'branching',
            branchingPhase: 'model2',
            model: branchModels[1]
        }),
        streamProgressToDiscord(context.threadId, {
            type: 'branching',
            branchingPhase: 'model3',
            model: branchModels[2]
        }),
    ]);

    const [response1, response2, response3] = await Promise.all([
        chatCompletion({
            model: branchModels[0],
            messages: [{ role: 'user', content: brainstormingPrompt }],
        }),
        chatCompletion({
            model: branchModels[1],
            messages: [{ role: 'user', content: brainstormingPrompt }],
        }),
        chatCompletion({
            model: branchModels[2],
            messages: [{ role: 'user', content: brainstormingPrompt }],
        }),
    ]);

    const content1 = extractContent(response1);
    const content2 = extractContent(response2);
    const content3 = extractContent(response3);

    // 4. Aggregation with tier4 model
    log.info('Aggregating approaches with tier4 model');

    await streamProgressToDiscord(context.threadId, {
        type: 'branching',
        branchingPhase: 'consolidator',
        model: aggregatorModel
    });

    // Load the aggregator prompt template
    const fs = await import('fs');
    const path = await import('path');
    const aggregatorPromptTemplate = fs.readFileSync(
        path.join(process.cwd(), 'app/templates/prompts/branch-aggregator.txt'),
        'utf-8'
    );

    const aggregatorPrompt = `${aggregatorPromptTemplate}

## Input Approaches

### Model 1 (${branchModels[0]}) Approaches:
${content1}

### Model 2 (${branchModels[1]}) Approaches:
${content2}

### Model 3 (${branchModels[2]}) Approaches:
${content3}

## User's Original Question
"${context.history.current_message}"

Analyze these 9 approaches and produce your JSON output now.`;

    const aggregatorResponse = await chatCompletion({
        model: aggregatorModel,
        messages: [{ role: 'user', content: aggregatorPrompt }],
    });

    const aggregatorContent = extractContent(aggregatorResponse);
    const pollData = parseAggregatorOutput(aggregatorContent);

    if (!pollData) {
        log.error('Failed to create poll from aggregator output');
        // Fallback: return the aggregator's text response
        return {
            response: aggregatorContent,
            model: aggregatorModel,
            responseChannelId: context.channelId,
        };
    }

    // 5. Create Discord poll with "Other" option
    log.info('Creating Discord poll');

    const pollOptions: PollOption[] = [
        ...pollData.options,
        { id: 'D', label: 'Other', description: 'None of the above - I have a different approach in mind' }
    ];

    const client = getDiscordClient();
    const pollMessageId = await createPoll(client, context.channelId, {
        question: pollData.question,
        options: pollOptions,
        duration: 1, // 1 hour (but we'll end on first vote)
    });

    // 6. Wait for first vote
    log.info('Waiting for poll vote');
    
    await streamProgressToDiscord(context.threadId, {
        type: 'branching',
        branchingPhase: 'waiting_for_vote',
        model: 'poll'
    });

    let pollResult = await waitForPollVote(
        client,
        context.channelId,
        pollMessageId,
        pollOptions.length,
        300000 // 5 minute timeout
    );

    if (!pollResult) {
        log.info('Poll timed out, using default option A');
        // Timeout - default to option A
        pollResult = {
            messageId: pollMessageId,
            selectedOptionId: 'A',
            selectedBy: { id: 'timeout', username: 'System (timeout)' }
        };
    }

    // 7. Handle "Other" option
    if (pollResult.selectedOptionId === 'D') {
        log.info('User selected "Other", lowering confidence and asking for clarification');
        
        // Lower confidence by 10
        await updateSessionConfidence(context.threadId, -10);

        // Save poll entry to session
        const pollEntry: PollHistoryEntry = {
            question: pollData.question,
            options: pollOptions,
            selectedOption: 'D (Other)',
            selectedBy: pollResult.selectedBy.username,
            timestamp: new Date().toISOString()
        };

        const session = await getSession(context.threadId);
        if (session) {
            await updateSession(context.threadId, {
                poll_entries: [...(session.poll_entries || []), pollEntry]
            });
        }

        return {
            response: `You selected "Other". What approach would you like to explore?`,
            model: 'branch-aggregator',
            responseChannelId: context.channelId,
        };
    }

    // 8. Get selected option details
    const selectedOption = pollOptions.find(o => o.id === pollResult.selectedOptionId);
    
    // 9. Save poll entry to session history
    const pollEntry: PollHistoryEntry = {
        question: pollData.question,
        options: pollOptions.slice(0, 3), // Don't include "Other" in history
        selectedOption: pollResult.selectedOptionId,
        selectedBy: pollResult.selectedBy.username,
        timestamp: new Date().toISOString()
    };

    const session = await getSession(context.threadId);
    if (session) {
        await updateSession(context.threadId, {
            poll_entries: [...(session.poll_entries || []), pollEntry]
        });
    }

    // 10. Return result with the selection
    // The pipeline will continue and the classification prompt will decide next flow
    log.info(`Poll completed. User ${pollResult.selectedBy.username} selected option ${pollResult.selectedOptionId}`);

    return {
        response: `You selected: **${selectedOption?.label || pollResult.selectedOptionId}**\n\n` +
                  `${selectedOption?.description || ''}\n\n` +
                  `Proceeding with this approach...`,
        model: 'branch-aggregator',
        responseChannelId: context.channelId,
    };
}
