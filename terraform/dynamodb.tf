resource "aws_dynamodb_table" "chat_history" {
  name         = "chat_history"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "date"
  range_key    = "last_message_timestamp"

  attribute {
    name = "date"
    type = "S"
  }

  attribute {
    name = "last_message_timestamp"
    type = "N"
  }


  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = {
    Name = "chat_history"
  }
}

resource "aws_dynamodb_table" "discord_sessions" {
  name         = "discord_sessions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "thread_id"

  attribute {
    name = "thread_id"
    type = "S"
  }

  tags = {
    Name = "discord_sessions"
  }
}

resource "aws_dynamodb_table" "discord_executions" {
  name         = "discord_executions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "execution_id"

  attribute {
    name = "execution_id"
    type = "S"
  }

  attribute {
    name = "thread_id"
    type = "S"
  }

  global_secondary_index {
    name            = "thread_id-index"
    hash_key        = "thread_id"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = {
    Name        = "discord_executions"
    Environment = "production"
  }
}

resource "aws_dynamodb_table" "discord_messages" {
  name         = "discord-messages"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "threadId"
  range_key    = "sortKey"

  attribute {
    name = "threadId"
    type = "S"
  }

  attribute {
    name = "sortKey"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = {
    Name        = "discord-messages"
    Environment = "production"
    Description = "Stores agentic execution turn history by thread"
  }
}

output "discord_messages_table_name" {
  value       = aws_dynamodb_table.discord_messages.name
  description = "Name of the discord-messages DynamoDB table"
}

output "discord_messages_table_arn" {
  value       = aws_dynamodb_table.discord_messages.arn
  description = "ARN of the discord-messages DynamoDB table"
}
