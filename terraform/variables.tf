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

variable "n8n_webhook_url" {
  description = "N8N Webhook URL"
  type        = string
}
