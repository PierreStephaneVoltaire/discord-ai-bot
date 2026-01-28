resource "aws_sqs_queue" "discord_messages" {
  name                       = "discord-messages"
  delay_seconds              = 0
  max_message_size           = 262144
  message_retention_seconds  = 1209600 # 14 days
  receive_wait_time_seconds  = 0
  visibility_timeout_seconds = 30

  tags = {
    Name        = "discord-messages"
    Environment = "production"
  }
}

resource "aws_sqs_queue" "discord_messages_dlq" {
  name                      = "discord-messages-dlq"
  delay_seconds             = 0
  max_message_size          = 262144
  message_retention_seconds = 1209600 # 14 days
  receive_wait_time_seconds = 0

  tags = {
    Name        = "discord-messages-dlq"
    Environment = "production"
  }
}

resource "aws_sqs_queue_redrive_policy" "discord_messages" {
  queue_url = aws_sqs_queue.discord_messages.id
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.discord_messages_dlq.arn
    maxReceiveCount     = 3
  })
}

output "discord_messages_queue_url" {
  value       = aws_sqs_queue.discord_messages.url
  description = "URL of the discord-messages SQS queue"
}

output "discord_messages_queue_arn" {
  value       = aws_sqs_queue.discord_messages.arn
  description = "ARN of the discord-messages SQS queue"
}
