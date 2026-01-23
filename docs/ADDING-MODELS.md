# Adding New Models to the Agentic System

## Overview

The bot supports multiple LLM providers and models. Models are organized into **capability tiers** that determine:
1. Which models are used for which agent roles
2. The escalation path when a model gets stuck

## Quick Start: Adding a New Model

### Step 1: Add to Model Tiers

Edit `app/src/modules/agentic/escalation.ts`:

```typescript
export const MODEL_TIERS = {
  tier1: ['gemini-2.5-flash-lite'],                    // Ultra-fast, lowest cost
  tier2: ['gemini-3-pro', 'gpt-4o-mini'],           // Fast, low cost
  tier3: ['claude-sonnet-4.5', 'gpt-4o', 'claude-3.5'],  // Balanced quality/cost
  tier4: ['claude-opus-4.5', 'o1', 'gpt-4-turbo'],       // Highest quality, expensive
} as const;
```

**That's it!** The escalation ladder is automatically built from this.

### Step 2: (Optional) Assign to Agent Roles

If you want a specific agent to prefer your new model, edit `app/src/templates/registry.ts`:

```typescript
export const AGENT_MODEL_TIER_MAP: Record<AgentRole, keyof typeof MODEL_TIERS> = {
  [AgentRole.PYTHON_CODER]: 'tier2',  // Will use tier2 models
  // ...
};

// Fine-tune which model in the tier to use
export const AGENT_MODEL_INDEX_MAP: Partial<Record<AgentRole, number>> = {
  [AgentRole.PYTHON_CODER]: 1,  // Use second model in tier2 (gpt-4o-mini)
  [AgentRole.RESEARCHER]: 0,    // Use first model in tier2 (gemini) - this is default
};
```

**Index behavior:**
- `0` = First model in tier (default)
- `1` = Second model in tier
- `2` = Third model in tier
- `-1` or out of bounds = Last model in tier

### Step 3: Configure LiteLLM

Add the model to your LiteLLM proxy configuration so it knows how to route requests.

## Model Tier Guidelines

### Tier 1: Ultra-Fast (< 1s response, < $0.01/1K tokens)
- **Use for:** Social chat, writing, simple Q&A (no tools required)
- **Tool support:** Limited or none - models may not support function calling
- **Examples:** `gemini-2.5-flash-lite`, `gpt-3.5-turbo`
- **Agent roles:** Social tasks, general conversation
- **Note:** Perfect for tasks that don't need file access or command execution

### Tier 2: Fast (1-3s response, $0.01-0.10/1K tokens)
- **Use for:** Code generation, technical Q&A, documentation
- **Tool support:** Full MCP tool support required
- **Examples:** `gemini`, `gpt-4o-mini`, `claude-haiku`
- **Agent roles:** `PYTHON_CODER`, `JS_TS_CODER`, `RESEARCHER`
- **Note:** Models must support function calling for file operations

### Tier 3: Balanced (3-10s response, $0.10-1.00/1K tokens)
- **Use for:** Complex code, architecture, reviews
- **Tool support:** Full MCP tool support required
- **Examples:** `sonnet`, `gpt-4o`, `claude-3.5-sonnet`
- **Agent roles:** `DEVOPS_ENGINEER`, `CODE_REVIEWER`, `DBA`
- **Note:** Higher quality reasoning with full tool access

### Tier 4: Premium (10-30s response, $1.00+/1K tokens)
- **Use for:** Critical decisions, complex architecture, final review
- **Tool support:** Full MCP tool support required
- **Examples:** `opus`, `o1`, `gpt-4-turbo`
- **Agent roles:** `ARCHITECT`
- **Note:** Most expensive tier - use only when lower tiers fail or for critical tasks

## Escalation Behavior

When a model gets stuck (low confidence, repeated errors), it escalates to the **next model in the capability order**:

```
gemini-2.5-flash-lite → gemini → gpt-4o-mini → sonnet → gpt-4o → claude-3.5 → opus → o1 → gpt-4-turbo
```

If already at the highest tier, the bot asks the user for help.

## Advanced: Multiple Models per Tier

You can add multiple models to a tier and control which one each agent uses via the index map:

```typescript
// In escalation.ts
export const MODEL_TIERS = {
  tier2: ['gemini-3-pro', 'gpt-4o-mini', 'claude-haiku'],  // 3 models in tier2
};

// In registry.ts
export const AGENT_MODEL_INDEX_MAP = {
  [AgentRole.PYTHON_CODER]: 0,    // Use gemini (first)
  [AgentRole.JS_TS_CODER]: 1,     // Use gpt-4o-mini (second)
  [AgentRole.RESEARCHER]: 2,      // Use claude-haiku (third)
  [AgentRole.DOCUMENTATION_WRITER]: 10,  // Out of bounds → uses claude-haiku (last)
};
```

**Use cases:**
- **Load balancing** - Distribute different agents across providers
- **Fallback** - If one provider is down, change the index
- **A/B testing** - Compare model performance by agent role
- **Cost optimization** - Use cheaper models for less critical agents

**Index handling:**
- Valid index (0 to length-1): Uses that specific model
- Negative or >= length: Uses last model in tier (safe fallback)

## Example: Adding GPT-4o

```typescript
// 1. Add to tier
export const MODEL_TIERS = {
  tier1: ['gemini-2.5-flash-lite'],
  tier2: ['gemini-3-pro', 'gpt-4o-mini'],
  tier3: ['claude-sonnet-4.5', 'gpt-4o'],  // ← Added here
  tier4: ['claude-opus-4.5', 'o1'],
};

// 2. (Optional) Make it default for an agent
export const AGENT_MODEL_TIER_MAP = {
  [AgentRole.PYTHON_CODER]: 'tier3',  // Use tier3
};

// 3. (Optional) Pick specific model in tier
export const AGENT_MODEL_INDEX_MAP = {
  [AgentRole.PYTHON_CODER]: 1,  // Use gpt-4o (second in tier3)
  // If not specified, defaults to 0 (sonnet, first in tier3)
};

// 4. Configure LiteLLM proxy
// Add to litellm config.yaml:
model_list:
  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY
```

## Example: Adding a Custom Model

```typescript
// 1. Add to appropriate tier
export const MODEL_TIERS = {
  tier1: ['gemini-2.5-flash-lite'],
  tier2: ['gemini-3-pro', 'gpt-4o-mini', 'my-custom-model'],  // ← Added
  tier3: ['claude-sonnet-4.5', 'gpt-4o'],
  tier4: ['claude-opus-4.5', 'o1'],
};

// 2. Configure LiteLLM to route to your custom endpoint
model_list:
  - model_name: my-custom-model
    litellm_params:
      model: custom/my-model
      api_base: https://my-api.example.com/v1
      api_key: os.environ/MY_API_KEY
```

## Testing

After adding a model, test it:

```bash
# 1. Verify escalation ladder
npm run test:escalation

# 2. Test with a simple task
# In Discord: "@bot write a hello world in Python"
# Check logs to see which model was used

# 3. Test escalation
# In Discord: "@bot do something impossible"
# Watch it escalate through tiers
```

## Troubleshooting

### Model not being used
- Check `AGENT_MODEL_TIER_MAP` - is the agent assigned to the right tier?
- Check `AGENT_MODEL_INDEX_MAP` - is the index pointing to the right model?
- Check LiteLLM logs - is the model configured correctly?

### Escalation not working
- Check `MODEL_CAPABILITY_ORDER` - is your model in the list?
- Check logs for escalation triggers

### Wrong model selected
- Check the index in `AGENT_MODEL_INDEX_MAP`
- Remember: index 0 = first model, index 1 = second model, etc.
- Out of bounds indices use the last model in the tier
- If no index specified, defaults to 0 (first model)

### Debugging model selection

```typescript
// Add this to your code to see which model is selected:
import { getModelForAgent } from './templates/registry';
import { AgentRole } from './modules/litellm/types';

const model = getModelForAgent(AgentRole.PYTHON_CODER);
console.log(`PYTHON_CODER will use: ${model}`);
```

## Future Enhancements

- [ ] Round-robin selection within tiers
- [ ] Cost-based model selection
- [ ] Performance tracking per model
- [ ] User preferences for model selection
- [ ] Dynamic tier assignment based on task complexity
