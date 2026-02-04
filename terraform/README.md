# Infrastructure Configuration

Terraform configuration for deploying the Discord bot and Stoat (Revolt) self-hosted chat platform to Kubernetes with AWS services.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     DigitalOcean K8s                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  discord-bot namespace                                │  │
│  │  ├─ discord-bot deployment (1 replica)               │  │
│  │  │  └─ Health/Ready endpoints on :3000               │  │
│  │  ├─ dev-sandbox deployment (1 replica)               │  │
│  │  │  └─ Persistent workspace for code execution       │  │
│  │  ├─ redis statefulset (1 replica)                    │  │
│  │  │  └─ Hot state management                          │  │
│  │  │                                                    │  │
│  │  └─ STOAT PLATFORM (Revolt Self-Hosted)              │  │
│  │     ├─ stoat-api (API server)                        │  │
│  │     ├─ stoat-events (WebSocket events)               │  │
│  │     ├─ stoat-web (Web client)                        │  │
│  │     ├─ stoat-autumn (File server)                    │  │
│  │     ├─ stoat-january (Metadata proxy)                │  │
│  │     ├─ stoat-gifbox (Tenor proxy)                    │  │
│  │     ├─ stoat-crond (Scheduled tasks)                 │  │
│  │     ├─ stoat-pushd (Push notifications)              │  │
│  │     ├─ stoat-caddy (Reverse proxy)                   │  │
│  │     ├─ stoat-mongodb (Database)                      │  │
│  │     ├─ stoat-rabbitmq (Message broker)               │  │
│  │     └─ stoat-minio (S3 storage)                      │  │
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

# Stoat (Revolt) Self-Hosted Configuration (optional)
stoat_domain            = "stoat.example.com"
stoat_rabbitmq_user     = "rabbituser"
stoat_rabbitmq_pass     = "rabbitpass"
stoat_minio_user        = "minioautumn"
stoat_minio_pass        = "minioautumn"
# stoat_encryption_key is auto-generated if not specified
stoat_vapid_private_key = ""  # Generate with stoat/self-hosted/generate_config.sh
stoat_vapid_public_key  = ""  # Generate with stoat/self-hosted/generate_config.sh
```

## Stoat (Revolt) Self-Hosted Platform

The Stoat platform is deployed alongside the Discord bot in the same namespace. It provides a self-hosted chat platform alternative.

### Stoat Components

| Service | Image | Purpose | Port |
|---------|-------|---------|------|
| `stoat-api` | `ghcr.io/revoltchat/server:20250930-2` | API server | 3000 |
| `stoat-events` | `ghcr.io/revoltchat/bonfire:20250930-2` | WebSocket events | 3000 |
| `stoat-web` | `ghcr.io/revoltchat/client:master` | Web client | 5000 |
| `stoat-autumn` | `ghcr.io/revoltchat/autumn:20250930-2` | File server | 3000 |
| `stoat-january` | `ghcr.io/revoltchat/january:20250930-2` | Metadata proxy | 3000 |
| `stoat-gifbox` | `ghcr.io/revoltchat/gifbox:20250930-2` | Tenor GIF proxy | 3000 |
| `stoat-crond` | `ghcr.io/revoltchat/crond:20250930-2` | Scheduled tasks | - |
| `stoat-pushd` | `ghcr.io/revoltchat/pushd:20250930-2` | Push notifications | - |
| `stoat-caddy` | `public.ecr.aws/docker/library/caddy:2` | Reverse proxy | 80/443 |
| `stoat-mongodb` | `public.ecr.aws/docker/library/mongo:7` | Database | 27017 |
| `stoat-rabbitmq` | `public.ecr.aws/docker/library/rabbitmq:4` | Message broker | 5672/15672 |
| `stoat-minio` | `public.ecr.aws/docker/library/minio:latest` | S3 storage | 9000/9001 |

### Stoat Dependencies

```
stoat-api → mongodb, redis, rabbitmq
stoat-events → mongodb, redis
stoat-autumn → mongodb, minio
stoat-crond → mongodb, minio
stoat-pushd → mongodb, redis, rabbitmq
```

### Generate Stoat Configuration

The encryption key is automatically generated by Terraform if not provided. To use a custom key or view the generated one:

```bash
# After terraform apply, the generated key will be shown in output
# Or retrieve it from state:
terraform state show random_password.stoat_encryption_key[0]
```

Before deploying, generate VAPID keys for push notifications:

```bash
cd stoat/self-hosted
./generate_config.sh your-domain.com
```

Copy the generated values to your `terraform.tfvars`:
- `stoat_vapid_private_key` from `[pushd.vapid]` section
- `stoat_vapid_public_key` from `[pushd.vapid]` section

Note: `stoat_encryption_key` is auto-generated if not specified.

### Access Stoat

After deployment, access Stoat via the LoadBalancer IP or configure DNS:

```bash
# Get the external IP
kubectl get service stoat-caddy -n discord-bot

# Or port-forward for local testing
kubectl port-forward service/stoat-caddy 8080:80 -n discord-bot
# Access at http://localhost:8080
```

## Monitoring

### Check Deployment Status

```bash
kubectl get pods -n discord-bot
kubectl logs -f deployment/discord-bot -n discord-bot
```

### Check Stoat Services

```bash
# List all Stoat pods
kubectl get pods -n discord-bot -l app=stoat-api
kubectl get pods -n discord-bot -l app=stoat-web

# Check logs
kubectl logs -f deployment/stoat-api -n discord-bot
kubectl logs -f deployment/stoat-events -n discord-bot

# Check MongoDB
kubectl logs -f deployment/stoat-mongodb -n discord-bot

# Check RabbitMQ Management (port-forward)
kubectl port-forward service/stoat-rabbitmq 15672:15672 -n discord-bot
# Access at http://localhost:15672 (guest/guest or configured credentials)

# Check MinIO Console (port-forward)
kubectl port-forward service/stoat-minio 9001:9001 -n discord-bot
# Access at http://localhost:9001
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

# For Stoat pods
kubectl describe pod -n discord-bot -l app=stoat-api
kubectl logs -n discord-bot -l app=stoat-api --previous
```

### Stoat services not connecting

```bash
# Check if MongoDB is ready
kubectl get pods -n discord-bot -l app=stoat-mongodb

# Check if RabbitMQ is ready
kubectl get pods -n discord-bot -l app=stoat-rabbitmq

# Check service endpoints
kubectl get endpoints -n discord-bot

# Verify ConfigMap is mounted correctly
kubectl exec -n discord-bot deployment/stoat-api -- cat /Revolt.toml
```

### MinIO bucket creation failed

```bash
# Check the job status
kubectl get jobs -n discord-bot
kubectl logs -n discord-bot job/stoat-minio-create-buckets

# Re-run the job
kubectl delete job stoat-minio-create-buckets -n discord-bot
terraform apply -target=kubernetes_job.stoat_minio_create_buckets
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
- DigitalOcean K8s: $95+ (cluster cost)

**Total: ~$100-125/month**

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
