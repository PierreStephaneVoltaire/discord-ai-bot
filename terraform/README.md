# Infrastructure Configuration

Terraform configuration for deploying the Discord bot to Kubernetes with AWS services.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     DigitalOcean K8s                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  discord-bot namespace                                │  │
│  │  ├─ discord-bot deployment (1 replica)               │  │
│  │  │  └─ Health/Ready endpoints on :3000               │  │
│  │  └─ dev-sandbox deployment (1 replica)               │  │
│  │     └─ Persistent workspace for code execution       │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ├─────────────────────────────────┐
                            │                                 │
                            ▼                                 ▼
                    ┌───────────────┐              ┌──────────────────┐
                    │  AWS DynamoDB │              │    AWS SQS       │
                    ├───────────────┤              ├──────────────────┤
                    │ Sessions      │              │ agentic-events   │
                    │ Executions    │              │ discord-messages │
                    │ Messages      │              │ (+ DLQs)         │
                    │ Chat History  │              └──────────────────┘
                    └───────────────┘
                            │
                            ▼
                    ┌───────────────┐
                    │   AWS ECR     │
                    ├───────────────┤
                    │ discord-bot   │
                    │ dev-sandbox   │
                    └───────────────┘
```

## Components

### DynamoDB Tables

**1. discord_sessions**
- Stores thread session state
- Branch names, topic summaries, confidence scores
- No TTL (persistent)

**2. discord_executions**
- Tracks individual message executions
- Status, model used, input/output context
- TTL: Auto-expire old records
- GSI: `thread_id-index` for querying by thread

**3. discord-messages**
- Turn-by-turn execution logs
- Tool calls, confidence, file changes
- TTL: 30 days
- GSI: `TimestampIndex` for time-based queries

**4. chat_history**
- Discord message history
- TTL: Auto-expire based on date

### SQS Queues

**1. agentic-events**
- Execution lifecycle events
- Model escalations
- Branch merge/reject events
- DLQ: `agentic-events-dlq` (3 retries)

**2. discord-messages**
- Message processing queue
- DLQ: `discord-messages-dlq` (3 retries)

### ECR Repositories

**1. discord-bot**
- Main application image
- Built via Packer from `docker/build.pkr.hcl`
- Lifecycle: Keep last 10 images

**2. dev-sandbox**
- Sandbox environment for code execution
- Built via Packer from `docker/dev-sandbox.pkr.hcl`
- Lifecycle: Keep last 5 images

### Kubernetes Resources

**Namespace:** `discord-bot`

**Deployments:**
1. **discord-bot**
   - 1 replica
   - Resources: 256Mi-512Mi RAM, 100m-500m CPU
   - Health checks on `/health` and `/ready`
   - Secrets: Discord token, LiteLLM key, AWS credentials

2. **dev-sandbox**
   - 1 replica
   - Resources: 1Gi-2Gi RAM
   - Service account with cluster-reader permissions
   - Persistent workspace at `/workspaces`

**Secrets:**
- `discord-bot-secrets` - Application secrets
- `ecr-registry` - ECR pull credentials

**RBAC:**
- `sandbox-reader` ClusterRole - Read-only K8s access
- `sandbox-reader-binding` - Binds role to sandbox SA

## Deployment

### Prerequisites

```bash
brew install terraform packer awscli
aws configure
export DIGITALOCEAN_TOKEN=your_token
```

### Initial Setup

```bash
cd terraform
terraform init
terraform plan
terraform apply
```

### Update Application

```bash
cd docker
packer build -var "image_repository=YOUR_ECR_REPO" build.pkr.hcl
kubectl rollout restart deployment/discord-bot -n discord-bot
```

### Update Sandbox

```bash
cd docker
packer build -var "image_repository=YOUR_ECR_REPO" dev-sandbox.pkr.hcl
kubectl rollout restart deployment/dev-sandbox -n discord-bot
```

## Configuration

### Required Variables

Create `terraform.tfvars`:

```hcl
region              = "ca-central-1"
aws_access_key      = "AKIA..."
aws_secret_key      = "..."
discord_token       = "..."
discord_bot_id      = "1331474398296727582"
discord_guild_id    = "1007381699346301038"
litellm_base_url    = "http://litellm.ai-platform.svc.cluster.local:4000"
litellm_api_key     = "..."
do_token            = "..."
do_cluster_name     = "discord-bot-cluster"
```

## Monitoring

### Check Deployment Status

```bash
kubectl get pods -n discord-bot
kubectl logs -f deployment/discord-bot -n discord-bot
```

### Check DynamoDB

```bash
aws dynamodb list-tables

aws dynamodb query \
  --table-name discord-messages \
  --key-condition-expression "pk = :threadId" \
  --expression-attribute-values '{":threadId":{"S":"1234567890"}}'
```

### Check SQS

```bash
aws sqs get-queue-attributes \
  --queue-url $(terraform output -raw agentic_events_queue_url) \
  --attribute-names All

aws sqs receive-message \
  --queue-url $(terraform output -raw agentic_events_queue_url)
```

### Check ECR

```bash
aws ecr describe-images \
  --repository-name discord-bot \
  --query 'sort_by(imageDetails,& imagePushedAt)[-5:]'
```

## Troubleshooting

### Pod not starting

```bash
kubectl describe pod -n discord-bot -l app=discord-bot
kubectl logs -n discord-bot -l app=discord-bot --previous
```

### ECR pull errors

```bash
aws ecr get-login-password --region ca-central-1 | \
  docker login --username AWS --password-stdin YOUR_ECR_REPO

kubectl delete secret ecr-registry -n discord-bot
terraform apply -target=kubernetes_secret.ecr_registry
```

### DynamoDB access errors

```bash
aws dynamodb describe-table --table-name discord_sessions
kubectl exec -n discord-bot deployment/discord-bot -- env | grep AWS
```

## Outputs

After `terraform apply`:

```bash
terraform output discord_messages_queue_url
terraform output agentic_events_queue_url
terraform output discord_messages_table_name
```

## Cleanup

```bash
terraform destroy
```

## Cost Estimation

**Monthly costs (approximate):**
- DynamoDB: $5-20 (pay per request)
- SQS: $0-5 (first 1M requests free)
- ECR: $1-5 (storage)
- DigitalOcean K8s: $12+ (cluster cost)

**Total: ~$20-50/month**

## Security

### Secrets Management

- Discord token stored in K8s secret
- AWS credentials stored in K8s secret
- ECR credentials auto-rotated
- No secrets in code or logs

### Network Security

- Bot runs in isolated namespace
- Sandbox has read-only cluster access
- No public endpoints (except health checks)

### IAM Permissions

Bot needs:
- DynamoDB: Read/Write on all tables
- SQS: SendMessage, ReceiveMessage
- ECR: Pull images

## See Also

- [Application README](../README.md)
- [Agentic Module](../app/src/modules/agentic/README.md)
- [Adding Models Guide](../docs/ADDING-MODELS.md)
