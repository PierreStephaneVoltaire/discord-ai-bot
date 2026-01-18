resource "aws_ecr_repository" "discord_bot" {
  name                 = "discord-bot"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "discord_bot" {
  repository = aws_ecr_repository.discord_bot.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 5 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 5
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

locals {
  # Calculate hash of the app directory to trigger builds on change
  app_files = fileset("${path.module}/../app", "**")
  app_hash  = sha1(join("", [for f in local.app_files : filesha1("${path.module}/../app/${f}")]))

  # Also check docker files
  docker_files = fileset("${path.module}/../docker", "**")
  docker_hash  = sha1(join("", [for f in local.docker_files : filesha1("${path.module}/../docker/${f}")]))

  build_trigger = substr(sha1("${local.app_hash}-${local.docker_hash}"), 0, 16)
}

resource "null_resource" "packer_build" {
  triggers = {
    dir_sha1 = local.build_trigger
    repo_url = aws_ecr_repository.discord_bot.repository_url
  }

  provisioner "local-exec" {
    working_dir = "${path.module}/../docker"
    command     = <<EOT
      packer init build.pkr.hcl
      packer build -var "image_repository=${aws_ecr_repository.discord_bot.repository_url}" -var "image_tag=${local.build_trigger}" build.pkr.hcl
    EOT
  }

  depends_on = [aws_ecr_repository.discord_bot]
}
