import { createLogger } from '../../utils/logger';
import type { ExecutionTurn } from '../litellm/types';
import type { TrajectoryEvaluation, TrajectorySummary } from './types';

const log = createLogger('REFLEXION:EVALUATOR');

/**
 * Evaluates a trajectory (sequence of execution turns) and assigns a score
 * based on task completion, code quality, errors, and efficiency.
 */
export class TrajectoryEvaluator {
    /**
     * Generate a summary of the trajectory
     */
    summarizeTrajectory(turns: ExecutionTurn[]): TrajectorySummary {
        const toolsUsed = new Set<string>();
        const filesModified = new Set<string>();
        let errorsEncountered = 0;

        for (const turn of turns) {
            // Collect tools used
            if (turn.toolCalls) {
                for (const tool of turn.toolCalls) {
                    toolsUsed.add(tool.function.name);
                }
            }

            // Track errors (look for 'error' in tool results or stuck status)
            if (turn.status === 'stuck') {
                errorsEncountered++;
            }

            // Check tool results for errors
            if (turn.toolResults) {
                for (const result of turn.toolResults) {
                    if (result.result && typeof result.result === 'object' && 'error' in result.result) {
                        errorsEncountered++;
                    }
                }
            }

            // Track file modifications (simple heuristic: look for file patterns in response)
            const fileMatches = turn.response?.match(/<<([^>]+)>>/g);
            if (fileMatches) {
                fileMatches.forEach((match: string) => {
                    const filename = match.replace(/<<|>>/g, '');
                    filesModified.add(filename);
                });
            }
        }

        const lastTurn = turns[turns.length - 1];
        const completionStatus =
            lastTurn?.status === 'complete' ? 'complete' :
                lastTurn?.status === 'stuck' ? 'failed' :
                    'incomplete';

        return {
            total_turns: turns.length,
            tools_used: Array.from(toolsUsed),
            files_modified: Array.from(filesModified),
            errors_encountered: errorsEncountered,
            completion_status: completionStatus,
        };
    }

    /**
     * Evaluate the trajectory and assign scores
     */
    async evaluateTrajectory(
        turns: ExecutionTurn[],
        originalTask: string,
        maxTurns: number
    ): Promise<TrajectoryEvaluation> {
        log.info(`Evaluating trajectory with ${turns.length} turns`);

        const summary = this.summarizeTrajectory(turns);

        // 1. Task Completion Score (0-100)
        const taskCompletion = this.scoreTaskCompletion(summary, turns);

        // 2. Code Quality Score (0-100)
        const codeQuality = this.scoreCodeQuality(summary, turns);

        // 3. Efficiency Score (0-100)
        const efficiency = this.scoreEfficiency(summary.total_turns, maxTurns, summary.errors_encountered);

        // 4. Overall confidence score (weighted average)
        const score = Math.round(
            taskCompletion * 0.5 +
            codeQuality * 0.3 +
            efficiency * 0.2
        );

        // 5. Identify issues and suggestions
        const { issues, suggestions } = this.generateFeedback(summary, turns, score);

        // 6. Determine if progress was made
        const has_progress = score > 40 && summary.completion_status !== 'failed';

        log.info(`Evaluation complete: score=${score}, progress=${has_progress}`);

        return {
            score: Math.max(10, Math.min(100, score)), // Clamp 10-100
            reasoning: this.generateReasoning(taskCompletion, codeQuality, efficiency, summary),
            has_progress,
            issues,
            suggestions,
            task_completion: taskCompletion,
            code_quality: codeQuality,
            efficiency,
        };
    }

    /**
     * Evaluate architecture/design trajectory (NO code metrics)
     * Focuses on: completeness, clarity, conflicting info, facts captured, holes identified
     */
    async evaluateArchitectureTrajectory(
        turns: ExecutionTurn[],
        originalTask: string,
        maxTurns: number
    ): Promise<TrajectoryEvaluation> {
        log.info(`Evaluating architecture trajectory with ${turns.length} turns`);

        const summary = this.summarizeTrajectory(turns);

        // 1. Task Completion Score (0-100) - Did we answer the design question?
        const taskCompletion = this.scoreArchitectureCompletion(summary, turns);

        // 2. Design Quality Score (0-100) - Clarity, coherence, no contradictions
        const designQuality = this.scoreDesignQuality(turns);

        // 3. Efficiency Score (0-100) - Conciseness of the discussion
        const efficiency = this.scoreArchitectureEfficiency(summary.total_turns, maxTurns);

        // 4. Overall confidence score (weighted average)
        const score = Math.round(
            taskCompletion * 0.5 +
            designQuality * 0.35 +
            efficiency * 0.15
        );

        // 5. Identify issues and suggestions
        const { issues, suggestions } = this.generateArchitectureFeedback(turns, score);

        // 6. Determine if progress was made
        const has_progress = score > 40 && summary.completion_status !== 'failed';

        log.info(`Architecture evaluation complete: score=${score}, progress=${has_progress}`);

        return {
            score: Math.max(10, Math.min(100, score)), // Clamp 10-100
            reasoning: this.generateArchitectureReasoning(taskCompletion, designQuality, efficiency, turns),
            has_progress,
            issues,
            suggestions,
            task_completion: taskCompletion,
            code_quality: designQuality, // Reuse field for design quality
            efficiency,
        };
    }

    private scoreTaskCompletion(summary: TrajectorySummary, turns: ExecutionTurn[]): number {
        // Base score on completion status
        if (summary.completion_status === 'complete') {
            return 100;
        } else if (summary.completion_status === 'failed') {
            return 20;
        }

        // Partial completion: check if files were modified or tools used
        const hasOutput = summary.files_modified.length > 0 || summary.tools_used.length > 0;
        return hasOutput ? 60 : 30;
    }

    private scoreCodeQuality(summary: TrajectorySummary, turns: ExecutionTurn[]): number {
        // Heuristic: fewer errors = higher quality
        const errorRate = summary.total_turns > 0
            ? summary.errors_encountered / summary.total_turns
            : 0;

        if (errorRate === 0) return 100;
        if (errorRate < 0.2) return 80;
        if (errorRate < 0.4) return 60;
        return 40;
    }

    private scoreEfficiency(totalTurns: number, maxTurns: number, errors: number): number {
        // Penalize for using too many turns or having errors
        const turnRatio = totalTurns / maxTurns;
        let efficiencyScore = 100 - (turnRatio * 50);

        // Deduct for errors
        efficiencyScore -= errors * 10;

        return Math.max(20, Math.min(100, efficiencyScore));
    }

    private scoreArchitectureCompletion(summary: TrajectorySummary, turns: ExecutionTurn[]): number {
        // Base score on completion status
        if (summary.completion_status === 'complete') {
            return 100;
        } else if (summary.completion_status === 'failed') {
            return 20;
        }

        // Check if the last turn provides a clear conclusion or plan
        const lastTurn = turns[turns.length - 1];
        const hasConclusion = lastTurn?.response?.toLowerCase().includes('conclusion') ||
                              lastTurn?.response?.toLowerCase().includes('summary') ||
                              lastTurn?.response?.toLowerCase().includes('plan') ||
                              lastTurn?.response?.toLowerCase().includes('recommendation');

        return hasConclusion ? 75 : 50;
    }

    private scoreDesignQuality(turns: ExecutionTurn[]): number {
        // Check for indicators of good architectural thinking
        const allResponses = turns.map(t => t.response?.toLowerCase() || '').join(' ');

        let score = 70; // Base score

        // Positive indicators
        if (allResponses.includes('trade-off')) score += 5;
        if (allResponses.includes('alternative')) score += 5;
        if (allResponses.includes('consideration')) score += 5;
        if (allResponses.includes('constraint')) score += 5;
        if (allResponses.includes('assumption')) score += 5;

        // Negative indicators (potential issues)
        if (allResponses.includes('confusing')) score -= 10;
        if (allResponses.includes('unclear')) score -= 10;
        if (allResponses.includes('contradiction')) score -= 15;

        return Math.max(20, Math.min(100, score));
    }

    private scoreArchitectureEfficiency(totalTurns: number, maxTurns: number): number {
        // Architecture discussions should be concise
        const turnRatio = totalTurns / maxTurns;

        // Ideal: 3-8 turns for architecture discussion
        if (totalTurns <= 3) return 90; // Very efficient
        if (totalTurns <= 8) return 100; // Optimal
        if (totalTurns <= 12) return 80;
        if (totalTurns <= 15) return 60;
        return 40; // Too long
    }

    private generateFeedback(
        summary: TrajectorySummary,
        turns: ExecutionTurn[],
        score: number
    ): { issues: string[]; suggestions: string[] } {
        const issues: string[] = [];
        const suggestions: string[] = [];

        if (summary.completion_status === 'failed') {
            issues.push('Task execution failed');
            suggestions.push('Review error messages and adjust approach');
        }

        if (summary.errors_encountered > 0) {
            issues.push(`Encountered ${summary.errors_encountered} errors during execution`);
            suggestions.push('Debug errors before proceeding further');
        }

        if (summary.total_turns > 10) {
            issues.push('High turn count indicates potential inefficiency');
            suggestions.push('Consider breaking down the task or using different tools');
        }

        if (summary.files_modified.length === 0 && summary.tools_used.length === 0) {
            issues.push('No tangible output produced');
            suggestions.push('Ensure the task requires concrete actions');
        }

        if (score < 50) {
            suggestions.push('Consider escalating to a more capable model');
        }

        return { issues, suggestions };
    }

    private generateArchitectureFeedback(
        turns: ExecutionTurn[],
        score: number
    ): { issues: string[]; suggestions: string[] } {
        const issues: string[] = [];
        const suggestions: string[] = [];
        const allResponses = turns.map(t => t.response?.toLowerCase() || '').join(' ');

        if (turns.length > 12) {
            issues.push('Architecture discussion is lengthy');
            suggestions.push('Consider being more concise in architectural explanations');
        }

        if (!allResponses.includes('trade-off') && !allResponses.includes('alternative')) {
            suggestions.push('Consider discussing trade-offs and alternatives');
        }

        if (!allResponses.includes('constraint')) {
            suggestions.push('Consider explicitly stating constraints and assumptions');
        }

        if (score < 50) {
            suggestions.push('Consider breaking down the architectural question into smaller parts');
        }

        return { issues, suggestions };
    }

    private generateReasoning(
        taskCompletion: number,
        codeQuality: number,
        efficiency: number,
        summary: TrajectorySummary
    ): string {
        return `Task completion: ${taskCompletion}%, Code quality: ${codeQuality}%, Efficiency: ${efficiency}%. ` +
            `Status: ${summary.completion_status}. ` +
            `Used ${summary.tools_used.length} tools across ${summary.total_turns} turns with ${summary.errors_encountered} errors.`;
    }

    private generateArchitectureReasoning(
        taskCompletion: number,
        designQuality: number,
        efficiency: number,
        turns: ExecutionTurn[]
    ): string {
        return `Task completion: ${taskCompletion}%, Design quality: ${designQuality}%, Efficiency: ${efficiency}%. ` +
            `Discussion spanned ${turns.length} turns focusing on architectural design.`;
    }
}

export const trajectoryEvaluator = new TrajectoryEvaluator();
