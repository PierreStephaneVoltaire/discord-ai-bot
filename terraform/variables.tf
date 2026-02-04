variable "region" {
  description = "AWS Region"
  type        = string
  default     = "ca-central-1"
}

variable "aws_access_key" {
  description = "AWS Access Key ID"
  type        = string
  sensitive   = true
}

variable "aws_secret_key" {
  description = "AWS Secret Access Key"
  type        = string
  sensitive   = true
}

variable "discord_token" {
  description = "Discord Bot Token"
  type        = string
  sensitive   = true
}

variable "discord_bot_id" {
  description = "Discord Bot User ID"
  type        = string
  default     = "1331474398296727582"
}

variable "discord_guild_id" {
  description = "Discord Guild ID"
  type        = string
  default     = "12222222222222"
}

variable "litellm_base_url" {
  description = "LiteLLM API base URL"
  type        = string
  default     = "http://litellm.ai-platform.svc.cluster.local:4000"
}

variable "litellm_api_key" {
  description = "LiteLLM API key"
  type        = string
  sensitive   = true
}

variable "do_token" {
  description = "DigitalOcean API token"
  type        = string
  sensitive   = true
}

variable "do_cluster_name" {
  description = "DigitalOcean Kubernetes cluster name"
  type        = string
  default     = "discord-bot-cluster"
}

variable "s3_artifact_bucket" {
  description = "S3 bucket for storing per-thread artifacts"
  type        = string
  default     = "psv-discord-bot-artifacts"
}

variable "redis_enabled" {
  description = "Enable Redis for hot state management"
  type        = bool
  default     = true
}

variable "stoat_token" {
  description = "Stoat bot token (for Stoat platform support)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "stoat_bot_id" {
  description = "Stoat bot user ID"
  type        = string
  default     = ""
}

variable "chat_platform" {
  description = "Chat platform to use: discord, stoat, or both"
  type        = string
  default     = "discord"
}



variable "stoat_rabbitmq_user" {
  description = "RabbitMQ username for Stoat"
  type        = string
  sensitive   = true
  default     = "rabbituser"
}

variable "stoat_rabbitmq_pass" {
  description = "RabbitMQ password for Stoat"
  type        = string
  sensitive   = true
  default     = "rabbitpass"
}

variable "stoat_minio_user" {
  description = "MinIO root username for Stoat"
  type        = string
  sensitive   = true
  default     = "minioautumn"
}

variable "stoat_minio_pass" {
  description = "MinIO root password for Stoat"
  type        = string
  sensitive   = true
  default     = "minioautumn"
}

variable "stoat_encryption_key" {
  description = "Encryption key for Stoat file storage (generate with: openssl rand -base64 32)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "stoat_vapid_private_key" {
  description = "VAPID private key for Stoat push notifications"
  type        = string
  sensitive   = true
  default     = ""
}

variable "stoat_vapid_public_key" {
  description = "VAPID public key for Stoat push notifications"
  type        = string
  sensitive   = true
  default     = ""
}

# ============================================
# GATEWAY VARIABLES
# ============================================

variable "domain" {
  description = "Main domain for services (e.g., example.com)"
  type        = string
  default     = "example.com"
}


