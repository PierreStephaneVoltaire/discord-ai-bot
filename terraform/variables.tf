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
  default     = "1007381699346301038"
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
  default     = "discord-bot-artifacts"
}
