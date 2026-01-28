import type { Reflection } from '../dynamodb/types';
import type { TrajectoryEvaluation } from '../reflexion/types';

const MAX_REFLECTIONS = 5;
const MAX_KEY_INSIGHTS = 20;

/**
 * Add a new reflection to the session's reflection history with sliding window
 */
export function addReflectionToHistory(
    existingReflections: Reflection[] | undefined,
    newReflection: Reflection
): Reflection[] {
    const reflections = existingReflections || [];

    // Add new reflection at the beginning
    const updated = [newReflection, ...reflections];

    // Keep only last MAX_REFLECTIONS
    return updated.slice(0, MAX_REFLECTIONS);
}

/**
 * Add a key insight to the persistent learnings with deduplication
 */
export function addKeyInsight(
    existingInsights: string[] | undefined,
    newInsight: string
): string[] {
    const insights = existingInsights || [];

    // Check if similar insight already exists (simple string match)
    if (insights.some(existing => existing.toLowerCase().includes(newInsight.toLowerCase().slice(0, 20)))) {
        return insights; // Don't add duplicates
    }

    // Add new insight at the beginning
    const updated = [newInsight, ...insights];

    // Keep only MAX_KEY_INSIGHTS
    return updated.slice(0, MAX_KEY_INSIGHTS);
}

/**
 * Format reflections for prompt injection
 */
export function formatReflectionsForPrompt(reflections: Reflection[] | undefined): string {
    if (!reflections || reflections.length === 0) {
        return 'No previous reflections (this is the first attempt).';
    }

    return reflections
        .map((r, idx) => `
### Reflection ${idx + 1} (${r.timestamp})
- **Score**: ${r.score}%
- **What Worked**: ${r.what_worked}
- **What Failed**: ${r.what_failed}
- **Root Cause**: ${r.root_cause}
- **Strategy Change**: ${r.strategy_change}
`)
        .join('\n');
}

/**
 * Format key insights for prompt injection
 */
export function formatKeyInsightsForPrompt(insights: string[] | undefined): string {
    if (!insights || insights.length === 0) {
        return 'No key insights yet.';
    }

    return insights.map((insight, idx) => `${idx + 1}. ${insight}`).join('\n');
}

/**
 * Format evaluation for prompt injection
 */
export function formatEvaluationForPrompt(evaluation: TrajectoryEvaluation | null): Record<string, string> {
    if (!evaluation) {
        return {
            prev_score: 'N/A',
            prev_task_completion: 'N/A',
            prev_code_quality: 'N/A',
            prev_efficiency: 'N/A',
            prev_issues: 'None',
            prev_suggestions: 'None',
        };
    }

    return {
        prev_score: evaluation.score.toString(),
        prev_task_completion: evaluation.task_completion.toString(),
        prev_code_quality: evaluation.code_quality.toString(),
        prev_efficiency: evaluation.efficiency.toString(),
        prev_issues: evaluation.issues.length > 0 ? evaluation.issues.join(', ') : 'None',
        prev_suggestions: evaluation.suggestions.length > 0 ? evaluation.suggestions.join(', ') : 'None',
    };
}
