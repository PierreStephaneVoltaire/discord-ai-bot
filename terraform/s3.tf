resource "aws_s3_bucket" "artifacts" {
  bucket = var.s3_artifact_bucket

  tags = {
    Name        = "Discord Bot Artifacts"
    Environment = "Production"
    App         = "discord-bot"
  }
  
  # Allow deletion of non-empty bucket for development ease
  force_destroy = true
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    id     = "cleanup_old_threads"
    status = "Enabled"

    filter {
      prefix = "threads/"
    }

    expiration {
      days = 30
    }
  }
}
